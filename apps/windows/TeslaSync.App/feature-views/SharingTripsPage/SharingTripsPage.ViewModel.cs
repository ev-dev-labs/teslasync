using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Sharing;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SharingTripsPage"/> view — the native port of the
/// web page's hook composition (web/src/features/sharing/pages/SharingTripsPage.tsx). It consumes the
/// cache-then-network <see cref="ISharingTripsSource"/> (the page's <c>useTrips({ vehicle_id, limit: 20 })</c>
/// read), applies the web empty gate (an empty trip list renders the friendly empty state, mirroring
/// <c>allTrips.length === 0 ? &lt;EmptyState&gt; : …</c>), projects the rest through
/// <see cref="SharingTripsProjection"/> with the active units, and exposes the mutually-exclusive
/// <see cref="State"/> plus the in-flight flag so the view is a thin renderer. It also owns the page's single
/// selection model — the picked trip id the recent-trips list writes and the hosted trip-postcard drafter
/// consumes (web <c>selectedTripId</c>). Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class SharingTripsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISharingTripsSource _source;
    private readonly ILocalizer _localizer;
    private readonly SharingTripsDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<SharingTrip>>? _last;
    private bool _disposed;

    private SharingTripsState _state = SharingTripsState.Loading;
    private SharingTripsDisplay _display;
    private bool _isFetching;
    private long? _selectedTripId;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, units, diagnostics and clock.</summary>
    /// <param name="source">The cache-then-network recent-trips port.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>unitPrefs</c>); null defaults to metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock used for date formatting; null uses the local wall clock.</param>
    public SharingTripsPageViewModel(
        ISharingTripsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        SharingTripsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new SharingTripsDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = SharingTripsProjection.Project(
            Array.Empty<SharingTrip>(), SharingTripsState.Loading, _units, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive recent-trips lifecycle state.</summary>
    public SharingTripsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public SharingTripsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a background refresh is in flight (keeps the list visible while refreshing).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>
    /// The picked trip id — the page's only selector. The recent-trips list writes it via
    /// <see cref="SelectTrip"/>; the hosted trip-postcard drafter consumes it (web <c>selectedTripId</c>).
    /// Null until the user picks a trip.
    /// </summary>
    public long? SelectedTripId
    {
        get => _selectedTripId;
        private set => Set(ref _selectedTripId, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The user's unit preference; reassigning re-projects the current trips in the new units.</summary>
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
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Pick a trip (web <c>setSelectedTripId(trip.id)</c>); idempotent for the same id.</summary>
    /// <param name="tripId">The picked trip id, or null to clear the selection.</param>
    public void SelectTrip(long? tripId) => SelectedTripId = tripId;

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the loading skeletons only when nothing is
    /// already resolved (otherwise keeps the list while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the cache-then-network sequence is exhausted.</returns>
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
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
    public Task RetryAsync() => LoadAsync();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private bool HasContent() => _state == SharingTripsState.Success;

    private void Apply(RepositoryResult<IReadOnlyList<SharingTrip>> result)
    {
        _last = result;
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
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, fetching: true);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Empty:
                SetEmpty();
                break;

            default:
                // Web parity: SharingTripsPage renders no dedicated trips-error surface — a failed query with
                // no cached rows leaves the list empty, so a hard failure folds into the empty state.
                SetEmpty();
                break;
        }
    }

    private void ApplySnapshot(IReadOnlyList<SharingTrip> trips, bool fetching)
    {
        // Web parity: allTrips.length === 0 ? <EmptyState> : <ul> — an empty list renders the empty state
        // regardless of freshness.
        if (trips.Count == 0)
        {
            SetEmpty();
            return;
        }

        IsFetching = fetching;
        State = SharingTripsState.Success;
        Display = SharingTripsProjection.Project(trips, SharingTripsState.Success, _units, _localizer, _clock());
        PruneSelection(trips);
    }

    private void SetLoading()
    {
        IsFetching = false;
        State = SharingTripsState.Loading;
        Display = SharingTripsProjection.Project(
            Array.Empty<SharingTrip>(), SharingTripsState.Loading, _units, _localizer, _clock());
    }

    private void SetEmpty()
    {
        IsFetching = false;
        State = SharingTripsState.Empty;
        Display = SharingTripsProjection.Project(
            Array.Empty<SharingTrip>(), SharingTripsState.Empty, _units, _localizer, _clock());
        SelectedTripId = null;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = SharingTripsProjection.Project(
                Array.Empty<SharingTrip>(), _state, _units, _localizer, _clock());
        }
    }

    private void PruneSelection(IReadOnlyList<SharingTrip> trips)
    {
        if (_selectedTripId is not { } id)
        {
            return;
        }

        bool present = false;
        foreach (var trip in trips)
        {
            if (trip.Id == id)
            {
                present = true;
                break;
            }
        }

        if (!present)
        {
            SelectedTripId = null;
        }
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
