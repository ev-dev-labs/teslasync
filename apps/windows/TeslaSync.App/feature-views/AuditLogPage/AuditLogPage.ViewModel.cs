using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>AuditLogPage</c> view — the native port of the web page's data
/// flow (web/src/features/admin/pages/AuditLogPage.tsx). It owns the URL-equivalent state (the seven filters, the
/// paging offset, the expanded-row set and the independent chain-verify sub-state), reads each page through the
/// injected <see cref="IAuditLogFeed"/> and projects the result through <see cref="AuditLogProjection"/> so the view
/// is a thin renderer. It surfaces the four web data states (loading / empty / error / success) — with the HTTP 503
/// failure mapped to the distinct subsystem-unavailable banner (web <c>subsystemMissing</c>) — plus an in-flight flag;
/// observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class AuditLogPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAuditLogFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly AuditLogDiagnostics _diagnostics;

    private CancellationTokenSource? _listCts;
    private CancellationTokenSource? _verifyCts;
    private bool _disposed;

    private IReadOnlyList<AuditLogRow> _rows = Array.Empty<AuditLogRow>();
    private int _limit = AuditLogRegistration.DefaultLimit;
    private IReadOnlyList<string> _categories = Array.Empty<string>();
    private IReadOnlyList<string> _actions = Array.Empty<string>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _subsystemMissing;
    private AuditLogFilter _filter = AuditLogFilter.Default;
    private int _offset;
    private readonly HashSet<long> _expanded = [];

    private bool _verifyLoading;
    private AuditChainVerify? _verifyResult;
    private string? _verifyError;

    private AuditLogState _state = AuditLogState.Loading;
    private AuditLogDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The audit-log data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic timestamp formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AuditLogPageViewModel(
        IAuditLogFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        AuditLogDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new AuditLogDiagnostics();
        _display = AuditLogProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public AuditLogState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public AuditLogDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch of the list is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>admin.auditLog.pageTitle</c>).</summary>
    public string Title => AuditLogRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the list load for the current filter / page, refreshing the dropdown facets too.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _listCts, cancellationToken);

        IsFetching = true;
        if (_rows.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        var facetsTask = RefreshFacetsAsync(cts.Token);

        try
        {
            var snapshot = await _feed.FetchLogAsync(_filter, _offset, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _rows = snapshot.Rows ?? Array.Empty<AuditLogRow>();
            _limit = snapshot.Limit > 0 ? snapshot.Limit : _filter.Limit;
            _hasError = false;
            _subsystemMissing = false;
            _errorDetail = null;
            _loading = false;
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex) when (ex.StatusCode == 503)
        {
            // web subsystemMissing: the audit-log subsystem is not configured (HTTP 503) — show the banner.
            _subsystemMissing = true;
            _hasError = false;
            _rows = Array.Empty<AuditLogRow>();
            _errorDetail = ex.Message;
            _loading = false;
        }
        catch (Exception ex)
        {
            // Any other failure: surface the generic InfoBar + Retry surface.
            _hasError = true;
            _subsystemMissing = false;
            _rows = Array.Empty<AuditLogRow>();
            _errorDetail = ex.Message;
            _loading = false;
        }

        try
        {
            await facetsTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        if (cts.Token.IsCancellationRequested)
        {
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the current page (web <c>logQuery.refetch</c> / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Set the "since" lower bound (web <c>setSince</c>); resets the page.</summary>
    public Task SetSinceAsync(string value, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Since = value ?? string.Empty }, cancellationToken);

    /// <summary>Set the "until" upper bound (web <c>setUntil</c>); resets the page.</summary>
    public Task SetUntilAsync(string value, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Until = value ?? string.Empty }, cancellationToken);

    /// <summary>Set the category filter (web <c>setCategory</c>); resets the page.</summary>
    public Task SetCategoryAsync(string value, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Category = value ?? string.Empty }, cancellationToken);

    /// <summary>Set the action filter (web <c>setAction</c>); resets the page.</summary>
    public Task SetActionAsync(string value, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Action = value ?? string.Empty }, cancellationToken);

    /// <summary>Set the actor filter (web <c>setActor</c>); resets the page.</summary>
    public Task SetActorAsync(string value, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { Actor = value ?? string.Empty }, cancellationToken);

    /// <summary>Set the entity-type filter (web <c>setEntityType</c>); resets the page.</summary>
    public Task SetEntityTypeAsync(string value, CancellationToken cancellationToken = default) =>
        ApplyFilterAsync(_filter with { EntityType = value ?? string.Empty }, cancellationToken);

    /// <summary>Set the page size (web <c>setLimit</c>); resets the page.</summary>
    public Task SetLimitAsync(string value, CancellationToken cancellationToken = default)
    {
        int limit = int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) && parsed > 0
            ? parsed
            : AuditLogRegistration.DefaultLimit;
        return ApplyFilterAsync(_filter with { Limit = limit }, cancellationToken);
    }

    /// <summary>Re-run the query for the current filter (web <c>Search</c> button / <c>logQuery.refetch</c>).</summary>
    public Task ApplyFiltersAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Clear every filter and reload (web <c>handleReset</c>).</summary>
    public Task ResetFiltersAsync(CancellationToken cancellationToken = default)
    {
        var reset = AuditLogFilter.Default with { Limit = _filter.Limit };
        return ApplyFilterAsync(reset, cancellationToken);
    }

    /// <summary>Advance to the next page (web <c>Next</c>): offset += limit.</summary>
    public Task NextPageAsync(CancellationToken cancellationToken = default)
    {
        _offset += _filter.Limit;
        _expanded.Clear();
        return LoadAsync(cancellationToken);
    }

    /// <summary>Step back a page (web <c>Previous</c>): offset = max(0, offset - limit).</summary>
    public Task PreviousPageAsync(CancellationToken cancellationToken = default)
    {
        _offset = Math.Max(0, _offset - _filter.Limit);
        _expanded.Clear();
        return LoadAsync(cancellationToken);
    }

    /// <summary>Toggle a row's expanded detail (web <c>toggleExpanded</c>); re-projects without a reload.</summary>
    public void ToggleExpanded(long id)
    {
        if (!_expanded.Remove(id))
        {
            _expanded.Add(id);
        }

        Reproject();
    }

    /// <summary>Trigger a server-side hash-chain re-derivation (web <c>handleVerify</c>).</summary>
    public async Task VerifyChainAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _verifyCts, cancellationToken);

        _verifyLoading = true;
        _verifyError = null;
        Reproject();

        try
        {
            var result = await _feed.VerifyChainAsync(AuditLogRegistration.VerifyLimit, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();
            _verifyResult = result;
            _verifyError = null;
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception ex)
        {
            _verifyError = ex.Message;
        }

        _verifyLoading = false;
        Reproject();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _listCts);
        Cancel(ref _verifyCts);
    }

    private Task ApplyFilterAsync(AuditLogFilter filter, CancellationToken cancellationToken)
    {
        _filter = filter;
        _offset = 0;
        _expanded.Clear();
        return LoadAsync(cancellationToken);
    }

    private async Task RefreshFacetsAsync(CancellationToken cancellationToken)
    {
        try
        {
            _categories = await _feed.FetchCategoriesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web parity: a failed facet query leaves the dropdown at "All …" — never breaks the page.
        }

        try
        {
            _actions = await _feed.FetchActionsAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web parity: a failed facet query leaves the dropdown at "All …" — never breaks the page.
        }
    }

    private AuditLogModel BuildModel() => new(
        Rows: _rows,
        Limit: _limit,
        Categories: _categories,
        Actions: _actions,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        SubsystemMissing: _subsystemMissing,
        Filter: _filter,
        Offset: _offset,
        Expanded: _expanded,
        VerifyLoading: _verifyLoading,
        VerifyResult: _verifyResult,
        VerifyError: _verifyError);

    private void Reproject()
    {
        var display = AuditLogProjection.Project(BuildModel(), _localizer, _clock());
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
