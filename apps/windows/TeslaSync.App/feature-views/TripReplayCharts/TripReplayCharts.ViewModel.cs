using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TripReplayCharts"/> view — the native port of the
/// web Trip-Replay Speed &amp; Power timeline (web/src/features/trips/components/TripReplayCharts.tsx). The web
/// component is a pure child of the Trip-Replay page; the native surface binds its own cache-then-network
/// <see cref="ITripReplayChartsSource"/>, projects each snapshot through <see cref="TripReplayChartsProjection"/>
/// in the user's units, applies the web empty gate (no telemetry renders the friendly "No telemetry data
/// available" empty state), and exposes the mutually-exclusive <see cref="State"/> plus the header freshness
/// flags so the view is a thin renderer.
/// <para>
/// It also owns the surface's cursor-sync seam: the shared <see cref="ChartCursorSyncGroup"/> the chart
/// broadcasts hover / click positions into (web <c>useSyncedCursor</c>), and the bridge that subscribes to it
/// (web <c>useSyncedReferenceLineX</c> + <c>ChartCursorBridge</c>) to translate a position into the nearest
/// sample, advance the <see cref="CurrentIndex"/> playhead and raise <see cref="SeekToIndexRequested"/> so a
/// host can keep sibling surfaces (map / scrubber) in lockstep — the web <c>onSeekToIndex</c> contract.
/// </para>
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TripReplayChartsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITripReplayChartsSource _source;
    private readonly ILocalizer _localizer;
    private readonly ChartCursorSyncGroup _cursorSync = new();

    private CancellationTokenSource? _cts;
    private IReadOnlyList<TripReplaySample> _lastSamples = Array.Empty<TripReplaySample>();
    private IReadOnlyList<TripReplayChartPoint> _points = Array.Empty<TripReplayChartPoint>();
    private int _lastForwardedIndex = -1;
    private bool _disposed;

    private UnitPref _units;
    private TripReplayChartsState _state = TripReplayChartsState.Loading;
    private TripReplayChartsDisplay _display;
    private int _currentIndex;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network drive-telemetry source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public TripReplayChartsViewModel(
        ITripReplayChartsSource source,
        ILocalizer localizer,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = TripReplayChartsProjection.Empty(_units, _localizer);
        _cursorSync.CursorChanged += OnCursorChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised when the user seeks via the chart (hover or click) — the native analogue of the web
    /// <c>onSeekToIndex</c> callback. Carries the parent-array index of the chosen sample so a host can
    /// drive the shared replay engine and sibling surfaces. Not raised by a programmatic
    /// <see cref="SeekTo(int)"/> from a host (that path is host → surface, never echoed back).
    /// </summary>
    public event EventHandler<int>? SeekToIndexRequested;

    /// <summary>
    /// The shared cursor-sync group the chart broadcasts hover / click positions into and this holder bridges
    /// to <see cref="SeekToIndexRequested"/> (web <c>ChartTimeRangeProvider</c> scope). Exposed so the view
    /// can attach it to the chart.
    /// </summary>
    public ChartCursorSyncGroup CursorSync => _cursorSync;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public TripReplayChartsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (chrome + timeline).</summary>
    public TripReplayChartsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>
    /// The replay playhead — the index of the currently-selected sample (web <c>currentIndex</c>). The chart
    /// draws its reference line here; the cursor bridge and a host's <see cref="SeekTo(int)"/> both move it.
    /// </summary>
    public int CurrentIndex
    {
        get => _currentIndex;
        private set => Set(ref _currentIndex, value);
    }

    /// <summary>The user's unit preference; reassigning re-projects the timeline in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Raise(nameof(Units));
            if (HasContent())
            {
                Display = TripReplayChartsProjection.Project(_lastSamples, _units, _localizer);
                _points = _display.Timeline.Points;
                ClampCurrentIndex();
            }
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when there is a plottable trace (web <c>data.length &gt; 0</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title (web "Speed &amp; Power Timeline").</summary>
    public string Title => TripReplayChartsRegistration.Name(_localizer);

    /// <summary>Localized supporting sub-heading (web "Click to seek replay position").</summary>
    public string Subtitle => _display.Subtitle;

    /// <summary>Localized accessible chart summary (web aria label).</summary>
    public string ChartAriaLabel => _display.ChartAriaLabel;

    /// <summary>Localized empty-state message (web "No telemetry data available").</summary>
    public string EmptyMessage => _display.EmptyMessage;

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("common.loading", "Loading");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("replay.timeline.errorTitle", "Couldn't load trip telemetry");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel =>
        _localizer.GetString("replay.timeline.refresh", "Refresh speed and power timeline");

    /// <summary>Localized stale freshness-chip label.</summary>
    public string StaleChip => _localizer.GetString("common.stale", "Stale");

    /// <summary>Localized offline freshness-chip label.</summary>
    public string OfflineChip => _localizer.GetString("common.offline", "Offline");

    /// <summary>
    /// Move the replay playhead to <paramref name="index"/> (clamped to the trace), e.g. from a host's shared
    /// replay engine (the web parent setting <c>currentIndex</c>). Does not raise
    /// <see cref="SeekToIndexRequested"/> — that event is reserved for user-driven seeks originating in this
    /// surface.
    /// </summary>
    public void SeekTo(int index)
    {
        if (_points.Count == 0)
        {
            CurrentIndex = 0;
            return;
        }

        CurrentIndex = Math.Clamp(index, 0, _points.Count - 1);
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

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

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _cursorSync.CursorChanged -= OnCursorChanged;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is TripReplayChartsState.Loaded or TripReplayChartsState.Stale or TripReplayChartsState.Offline;

    // Web parity (ChartCursorBridge): every hover / click writes the active X (a `time` value) into the
    // cursor-sync store; this bridge maps it to the nearest sample and forwards once per distinct index,
    // matching the web's lastForwardedRef de-bounce so a parent re-render never re-seeks the same index.
    private void OnCursorChanged(object? sender, ChartCursorChange change)
    {
        if (_disposed || !change.IsActive || _points.Count == 0)
        {
            return;
        }

        int idx = TripReplayChartsProjection.NearestIndexByTime(_points, change.DomainX);
        if (idx == _lastForwardedIndex)
        {
            return;
        }

        _lastForwardedIndex = idx;
        SeekTo(idx);
        SeekToIndexRequested?.Invoke(this, _points[idx].Index);
    }

    private void Apply(RepositoryResult<IReadOnlyList<TripReplaySample>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        IReadOnlyList<TripReplaySample> samples,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = TripReplayChartsProjection.Project(samples, _units, _localizer);

        // Web parity: data.length === 0 renders the empty state regardless of freshness.
        if (!display.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        _lastSamples = samples;
        Display = display;
        _points = display.Timeline.Points;
        _lastForwardedIndex = -1;
        ClampCurrentIndex();
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? TripReplayChartsState.Offline
            : stale ? TripReplayChartsState.Stale : TripReplayChartsState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = TripReplayChartsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastSamples = Array.Empty<TripReplaySample>();
        Display = TripReplayChartsProjection.Empty(_units, _localizer);
        _points = Array.Empty<TripReplayChartPoint>();
        _lastForwardedIndex = -1;
        CurrentIndex = 0;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = TripReplayChartsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = TripReplayChartsState.Error;
    }

    private void ClampCurrentIndex()
    {
        if (_points.Count == 0)
        {
            CurrentIndex = 0;
        }
        else if (_currentIndex > _points.Count - 1)
        {
            CurrentIndex = _points.Count - 1;
        }
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "replay.timeline.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "replay.timeline.error.offline",
            _ => "replay.timeline.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view trip telemetry",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached trip telemetry",
            _ => "Couldn't load trip telemetry",
        };

        return _localizer.GetString(key, fallback);
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
