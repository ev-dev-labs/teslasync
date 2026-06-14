using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DrivesListPage"/> view — the native port of the web
/// page's hook + URL-state composition (web/src/features/driving/pages/DrivesListPage.tsx). It consumes the
/// cache-then-network <see cref="IDrivesListSource"/> (the page's <c>useDrives(vehicleId)</c> read), folds the
/// snapshot through <see cref="DrivesListProjection"/> with the active units + filters, and exposes the
/// mutually-exclusive <see cref="State"/> + the render-ready <see cref="Display"/> so the view is a thin renderer.
/// It owns the page's client-side date range, collection switching, search, sort, paging and bulk selection (all
/// re-project without refetching), plus the bulk-delete mutation (web <c>useBulkDeleteDrives</c>) and the CSV / JSON
/// export rows. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DrivesListPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDrivesListSource _source;
    private readonly IDriveBulkDeleteService _bulkDelete;
    private readonly ILocalizer _localizer;
    private readonly DrivesListDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private UnitPref _units;
    private double _costPerKwh;
    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private IReadOnlyList<DriveListItem> _drives = Array.Empty<DriveListItem>();
    private HashSet<long> _selected = new();
    private bool _disposed;

    private DrivesListState _state = DrivesListState.Loading;
    private DrivesListFilters _filters;
    private DrivesListDisplay _display;
    private bool _isFetching;
    private int _attempts;

    /// <summary>Creates the holder over its data source, bulk-delete port, localizer, units, currency and clock.</summary>
    /// <param name="source">The cache-then-network drives port.</param>
    /// <param name="bulkDelete">The bulk-delete mutation port (web <c>useBulkDeleteDrives</c>).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>unitPrefs</c>); null defaults to metric.</param>
    /// <param name="costPerKwh">The active cost-per-kWh (web <c>costPerKwh</c>); ≤0 uses the projection default.</param>
    /// <param name="currencySymbol">The active currency symbol (web <c>currencySymbol</c>); null defaults to <c>$</c>.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The clock used for the default range; null uses the local wall clock.</param>
    public DrivesListPageViewModel(
        IDrivesListSource source,
        IDriveBulkDeleteService bulkDelete,
        ILocalizer localizer,
        UnitPref? units = null,
        double costPerKwh = 0,
        string? currencySymbol = null,
        DrivesListDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(bulkDelete);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _bulkDelete = bulkDelete;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _costPerKwh = costPerKwh;
        _currencySymbol = string.IsNullOrEmpty(currencySymbol) ? "$" : currencySymbol;
        _diagnostics = diagnostics ?? new DrivesListDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _filters = DrivesListFilters.Default(_clock());
        _display = DrivesListProjection.Project(
            Array.Empty<DriveListItem>(), DrivesListState.Loading, _filters, _units, _localizer, _costPerKwh, _currencySymbol, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive drives-list lifecycle state.</summary>
    public DrivesListState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public DrivesListDisplay Display
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

    /// <summary>The active interactive filters (date range, search, collection, trend, sort, page, selection).</summary>
    public DrivesListFilters Filters => _filters;

    /// <summary>The full drive snapshot currently shown (drives the export — web <c>sortedDrives</c> source).</summary>
    public IReadOnlyList<DriveListItem> CurrentDrives => _drives;

    /// <summary>The user's unit preference; reassigning re-projects the current drives in the new units.</summary>
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

    /// <summary>The active cost-per-kWh; reassigning re-projects the cost-bearing surfaces.</summary>
    public double CostPerKwh
    {
        get => _costPerKwh;
        set
        {
            if (Math.Abs(_costPerKwh - value) < double.Epsilon)
            {
                return;
            }

            _costPerKwh = value;
            Raise(nameof(CostPerKwh));
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
    /// <param name="value">The collection value (all / anomalies / notable / commutes / tagged).</param>
    public void SetCollection(string? value)
    {
        _filters = _filters with { Collection = ParseCollection(value), Page = 1 };
        PruneSelection();
        Reproject();
    }

    /// <summary>Set the active sort field (web <c>setSortBy</c>).</summary>
    /// <param name="value">The sort field value (date / distance / efficiency).</param>
    public void SetSort(string? value)
    {
        _filters = _filters with { SortField = ParseSort(value) };
        Reproject();
    }

    /// <summary>Set the active trend metric (web <c>setTrendMetric</c>).</summary>
    /// <param name="metric">The trend metric key (drives / distance / score / efficiency / cost).</param>
    public void SetTrendMetric(string? metric)
    {
        _filters = _filters with { TrendMetric = string.IsNullOrEmpty(metric) ? "drives" : metric };
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

    /// <summary>Navigate the drive list to <paramref name="page"/> (web <c>setPage</c>); re-slices without refetching.</summary>
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

    /// <summary>Toggle a drive's bulk selection (web <c>toggleDriveSelected</c>).</summary>
    /// <param name="id">The drive id.</param>
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

    /// <summary>The export rows matching the current filters + sort (web export href rows).</summary>
    /// <param name="selectedOnly">When true, restrict to the bulk-selected drives.</param>
    /// <returns>The filtered, sorted drives to export.</returns>
    public IReadOnlyList<DriveListItem> ExportRows(bool selectedOnly)
    {
        var sorted = DrivesListProjection.FilterAndSort(_drives, _filters, _units.Distance);
        if (!selectedOnly)
        {
            return sorted;
        }

        return sorted.Where(d => _selected.Contains(d.Id)).ToList();
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

    /// <summary>Retry after a hard failure — re-runs the load from the top (web error retry).</summary>
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Delete the bulk-selected drives (web <c>bulkDeleteDrivesMut.mutateAsync</c>), then clear the selection and
    /// refresh. A no-op when nothing is selected.
    /// </summary>
    /// <param name="cancellationToken">Cancels the delete + refresh.</param>
    /// <returns>The number of drives deleted.</returns>
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

    private bool HasContent() => _state == DrivesListState.Success;

    private void Apply(RepositoryResult<IReadOnlyList<DriveListItem>> result)
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
                // Web parity: a failed query with no cached rows surfaces the retriable error surface.
                if (!HasContent())
                {
                    SetError();
                }

                break;
        }
    }

    private void ApplySnapshot(IReadOnlyList<DriveListItem> drives, bool fetching)
    {
        if (drives.Count == 0)
        {
            SetEmpty();
            return;
        }

        _drives = drives;
        PruneSelection();
        IsFetching = fetching;
        State = DrivesListState.Success;
        Reproject();
    }

    private void SetLoading()
    {
        _drives = Array.Empty<DriveListItem>();
        IsFetching = false;
        State = DrivesListState.Loading;
        Reproject();
    }

    private void SetEmpty()
    {
        _drives = Array.Empty<DriveListItem>();
        IsFetching = false;
        State = DrivesListState.Empty;
        Reproject();
    }

    private void SetError()
    {
        _drives = Array.Empty<DriveListItem>();
        IsFetching = false;
        State = DrivesListState.Error;
        Reproject();
    }

    private void PruneSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        var visible = new HashSet<long>(DrivesListProjection.FilterAndSort(_drives, _filters, _units.Distance).Select(d => d.Id));
        var pruned = new HashSet<long>(_selected.Where(visible.Contains));
        if (pruned.Count != _selected.Count)
        {
            _selected = pruned;
            _filters = _filters with { SelectedIds = pruned };
        }
    }

    private void Reproject() =>
        Display = DrivesListProjection.Project(_drives, _state, _filters, _units, _localizer, _costPerKwh, _currencySymbol, _clock());

    private static DriveCollectionKind ParseCollection(string? value) => value switch
    {
        "anomalies" => DriveCollectionKind.Anomalies,
        "notable" => DriveCollectionKind.Notable,
        "commutes" => DriveCollectionKind.Commutes,
        "tagged" => DriveCollectionKind.Tagged,
        _ => DriveCollectionKind.All,
    };

    private static DriveSortField ParseSort(string? value) => value switch
    {
        "distance" => DriveSortField.Distance,
        "efficiency" => DriveSortField.Efficiency,
        _ => DriveSortField.Date,
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
