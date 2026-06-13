using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Trips;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TripListPage"/> view — the native port of the web
/// page's hook composition (web/src/features/trips/pages/TripListPage.tsx). It consumes the cache-then-network
/// <see cref="ITripListSource"/> (the page's <c>useTrips(...)</c> read), applies the web empty gate (an empty
/// trip list renders the page-level empty state, mirroring <c>allTrips.length === 0</c>), folds the rest through
/// <see cref="TripListProjection"/> with the active units and display page, and exposes the mutually-exclusive
/// <see cref="State"/> plus the in-flight flag so the view is a thin renderer. It also owns the page's client
/// side list paging (web <c>Pagination</c>): <see cref="GoToPage"/> re-slices the rows without refetching, while
/// the summary stats and the top-trips chart always fold the full snapshot. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class TripListPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITripListSource _source;
    private readonly ILocalizer _localizer;
    private readonly TripListDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private IReadOnlyList<TripListItem> _trips = Array.Empty<TripListItem>();
    private bool _disposed;

    private TripListState _state = TripListState.Loading;
    private TripListDisplay _display;
    private bool _isFetching;
    private int _page = 1;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, units, diagnostics and clock.</summary>
    /// <param name="source">The cache-then-network trips port.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>unitPrefs</c>); null defaults to metric.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock used for date formatting; null uses the local wall clock.</param>
    public TripListPageViewModel(
        ITripListSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        TripListDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new TripListDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = TripListProjection.Project(
            Array.Empty<TripListItem>(), TripListState.Loading, 1, _units, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive trips lifecycle state.</summary>
    public TripListState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public TripListDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a background refresh is in flight (keeps content visible while refreshing).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The 1-based display page of the trip list (web <c>page</c>).</summary>
    public int Page => _page;

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The full trip snapshot currently shown (drives the CSV / JSON export — web <c>allTrips</c>).</summary>
    public IReadOnlyList<TripListItem> CurrentTrips => _trips;

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

    /// <summary>Navigate the trip list to <paramref name="page"/> (web <c>setPage</c>); re-slices without refetching.</summary>
    /// <param name="page">The 1-based target page (clamped to the available range).</param>
    public void GoToPage(int page)
    {
        int target = Math.Max(1, page);
        if (target == _page)
        {
            return;
        }

        _page = target;
        Raise(nameof(Page));
        Reproject();
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the loading skeletons only when nothing is
    /// already resolved (otherwise keeps content while refreshing), and folds every emission into
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

    /// <summary>Refresh the current snapshot (web auto-refetch / pull-to-refresh).</summary>
    /// <returns>A task that completes when the refreshed load's sequence is exhausted.</returns>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

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

    private bool HasContent() => _state == TripListState.Success;

    private void Apply(RepositoryResult<IReadOnlyList<TripListItem>> result)
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
            case LoadStatus.Loaded:
            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, fetching: false);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, fetching: true);
                break;

            case LoadStatus.Empty:
                SetEmpty();
                break;

            default:
                // Web parity: TripListPage renders no dedicated trips-error surface — a failed query with no
                // cached rows leaves the list empty (safeArray default), so a hard failure folds into empty.
                SetEmpty();
                break;
        }
    }

    private void ApplySnapshot(IReadOnlyList<TripListItem> trips, bool fetching)
    {
        // Web parity: allTrips.length === 0 ? <EmptyState> : <stack> — an empty list renders the empty state
        // regardless of freshness.
        if (trips.Count == 0)
        {
            SetEmpty();
            return;
        }

        _trips = trips;
        IsFetching = fetching;
        State = TripListState.Success;
        Display = TripListProjection.Project(trips, TripListState.Success, _page, _units, _localizer, _clock());
        // The projection clamps the page to the available range; mirror that back so the pager stays in sync.
        if (Display.Page != _page)
        {
            _page = Display.Page;
            Raise(nameof(Page));
        }
    }

    private void SetLoading()
    {
        _trips = Array.Empty<TripListItem>();
        IsFetching = false;
        State = TripListState.Loading;
        Display = TripListProjection.Project(
            Array.Empty<TripListItem>(), TripListState.Loading, _page, _units, _localizer, _clock());
    }

    private void SetEmpty()
    {
        _trips = Array.Empty<TripListItem>();
        _page = 1;
        IsFetching = false;
        State = TripListState.Empty;
        Display = TripListProjection.Project(
            Array.Empty<TripListItem>(), TripListState.Empty, 1, _units, _localizer, _clock());
    }

    private void Reproject() =>
        Display = TripListProjection.Project(_trips, _state, _page, _units, _localizer, _clock());

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
