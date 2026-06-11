using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TripReplayMap"/> view — the native port of the web
/// component's data flow (web/src/features/trips/components/TripReplayMap.tsx, fed the <c>positions</c> /
/// <c>currentIndex</c> props from the Trip-Replay page's <c>useDrive(id)</c> + <c>useTripReplay</c>). It drives one
/// cache-then-network read through the <see cref="ITripReplayMapSource"/>, projects each emission through
/// <see cref="TripReplayMapProjection"/>, exposes the full state matrix
/// (loading / ready / empty / stale / offline / error) plus freshness, and owns the playhead seat: the
/// <see cref="CurrentIndex"/> the parent drives (web <c>currentIndex</c>) and the <see cref="SeekRequested"/> event
/// a polyline / map tap raises (web <c>onSeekToIndex</c>). The view is a thin renderer over this. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TripReplayMapViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITripReplayMapSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private TripReplayMapData? _data;
    private bool _disposed;

    private TripReplayMapState _state = TripReplayMapState.Loading;
    private TripReplayMapDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;
    private int _currentIndex;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network drive-position data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public TripReplayMapViewModel(ITripReplayMapSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = TripReplayMapProjection.Project(null, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised when the user requests a seek by tapping the route (web <c>onSeekToIndex</c>). The argument is the
    /// nearest sample index. A host page can mirror this back into <see cref="CurrentIndex"/> to stay in lockstep
    /// with its scrubber / chart cursor; the surface also moves its own playhead optimistically.
    /// </summary>
    public event EventHandler<int>? SeekRequested;

    // ── State ───────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current surface state (loading / ready / empty / stale / offline / error).</summary>
    public TripReplayMapState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready map model (centre, trail, segments, markers, copy).</summary>
    public TripReplayMapDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(CurrentLocation));
            Raise(nameof(CurrentHeading));
            Raise(nameof(HasPlayhead));
        }
    }

    /// <summary>Last successful update timestamp (for the freshness chip).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed (hard error or offline-with-cache).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown content is a cached value past the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the network failed but cached content is still being shown.</summary>
    public bool IsOffline
    {
        get => _isOffline;
        private set => Set(ref _isOffline, value);
    }

    /// <summary>Localized error message (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts so far (including retries) — drives "tried N times" messaging.</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Playhead (web `currentIndex` prop ⇄ `onSeekToIndex` callback) ─────────────────────────────────────

    /// <summary>
    /// The playhead sample index (web <c>currentIndex</c>). Clamped to the resolved position range; assigning it
    /// moves the playhead but raises no <see cref="SeekRequested"/> (that is the parent driving the marker).
    /// </summary>
    public int CurrentIndex
    {
        get => _currentIndex;
        set => SetCurrentIndex(value);
    }

    /// <summary>The playhead coordinate, or null when there is no plottable route (web <c>currentPosition</c>).</summary>
    public GeoPoint? CurrentLocation
    {
        get
        {
            var positions = _data?.Positions;
            if (!_display.HasRoute || positions is null || positions.Count == 0)
            {
                return null;
            }

            int idx = Math.Clamp(_currentIndex, 0, positions.Count - 1);
            return positions[idx].Location;
        }
    }

    /// <summary>The playhead bearing in degrees (web <c>heading</c>); 0 when there are fewer than two samples.</summary>
    public double CurrentHeading
    {
        get
        {
            var positions = _data?.Positions;
            if (!_display.HasRoute || positions is null || positions.Count < 2)
            {
                return 0;
            }

            // Web parity: next = currentIndex < n-1 ? currentIndex+1 : currentIndex; prev = next>0 ? next-1 : 0.
            int next = _currentIndex < positions.Count - 1 ? _currentIndex + 1 : _currentIndex;
            next = Math.Clamp(next, 0, positions.Count - 1);
            int prev = next > 0 ? next - 1 : 0;
            return TripReplayGeo.ComputeHeadingDegrees(positions[prev], positions[next]);
        }
    }

    /// <summary>True when a playhead marker should be shown (a plottable route with at least one position).</summary>
    public bool HasPlayhead => CurrentLocation is not null;

    /// <summary>
    /// User-initiated seek to the position nearest <paramref name="lat"/>/<paramref name="lng"/> (web polyline
    /// <c>click</c> → <c>nearestSampleIndex</c> → <c>onSeekToIndex</c>). Moves the playhead and raises
    /// <see cref="SeekRequested"/> with the resolved index. A no-op when there are no positions.
    /// </summary>
    public void RequestSeekToCoordinate(double lat, double lng)
    {
        var positions = _data?.Positions;
        if (positions is null || positions.Count == 0)
        {
            return;
        }

        int idx = TripReplayGeo.NearestSampleIndex(positions, lat, lng);
        SetCurrentIndex(idx);
        SeekRequested?.Invoke(this, idx);
    }

    // ── Localized copy ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>The accessible map-region name (web <c>aria-label</c>).</summary>
    public string MapLabel => _display.MapLabel;

    /// <summary>The empty-state copy when no positions exist (web <c>replay.map.noPositions</c>).</summary>
    public string EmptyText => TripReplayMapRegistration.NoPositions(_localizer);

    /// <summary>The stationary-route banner title (web <c>replay.map.stationaryRouteTitle</c>).</summary>
    public string StationaryTitle => _display.StationaryTitle;

    /// <summary>The stationary-route banner body (web <c>replay.map.stationaryRouteBody</c>).</summary>
    public string StationaryBody => _display.StationaryBody;

    /// <summary>Stale freshness chip label.</summary>
    public string StaleLabel => TripReplayMapRegistration.StaleLabel(_localizer);

    /// <summary>Offline freshness chip label.</summary>
    public string OfflineLabel => TripReplayMapRegistration.OfflineLabel(_localizer);

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => TripReplayMapRegistration.RetryLabel(_localizer);

    /// <summary>Loading Narrator label.</summary>
    public string LoadingLabel => TripReplayMapRegistration.LoadingLabel(_localizer);

    /// <summary>Hard-error copy.</summary>
    public string ErrorText => TripReplayMapRegistration.ErrorText(_localizer);

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        TripReplayMapState.Loading => LoadingLabel,
        TripReplayMapState.Stale => StaleLabel,
        TripReplayMapState.Offline => _errorMessage ?? OfflineLabel,
        TripReplayMapState.Error => _errorMessage ?? ErrorText,
        TripReplayMapState.Empty => EmptyText,
        _ => null,
    };

    // ── Commands ────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network drive-position load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (_data is null)
        {
            State = TripReplayMapState.Loading;
            IsFetching = true;
            IsError = false;
            IsStale = false;
            IsOffline = false;
            ErrorMessage = null;
            RefreshDisplay();
        }
        else
        {
            IsFetching = true;
        }

        Raise(nameof(StatusAnnouncement));

        try
        {
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry the surface after a failure (web <c>QueryError</c> retry → refetch).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ───────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<TripReplayMapData> result)
    {
        _data = NextData(result, _data);

        var outcome = Classify(result, _data);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        IsOffline = outcome.IsOffline;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }

        RefreshDisplay();
        ClampCurrentIndex();
        Raise(nameof(StatusAnnouncement));
    }

    private MapOutcome Classify(RepositoryResult<TripReplayMapData> result, TripReplayMapData? data)
    {
        bool hasValue = data is not null;

        return result.Status switch
        {
            LoadStatus.Loading => hasValue
                ? new MapOutcome(TripReplayMapState.Ready, true, false, false, false, null, null)
                : new MapOutcome(TripReplayMapState.Loading, true, false, false, false, null, null),

            LoadStatus.Cached => new MapOutcome(
                result.IsStale ? TripReplayMapState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Refreshing => new MapOutcome(
                result.IsStale ? TripReplayMapState.Stale : ContentState(data),
                true, false, result.IsStale, false, null, result.FetchedAt),

            LoadStatus.Loaded => new MapOutcome(
                ContentState(data), false, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new MapOutcome(
                TripReplayMapState.Empty, false, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasValue
                ? new MapOutcome(
                    TripReplayMapState.Offline, false, true, true, true, OfflineLabel, result.FetchedAt)
                : new MapOutcome(
                    TripReplayMapState.Error, false, true, false, false, ErrorText, result.FetchedAt),

            _ => new MapOutcome(
                TripReplayMapState.Error, false, true, false, false, ErrorText, null),
        };
    }

    // Web parity: the map renders whenever a positions payload is present; a body with no positions is the
    // whole-surface empty state (web positions.length === 0 → EmptyState).
    private static TripReplayMapState ContentState(TripReplayMapData? data) =>
        data is { Positions.Count: > 0 } ? TripReplayMapState.Ready : TripReplayMapState.Empty;

    private static TripReplayMapData? NextData(
        RepositoryResult<TripReplayMapData> result, TripReplayMapData? previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,               // transient — keep the prior value visible
            LoadStatus.Empty or LoadStatus.Error => null, // resolved with nothing to show
            _ => result.Value ?? previous,                // cached / refreshing / loaded / offline carry a value
        };

    private void RefreshDisplay() => Display = TripReplayMapProjection.Project(_data, _localizer);

    private void SetCurrentIndex(int value)
    {
        int clamped = ClampToPositions(value);
        if (_currentIndex == clamped)
        {
            return;
        }

        _currentIndex = clamped;
        Raise(nameof(CurrentIndex));
        Raise(nameof(CurrentLocation));
        Raise(nameof(CurrentHeading));
        Raise(nameof(HasPlayhead));
    }

    private void ClampCurrentIndex()
    {
        int clamped = ClampToPositions(_currentIndex);
        if (_currentIndex != clamped)
        {
            _currentIndex = clamped;
            Raise(nameof(CurrentIndex));
        }

        // A new projection can change whether a playhead exists even when the index is unchanged.
        Raise(nameof(CurrentLocation));
        Raise(nameof(CurrentHeading));
        Raise(nameof(HasPlayhead));
    }

    private int ClampToPositions(int value)
    {
        int count = _data?.Positions.Count ?? 0;
        return count <= 0 ? 0 : Math.Clamp(value, 0, count - 1);
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    private readonly record struct MapOutcome(
        TripReplayMapState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        bool IsOffline,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
