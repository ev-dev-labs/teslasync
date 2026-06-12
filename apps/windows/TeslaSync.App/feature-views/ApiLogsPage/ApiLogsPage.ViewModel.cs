using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>The query the <c>ApiLogsPage</c> feed answers — the active filter set, the zero-based page and the page size.</summary>
public sealed record ApiLogsQuery(ApiLogsFilter Filter, int Page, int Limit);

/// <summary>One resolved page of API logs plus the aggregate stats and the total row count (the web query payloads).</summary>
public sealed record ApiLogsSnapshot(ApiCallLogStats? Stats, IReadOnlyList<ApiCallLog> Logs, int Total)
{
    /// <summary>An empty, resolved snapshot (no stats, no rows) — the default local-state feed result.</summary>
    public static ApiLogsSnapshot Empty { get; } = new(null, Array.Empty<ApiCallLog>(), 0);
}

/// <summary>
/// The data port the <see cref="ApiLogsPageViewModel"/> reads a page of API logs through. The manifest models this
/// page as rendering from local / navigation state (there is no generated client endpoint for <c>/api-logs</c>), so
/// the page is driven by an injected feed: the default <see cref="EmptyApiLogsFeed"/> resolves to the empty state,
/// and a host can supply a feed that answers from a navigation payload or a future contract endpoint without
/// touching the view.
/// </summary>
public interface IApiLogsFeed
{
    /// <summary>Resolve the snapshot for <paramref name="query"/>.</summary>
    Task<ApiLogsSnapshot> FetchAsync(ApiLogsQuery query, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every query to the empty snapshot (the empty data state).</summary>
public sealed class EmptyApiLogsFeed : IApiLogsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyApiLogsFeed Instance { get; } = new();

    private EmptyApiLogsFeed()
    {
    }

    /// <inheritdoc />
    public Task<ApiLogsSnapshot> FetchAsync(ApiLogsQuery query, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ApiLogsSnapshot.Empty);
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ApiLogsPage</c> view — the native port of the web page's data
/// flow (web/src/features/admin/pages/ApiLogsPage.tsx). It owns the URL-equivalent state (filters, page, expanded
/// row), reads each page through the injected <see cref="IApiLogsFeed"/>, and projects the result through
/// <see cref="ApiLogsProjection"/> so the view is a thin renderer. It surfaces the four web data states
/// (loading / empty / error / success) plus an in-flight flag; observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class ApiLogsPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IApiLogsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly ApiLogsDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private ApiCallLogStats? _stats;
    private IReadOnlyList<ApiCallLog> _logs = Array.Empty<ApiCallLog>();
    private int _total;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private ApiLogsFilter _filter = ApiLogsFilter.Empty;
    private int _page;
    private long? _expandedId;

    private ApiLogsState _state = ApiLogsState.Loading;
    private ApiLogsDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The page-of-logs data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ApiLogsPageViewModel(
        IApiLogsFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        ApiLogsDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new ApiLogsDiagnostics();
        _display = ApiLogsProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public ApiLogsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ApiLogsDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>apiLogs.title</c>).</summary>
    public string Title => ApiLogsRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>apiLogs.subtitle</c>).</summary>
    public string Subtitle => ApiLogsRegistration.Subtitle(_localizer);

    /// <summary>The localized expanded-detail section headings (web JsonViewer labels + detail headings).</summary>
    public ApiLogDetailLabels DetailLabels => ApiLogsProjection.DetailLabels(_localizer);

    /// <summary>The current expanded row id (web <c>expandedId</c>), or null when none is expanded.</summary>
    public long? ExpandedId => _expandedId;

    /// <summary>The current zero-based page index (web <c>page</c>).</summary>
    public int Page => _page;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the page-of-logs load for the current filter / page.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_logs.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(BuildQuery(), cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _stats = snapshot.Stats;
            _logs = snapshot.Logs ?? Array.Empty<ApiCallLog>();
            _total = snapshot.Total;
            _hasError = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (Exception ex)
        {
            // web anyError: surface the failure banner; the table falls back to its empty branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _logs = Array.Empty<ApiCallLog>();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the current page (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Select a service filter from the dropdown or a by-service chip (web <c>selectService</c>); resets the page.</summary>
    public Task SetServiceAsync(string service, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Service = service ?? string.Empty }, cancellationToken);

    /// <summary>Set the HTTP-method filter (web <c>setFilter('method', …)</c>); resets the page.</summary>
    public Task SetMethodAsync(string method, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Method = method ?? string.Empty }, cancellationToken);

    /// <summary>Set the status-class filter (web <c>setFilter('status', …)</c>); resets the page.</summary>
    public Task SetStatusAsync(string status, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Status = status ?? string.Empty }, cancellationToken);

    /// <summary>Set the endpoint search filter (web <c>setFilter('endpoint', …)</c>); resets the page.</summary>
    public Task SetEndpointAsync(string endpoint, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Endpoint = endpoint ?? string.Empty }, cancellationToken);

    /// <summary>Set the date range (web <c>RangePicker.onChange</c>); resets the page.</summary>
    public Task SetRangeAsync(string start, string end, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Start = start ?? string.Empty, End = end ?? string.Empty }, cancellationToken);

    /// <summary>Clear all chip/dropdown filters (web <c>clearFilters</c>); resets the page.</summary>
    public Task ClearFiltersAsync(CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Service = string.Empty, Method = string.Empty, Status = string.Empty, Endpoint = string.Empty }, cancellationToken);

    /// <summary>Go to a specific zero-based page (web <c>setPage</c>); clamped to the valid range.</summary>
    public Task SetPageAsync(int page, CancellationToken cancellationToken = default)
    {
        _page = Math.Max(0, page);
        _expandedId = null;
        return LoadAsync(cancellationToken);
    }

    /// <summary>Go to the next page (web <c>Next</c>).</summary>
    public Task NextPageAsync(CancellationToken cancellationToken = default) => SetPageAsync(_page + 1, cancellationToken);

    /// <summary>Go to the previous page (web <c>Previous</c>).</summary>
    public Task PreviousPageAsync(CancellationToken cancellationToken = default) => SetPageAsync(_page - 1, cancellationToken);

    /// <summary>Toggle a row's expanded detail (web <c>setExpandedId</c>); re-projects without a reload.</summary>
    public void ToggleExpanded(long id)
    {
        _expandedId = _expandedId == id ? null : id;
        Reproject();
    }

    /// <summary>The export JSON document for the current page of logs (web <c>handleExport</c>).</summary>
    public string ExportJson() => ApiLogsExport.ToJson(_logs);

    /// <summary>The suggested export file name (web download name).</summary>
    public string ExportFileName() => ApiLogsExport.FileName(_clock());

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
    }

    private Task ApplyFilterAsync(ApiLogsFilter filter, CancellationToken cancellationToken)
    {
        _filter = filter;
        _page = 0;
        _expandedId = null;
        return LoadAsync(cancellationToken);
    }

    private ApiLogsQuery BuildQuery() => new(_filter, _page, ApiLogsRegistration.PageSize);

    private ApiLogsModel BuildModel() => new(
        Stats: _stats,
        Logs: _logs,
        Total: _total,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Filter: _filter,
        Page: _page,
        Limit: ApiLogsRegistration.PageSize,
        ExpandedId: _expandedId);

    private void Reproject()
    {
        var display = ApiLogsProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
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

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}
