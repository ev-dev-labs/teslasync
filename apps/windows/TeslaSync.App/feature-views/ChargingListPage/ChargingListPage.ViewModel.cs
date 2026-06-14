using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ChargingListPage"/> view — the native port of the web
/// page's hook + URL-state composition (web/src/features/charging/pages/ChargingListPage.tsx). It consumes the
/// cache-then-network <see cref="IChargingListSource"/> (the page's <c>useChargingSessionsPaginated(...)</c> read),
/// folds the snapshot through <see cref="ChargingListProjection"/> with the active units + filters, and exposes the
/// mutually-exclusive <see cref="State"/> + the render-ready <see cref="Display"/> so the view is a thin renderer.
/// It owns the page's client-side filtering, sorting, collection switching, search, density, paging and bulk
/// selection (all re-project without refetching), plus the bulk-delete mutation
/// (web <c>useBulkDeleteCharging</c>) and the CSV / JSON export rows. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class ChargingListPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IChargingListSource _source;
    private readonly IChargingBulkDeleteService _bulkDelete;
    private readonly ILocalizer _localizer;
    private readonly ChargingListDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private UnitPref _units;
    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private IReadOnlyList<ChargingListSession> _sessions = Array.Empty<ChargingListSession>();
    private HashSet<long> _selected = new();
    private bool _disposed;

    private ChargingListState _state = ChargingListState.Loading;
    private ChargingListFilters _filters;
    private ChargingListDisplay _display;
    private bool _isFetching;
    private int _attempts;

    /// <summary>Creates the holder over its data source, bulk-delete port, localizer, units, currency and clock.</summary>
    /// <param name="source">The cache-then-network charging-sessions port.</param>
    /// <param name="bulkDelete">The bulk-delete mutation port (web <c>useBulkDeleteCharging</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>unitPrefs</c>); null defaults to metric.</param>
    /// <param name="currencySymbol">The active currency symbol (web <c>currencySymbol</c>); null defaults to <c>$</c>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock used for the default range; null uses the local wall clock.</param>
    public ChargingListPageViewModel(
        IChargingListSource source,
        IChargingBulkDeleteService bulkDelete,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null,
        ChargingListDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(bulkDelete);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _bulkDelete = bulkDelete;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrEmpty(currencySymbol) ? "$" : currencySymbol;
        _diagnostics = diagnostics ?? new ChargingListDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _filters = ChargingListFilters.Default(_clock());
        _display = ChargingListProjection.Project(
            Array.Empty<ChargingListSession>(), ChargingListState.Loading, _filters, _units, _localizer, _currencySymbol, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive charging-list lifecycle state.</summary>
    public ChargingListState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public ChargingListDisplay Display
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

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The active interactive filters (date range, search, collection, sort, density, page, selection).</summary>
    public ChargingListFilters Filters => _filters;

    /// <summary>The full session snapshot currently shown (drives the export — web <c>sortedSessions</c> source).</summary>
    public IReadOnlyList<ChargingListSession> CurrentSessions => _sessions;

    /// <summary>The user's unit preference; reassigning re-projects the current sessions in the new units.</summary>
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

    /// <summary>Set the search query (web <c>setUrlBatch({ q, page: null })</c>); resets the page + prunes selection.</summary>
    /// <param name="query">The raw search text.</param>
    public void SetSearch(string? query)
    {
        _filters = _filters with { Search = query ?? string.Empty, Page = 1 };
        PruneSelection();
        Reproject();
    }

    /// <summary>Switch the active collection (web <c>setUrlBatch({ coll, page: null })</c>); resets the page.</summary>
    /// <param name="value">The collection value (all / home / supercharger / dc / free / anomalies / notable / tagged).</param>
    public void SetCollection(string? value)
    {
        _filters = _filters with { Collection = ParseCollection(value), Page = 1 };
        PruneSelection();
        Reproject();
    }

    /// <summary>Set the active sort field (web <c>setSortBy</c>).</summary>
    /// <param name="value">The sort field value (date / energy / cost / duration / power).</param>
    public void SetSort(string? value)
    {
        _filters = _filters with { SortField = ParseSort(value) };
        Reproject();
    }

    /// <summary>Toggle the sort direction (web <c>setSortDesc</c>).</summary>
    public void ToggleSortDirection()
    {
        _filters = _filters with { SortDescending = !_filters.SortDescending };
        Reproject();
    }

    /// <summary>Set the list density (web <c>setDensity</c>).</summary>
    /// <param name="density">The density variant.</param>
    public void SetDensity(ChargingCardDensity density)
    {
        _filters = _filters with { Density = density };
        Reproject();
    }

    /// <summary>Set the active trend metric (web <c>setTrendMetric</c>).</summary>
    /// <param name="metric">The trend metric key (sessions / energy / cost / power).</param>
    public void SetTrendMetric(string? metric)
    {
        _filters = _filters with { TrendMetric = string.IsNullOrEmpty(metric) ? "sessions" : metric };
        Reproject();
    }

    /// <summary>Set the inclusive date range (web <c>setUrlBatch({ from, to, page: null })</c>); resets the page.</summary>
    /// <param name="startDate">The inclusive start day (<c>yyyy-MM-dd</c>).</param>
    /// <param name="endDate">The inclusive end day (<c>yyyy-MM-dd</c>).</param>
    public void SetDateRange(string startDate, string endDate)
    {
        ArgumentException.ThrowIfNullOrEmpty(startDate);
        ArgumentException.ThrowIfNullOrEmpty(endDate);
        _filters = _filters with { StartDate = startDate, EndDate = endDate, Page = 1 };
        PruneSelection();
        Reproject();
    }

    /// <summary>Navigate the session list to <paramref name="page"/> (web <c>setPage</c>); re-slices without refetching.</summary>
    /// <param name="page">The 1-based target page (clamped to the available range).</param>
    public void GoToPage(int page)
    {
        int target = Math.Max(1, page);
        if (target == _filters.Page)
        {
            return;
        }

        _filters = _filters with { Page = target };
        Reproject();
    }

    /// <summary>Toggle a session's bulk selection (web <c>toggleSessionSelected</c>).</summary>
    /// <param name="id">The session id.</param>
    /// <param name="selected">Whether the row is now selected.</param>
    public void ToggleSelection(long id, bool selected)
    {
        var next = new HashSet<long>(_selected);
        if (selected)
        {
            next.Add(id);
        }
        else
        {
            next.Remove(id);
        }

        _selected = next;
        _filters = _filters with { SelectedIds = next };
        Reproject();
    }

    /// <summary>Clear the bulk selection (web <c>clearBulk</c>).</summary>
    public void ClearSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        _selected = new HashSet<long>();
        _filters = _filters with { SelectedIds = _selected };
        Reproject();
    }

    /// <summary>The export rows matching the current filters + sort (web <c>exportRows</c>).</summary>
    /// <param name="selectedOnly">When true, restrict to the bulk-selected sessions.</param>
    /// <returns>The filtered, sorted sessions to export.</returns>
    public IReadOnlyList<ChargingListSession> ExportRows(bool selectedOnly)
    {
        var sorted = ChargingListProjection.FilterAndSort(_sessions, _filters, _currencySymbol);
        if (!selectedOnly)
        {
            return sorted;
        }

        return sorted.Where(s => _selected.Contains(s.Id)).ToList();
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the loading skeletons only when nothing is already
    /// resolved (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
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

    /// <summary>Refresh the current snapshot (web auto-refetch / pull-to-refresh / post-delete invalidation).</summary>
    /// <param name="cancellationToken">Cancels the refresh.</param>
    /// <returns>A task that completes when the refreshed load's sequence is exhausted.</returns>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Retry after a hard failure — re-runs the load from the top (web <c>QueryError</c> retry).</summary>
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Delete the bulk-selected sessions (web <c>bulkDeleteMut.mutateAsync</c>), then clear the selection and
    /// refresh. A no-op when nothing is selected.
    /// </summary>
    /// <param name="cancellationToken">Cancels the delete + refresh.</param>
    /// <returns>The number of sessions deleted.</returns>
    public async Task<int> DeleteSelectedAsync(CancellationToken cancellationToken = default)
    {
        var ids = _selected.ToList();
        if (ids.Count == 0)
        {
            return 0;
        }

        var deleted = await _bulkDelete.DeleteAsync(ids, cancellationToken).ConfigureAwait(false);
        ClearSelection();
        await RefreshAsync(cancellationToken).ConfigureAwait(false);
        return deleted;
    }

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

    private bool HasContent() => _state == ChargingListState.Success;

    private void Apply(RepositoryResult<IReadOnlyList<ChargingListSession>> result)
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
                // Web parity: a failed query with no cached rows surfaces the retriable QueryError surface.
                if (!HasContent())
                {
                    SetError();
                }

                break;
        }
    }

    private void ApplySnapshot(IReadOnlyList<ChargingListSession> sessions, bool fetching)
    {
        if (sessions.Count == 0)
        {
            SetEmpty();
            return;
        }

        _sessions = sessions;
        PruneSelection();
        IsFetching = fetching;
        State = ChargingListState.Success;
        Reproject();
    }

    private void SetLoading()
    {
        _sessions = Array.Empty<ChargingListSession>();
        IsFetching = false;
        State = ChargingListState.Loading;
        Reproject();
    }

    private void SetEmpty()
    {
        _sessions = Array.Empty<ChargingListSession>();
        IsFetching = false;
        State = ChargingListState.Empty;
        Reproject();
    }

    private void SetError()
    {
        _sessions = Array.Empty<ChargingListSession>();
        IsFetching = false;
        State = ChargingListState.Error;
        Reproject();
    }

    private void PruneSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        var visible = new HashSet<long>(ChargingListProjection.FilterAndSort(_sessions, _filters, _currencySymbol).Select(s => s.Id));
        var pruned = new HashSet<long>(_selected.Where(visible.Contains));
        if (pruned.Count != _selected.Count)
        {
            _selected = pruned;
            _filters = _filters with { SelectedIds = pruned };
        }
    }

    private void Reproject() =>
        Display = ChargingListProjection.Project(_sessions, _state, _filters, _units, _localizer, _currencySymbol, _clock());

    private static ChargingCollectionKind ParseCollection(string? value) => value switch
    {
        "home" => ChargingCollectionKind.Home,
        "supercharger" => ChargingCollectionKind.Supercharger,
        "dc" => ChargingCollectionKind.Dc,
        "free" => ChargingCollectionKind.Free,
        "anomalies" => ChargingCollectionKind.Anomalies,
        "notable" => ChargingCollectionKind.Notable,
        "tagged" => ChargingCollectionKind.Tagged,
        _ => ChargingCollectionKind.All,
    };

    private static ChargingSortField ParseSort(string? value) => value switch
    {
        "energy" => ChargingSortField.Energy,
        "cost" => ChargingSortField.Cost,
        "duration" => ChargingSortField.Duration,
        "power" => ChargingSortField.Power,
        _ => ChargingSortField.Date,
    };

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
