using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LiveSignalsTable"/> view — the native port of
/// the web component's hook composition
/// (web/src/features/admin/components/live-signal-inspector/LiveSignalsTable.tsx). It drives the single
/// cache-then-network live-signal read through the <see cref="ILiveSignalsTableSource"/> (web
/// <c>useVehicleLiveSignals</c>), holds the client-side filter (web <c>useState</c>) and sort (web
/// <c>useSortToggle</c>) the component keeps locally, projects the snapshot through
/// <see cref="LiveSignalsProjection"/>, and exposes the section state + freshness so the view is a thin
/// renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class LiveSignalsTableViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILiveSignalsTableSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly long _vehicleId;

    private CancellationTokenSource? _cts;
    private IReadOnlyList<LiveSignalRow> _rows = Array.Empty<LiveSignalRow>();
    private bool _disposed;

    private string _filter = string.Empty;
    private LiveSignalSortKey _sortKey = LiveSignalSortKey.Name;
    private LiveSignalSortDirection _sortDir = LiveSignalSortDirection.Ascending;

    private LiveSignalsSectionState _state = LiveSignalsSectionState.Loading;
    private LiveSignalsDisplay _display = LiveSignalsDisplay.Empty;
    private bool _hasSignals;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, the vehicle id, localizer and (optional) clock.</summary>
    public LiveSignalsTableViewModel(
        ILiveSignalsTableSource source,
        long vehicleId,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _vehicleId = vehicleId;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The surface lifecycle state.</summary>
    public LiveSignalsSectionState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected (filtered + sorted) display rows.</summary>
    public LiveSignalsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True when the snapshot carried at least one signal (web <c>rows.length &gt; 0</c>).</summary>
    public bool HasSignals
    {
        get => _hasSignals;
        private set => Set(ref _hasSignals, value);
    }

    /// <summary>Last successful update timestamp.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last read failed.</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message (null when not errored).</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Load attempts (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    // ── Filter + sort (web useState / useSortToggle) ───────────────────────────────────────────────────

    /// <summary>The signal-name filter text (web <c>filter</c> state). Setting it re-projects without refetching.</summary>
    public string Filter => _filter;

    /// <summary>The active sort column (web <c>sortKey</c>).</summary>
    public LiveSignalSortKey SortKey => _sortKey;

    /// <summary>The active sort direction (web <c>sortDir</c>).</summary>
    public LiveSignalSortDirection SortDir => _sortDir;

    /// <summary>
    /// Apply a new filter (web <c>setFilter</c>). Pure client-side: it re-projects the cached rows rather
    /// than refetching, exactly as the web <c>useMemo</c> chain does.
    /// </summary>
    public void SetFilter(string filter)
    {
        ArgumentNullException.ThrowIfNull(filter);
        if (string.Equals(_filter, filter, StringComparison.Ordinal))
        {
            return;
        }

        _filter = filter;
        Raise(nameof(Filter));
        Reproject();
    }

    /// <summary>
    /// Toggle the sort for <paramref name="key"/> (web <c>useSortToggle.onSort</c>): clicking the active
    /// column flips the direction; clicking a different column selects it descending. Re-projects in place.
    /// </summary>
    public void ToggleSort(LiveSignalSortKey key)
    {
        if (_sortKey == key)
        {
            _sortDir = _sortDir == LiveSignalSortDirection.Ascending
                ? LiveSignalSortDirection.Descending
                : LiveSignalSortDirection.Ascending;
        }
        else
        {
            _sortKey = key;
            _sortDir = LiveSignalSortDirection.Descending;
        }

        Raise(nameof(SortKey));
        Raise(nameof(SortDir));
        Reproject();
    }

    // ── Localized copy (web t(...) strings) ────────────────────────────────────────────────────────────

    /// <summary>"Signal" column header.</summary>
    public string NameHeader => _localizer.GetString("admin.liveSignals.cols.name", "Signal");

    /// <summary>"Value" column header.</summary>
    public string ValueHeader => _localizer.GetString("admin.liveSignals.cols.value", "Value");

    /// <summary>"Last update" column header.</summary>
    public string TimestampHeader => _localizer.GetString("admin.liveSignals.cols.timestamp", "Last update");

    /// <summary>Filter field hint text (web filter input prompt).</summary>
    public string FilterHint => _localizer.GetString("admin.liveSignals.filterPlaceholder", "Filter signal names\u2026"); // parity:allow web i18n key admin.liveSignals.filterPlaceholder

    /// <summary>Filter field accessibility label (web <c>aria-label</c>).</summary>
    public string FilterAria => _localizer.GetString("admin.liveSignals.filterAria", "Filter signals");

    /// <summary>Empty-state title (no signals cached).</summary>
    public string EmptyTitle => _localizer.GetString("admin.liveSignals.empty.title", "No live signals cached");

    /// <summary>Empty-state message (no signals cached).</summary>
    public string EmptyMessage => _localizer.GetString(
        "admin.liveSignals.empty.message",
        "Redis has no live snapshot for this vehicle yet. Confirm the vehicle is online and publishing.");

    /// <summary>In-table message while the first snapshot loads.</summary>
    public string LoadingLabel => _localizer.GetString("admin.liveSignals.table.loading", "Loading\u2026");

    /// <summary>In-table message when no signal matches the active filter.</summary>
    public string FilteredEmptyMessage =>
        _localizer.GetString("admin.liveSignals.table.filtered", "No signals match this filter.");

    /// <summary>Retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("admin.liveSignals.retry", "Retry");

    // ── Commands ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Run (or re-run) the cache-then-network live-signal load.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;
        if (_rows.Count == 0)
        {
            State = LiveSignalsSectionState.Loading;
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamLiveSignalsAsync(_vehicleId, cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>
    /// Refresh the snapshot on the host page's cadence (web parity — the page owns the 1 s polling and this
    /// surface just re-reads). Identical to <see cref="LoadAsync"/>; named for caller intent.
    /// </summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Retry the surface after a failure.</summary>
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

    // ── Internals ──────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<IReadOnlyList<LiveSignalRow>> result)
    {
        _rows = NextRows(result, _rows);
        HasSignals = _rows.Count > 0;
        Reproject();

        var outcome = Classify(result, _rows.Count);
        State = outcome.State;
        IsFetching = outcome.IsFetching;
        IsError = outcome.IsError;
        IsStale = outcome.IsStale;
        ErrorMessage = outcome.ErrorMessage;
        if (outcome.UpdatedAt is { } ts)
        {
            UpdatedAt = ts;
        }
    }

    private void Reproject() =>
        Display = LiveSignalsProjection.Project(_rows, _filter, _sortKey, _sortDir, _localizer, _clock());

    private SectionOutcome Classify(RepositoryResult<IReadOnlyList<LiveSignalRow>> result, int rowCount)
    {
        bool hasRows = rowCount > 0;
        return result.Status switch
        {
            LoadStatus.Loading => hasRows
                ? new SectionOutcome(LiveSignalsSectionState.Loaded, true, false, false, null, null)
                : new SectionOutcome(LiveSignalsSectionState.Loading, true, false, false, null, null),

            LoadStatus.Cached => hasRows
                ? new SectionOutcome(StaleOrLoaded(result.IsStale), true, false, result.IsStale, null, result.FetchedAt)
                : new SectionOutcome(LiveSignalsSectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Refreshing => hasRows
                ? new SectionOutcome(StaleOrLoaded(result.IsStale), true, false, result.IsStale, null, result.FetchedAt)
                : new SectionOutcome(LiveSignalsSectionState.Empty, true, false, false, null, result.FetchedAt),

            LoadStatus.Loaded => hasRows
                ? new SectionOutcome(LiveSignalsSectionState.Loaded, false, false, false, null, result.FetchedAt)
                : new SectionOutcome(LiveSignalsSectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Empty => new SectionOutcome(
                LiveSignalsSectionState.Empty, false, false, false, null, result.FetchedAt),

            LoadStatus.Offline => hasRows
                ? new SectionOutcome(LiveSignalsSectionState.Offline, false, true, true, ErrorTextFor(result.Error), result.FetchedAt)
                : new SectionOutcome(LiveSignalsSectionState.Error, false, true, false, ErrorTextFor(result.Error), result.FetchedAt),

            _ => new SectionOutcome(
                LiveSignalsSectionState.Error, false, true, false, ErrorTextFor(result.Error), null),
        };
    }

    private static LiveSignalsSectionState StaleOrLoaded(bool stale) =>
        stale ? LiveSignalsSectionState.Stale : LiveSignalsSectionState.Loaded;

    private static IReadOnlyList<LiveSignalRow> NextRows(
        RepositoryResult<IReadOnlyList<LiveSignalRow>> result,
        IReadOnlyList<LiveSignalRow> previous) =>
        result.Status switch
        {
            LoadStatus.Loading => previous,                                  // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<LiveSignalRow>(), // resolved with nothing to show
            _ => result.Value ?? previous,                                  // cached / refreshing / loaded / offline carry rows
        };

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "admin.liveSignals.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "admin.liveSignals.error.offline",
            _ => "admin.liveSignals.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view live signals",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached snapshot",
            _ => "Couldn't load live signals",
        };

        return _localizer.GetString(key, fallback);
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

    private readonly record struct SectionOutcome(
        LiveSignalsSectionState State,
        bool IsFetching,
        bool IsError,
        bool IsStale,
        string? ErrorMessage,
        DateTimeOffset? UpdatedAt);
}
