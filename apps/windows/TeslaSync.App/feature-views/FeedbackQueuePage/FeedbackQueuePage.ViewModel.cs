using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>FeedbackQueuePage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/FeedbackQueuePage.tsx). It owns the URL-equivalent state (status /
/// category filters, page, expanded row), reads each page through the injected <see cref="IFeedbackQueueFeed"/>
/// (web <c>useFeedbackList</c>), writes row updates back through the same port (web <c>useUpdateFeedback</c>), and
/// projects the result through <see cref="FeedbackQueueProjection"/> so the view is a thin renderer. It surfaces
/// the four web data states (loading / empty / error / success) plus an in-flight flag; observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class FeedbackQueuePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFeedbackQueueFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly FeedbackQueueDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<FeedbackEntry> _items = Array.Empty<FeedbackEntry>();
    private int _total;
    private bool _githubBridgeEnabled;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private FeedbackFilter _filter = FeedbackFilter.Empty;
    private int _page;
    private long? _expandedId;

    private FeedbackQueueState _state = FeedbackQueueState.Loading;
    private FeedbackQueueDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The page-of-feedback data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public FeedbackQueuePageViewModel(
        IFeedbackQueueFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        FeedbackQueueDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new FeedbackQueueDiagnostics();
        _display = FeedbackQueueProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public FeedbackQueueState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public FeedbackQueueDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch or update is in flight (web <c>isFetching</c> / mutation pending).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>feedback.queue.title</c>).</summary>
    public string Title => FeedbackQueueRegistration.Title(_localizer);

    /// <summary>The current expanded row id (web <c>expandedId</c>), or null when none is expanded.</summary>
    public long? ExpandedId => _expandedId;

    /// <summary>The current zero-based page index (web <c>page</c>).</summary>
    public int Page => _page;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the page-of-feedback load for the current filter / page.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_items.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(BuildQuery(), cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _items = snapshot.Items ?? Array.Empty<FeedbackEntry>();
            _total = snapshot.Total;
            _githubBridgeEnabled = snapshot.GithubBridgeEnabled;
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
            // web isError: surface the query-error region; the table falls back to its empty branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _items = Array.Empty<FeedbackEntry>();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the current page (web manual Refresh button / query refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Set the status filter (web <c>setStatusFilter</c>); resets the page (web <c>setPage(0)</c>).</summary>
    public Task SetStatusFilterAsync(string status, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Status = status ?? string.Empty }, cancellationToken);

    /// <summary>Set the category filter (web <c>setCategoryFilter</c>); resets the page (web <c>setPage(0)</c>).</summary>
    public Task SetCategoryFilterAsync(string category, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Category = category ?? string.Empty }, cancellationToken);

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

    /// <summary>Toggle a row's expanded detail (web <c>DataTable</c> expand); re-projects without a reload.</summary>
    public void ToggleExpanded(long id)
    {
        _expandedId = _expandedId == id ? null : id;
        Reproject();
    }

    /// <summary>Change a row's status (web <c>onUpdate({ id, update: { status } })</c>); reloads on success.</summary>
    public Task UpdateStatusAsync(long id, string status, CancellationToken cancellationToken = default) =>
        UpdateAsync(id, new FeedbackUpdate(Status: status), cancellationToken);

    /// <summary>Save a manual GitHub-issue URL (web <c>onUpdate({ id, update: { github_issue_url } })</c>).</summary>
    public Task SaveGithubUrlAsync(long id, string url, CancellationToken cancellationToken = default) =>
        UpdateAsync(id, new FeedbackUpdate(GithubIssueUrl: url ?? string.Empty), cancellationToken);

    /// <summary>Forward a row to GitHub (web <c>onUpdate({ id, update: { forward_to_github: true } })</c>).</summary>
    public Task ForwardToGithubAsync(long id, CancellationToken cancellationToken = default) =>
        UpdateAsync(id, new FeedbackUpdate(ForwardToGithub: true), cancellationToken);

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

    private async Task UpdateAsync(long id, FeedbackUpdate update, CancellationToken cancellationToken)
    {
        IsFetching = true;
        try
        {
            await _feed.UpdateAsync(id, update, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _hasError = true;
            _errorDetail = ex.Message;
            IsFetching = false;
            Reproject();
            return;
        }

        // web useUpdateFeedback.onSuccess invalidates the feedback queries → the list reloads.
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    private Task ApplyFilterAsync(FeedbackFilter filter, CancellationToken cancellationToken)
    {
        _filter = filter;
        _page = 0;
        _expandedId = null;
        return LoadAsync(cancellationToken);
    }

    private FeedbackQueueQuery BuildQuery() => new(_filter, _page, FeedbackQueueRegistration.PageSize);

    private FeedbackQueueModel BuildModel() => new(
        Items: _items,
        Total: _total,
        GithubBridgeEnabled: _githubBridgeEnabled,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Filter: _filter,
        Page: _page,
        Limit: FeedbackQueueRegistration.PageSize,
        ExpandedId: _expandedId);

    private void Reproject()
    {
        var display = FeedbackQueueProjection.Project(BuildModel(), _localizer, _clock());
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
