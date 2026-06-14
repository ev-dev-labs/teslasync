using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>AlertsListPage</c> view — the native port of the web page's
/// data + filter flow (web/src/features/notifications/pages/AlertsListPage.tsx). It owns the alert list, the rule
/// list and the pinned references, the four top-level data states (loading / empty / error / success), the URL
/// filter state (the active tab, the search term and the 1-based page), reads everything through the injected
/// <see cref="IAlertsFeed"/> (web <c>useAlerts</c> / <c>useAlertRules</c> / <c>usePinned</c>), writes the
/// per-alert mark-read / acknowledge / reopen mutations back through the same port (web <c>useMarkAlertRead</c> /
/// <c>useAcknowledgeAlert</c> / <c>useReopenAlert</c>), and projects the result through
/// <see cref="AlertsListProjection"/> so the view is a thin renderer. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class AlertsListPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAlertsFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly AlertsListDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<Alert> _alerts = Array.Empty<Alert>();
    private IReadOnlyList<AlertsRule> _rules = Array.Empty<AlertsRule>();
    private IReadOnlyList<PinnedRef> _pins = Array.Empty<PinnedRef>();
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;

    private AlertsFilter _filter = AlertsFilter.All;
    private string _search = string.Empty;
    private int _page = 1;
    private bool _quietHoursActive;

    private AlertsListState _state = AlertsListState.Loading;
    private AlertsListDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) diagnostics / clock.</summary>
    /// <param name="feed">The alerts + rules + pins read/write data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="clock">The wall-clock seam the 7-day windows + relative times are measured against (web <c>Date.now()</c>).</param>
    public AlertsListPageViewModel(
        IAlertsFeed feed,
        ILocalizer localizer,
        AlertsListDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new AlertsListDiagnostics();
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = AlertsListProjection.Project(BuildModel(), _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public AlertsListState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public AlertsListDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch or mutation is in flight (web <c>isFetching</c> / mutation pending).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>The localized page title (web <c>t('Alerts')</c>).</summary>
    public string Title => AlertsListRegistration.Title(_localizer);

    /// <summary>The active list filter (web <c>filter</c>).</summary>
    public AlertsFilter Filter => _filter;

    /// <summary>The active search query (web <c>alertSearch</c>).</summary>
    public string Search => _search;

    /// <summary>The active 1-based list page (web <c>alertPage</c>).</summary>
    public int Page => _page;

    /// <summary>Whether quiet hours are currently active (web <c>quietActive</c>); the badge + summary follow this.</summary>
    public bool QuietHoursActive
    {
        get => _quietHoursActive;
        set
        {
            if (_quietHoursActive == value)
            {
                return;
            }

            _quietHoursActive = value;
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the alert / rule / pin loads (web <c>useAlerts</c> + <c>useAlertRules</c> + <c>usePinned</c>).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_alerts.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var alerts = await _feed.FetchAlertsAsync(cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _alerts = alerts ?? Array.Empty<Alert>();
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
            // web error branch: PageContainer surfaces the error; the rest of the page is suppressed.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _alerts = Array.Empty<Alert>();
        }

        // Secondary reads (web useAlertRules / usePinned) load independently; their failure only hides the
        // Active-Rules count and the pinned "Watching" panel, never the page.
        await LoadSecondaryAsync(cts.Token).ConfigureAwait(false);

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the page (web query refetch / retry button).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Select a filter tab (web <c>setFilter(k); setAlertPage(1)</c>) — resets to the first page.</summary>
    public void SetFilter(AlertsFilter filter)
    {
        if (_filter == filter)
        {
            return;
        }

        _filter = filter;
        _page = 1;
        Reproject();
    }

    /// <summary>Update the search query (web <c>setAlertSearch(v); setAlertPage(1)</c>) — resets to the first page.</summary>
    public void SetSearch(string? search)
    {
        string next = search ?? string.Empty;
        if (string.Equals(_search, next, StringComparison.Ordinal))
        {
            return;
        }

        _search = next;
        _page = 1;
        Reproject();
    }

    /// <summary>Go to a 1-based list page (web pagination buttons), clamped to the available range.</summary>
    public void SetPage(int page)
    {
        int next = Math.Max(1, page);
        if (_page == next)
        {
            return;
        }

        _page = next;
        Reproject();
    }

    /// <summary>Mark one alert read (web <c>handleMarkRead → useMarkAlertRead</c>), then reload.</summary>
    public Task MarkReadAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(c => _feed.MarkReadAsync(id, c), cancellationToken);

    /// <summary>Acknowledge one alert with an optional note (web <c>handleAcknowledgeSubmit → useAcknowledgeAlert</c>), then reload.</summary>
    public Task AcknowledgeAsync(long id, string note, CancellationToken cancellationToken = default) =>
        RunMutationAsync(c => _feed.AcknowledgeAsync(id, note ?? string.Empty, c), cancellationToken);

    /// <summary>Reopen one acknowledged alert (web <c>handleReopen / ack-undo → useReopenAlert</c>), then reload.</summary>
    public Task ReopenAsync(long id, CancellationToken cancellationToken = default) =>
        RunMutationAsync(c => _feed.ReopenAsync(id, c), cancellationToken);

    /// <summary>Load one alert's detail timeline for the modal (web <c>useAlertDetail</c>); returns the empty detail on failure.</summary>
    public async Task<AlertDetail> LoadDetailAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _feed.FetchDetailAsync(id, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web: a failed detail load falls back to the timeline empty state (reopening retries).
            return AlertDetail.Empty;
        }
    }

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

    private async Task LoadSecondaryAsync(CancellationToken cancellationToken)
    {
        try
        {
            _rules = await _feed.FetchRulesAsync(cancellationToken).ConfigureAwait(false) ?? Array.Empty<AlertsRule>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _rules = Array.Empty<AlertsRule>();
        }

        try
        {
            _pins = await _feed.FetchPinnedRulesAsync(cancellationToken).ConfigureAwait(false) ?? Array.Empty<PinnedRef>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _pins = Array.Empty<PinnedRef>();
        }
    }

    private async Task RunMutationAsync(Func<CancellationToken, Task> mutation, CancellationToken cancellationToken)
    {
        IsFetching = true;
        try
        {
            await mutation(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
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

        // web onSuccess invalidates the alerts query → the list reloads.
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    private AlertsListModel BuildModel() => new(
        Alerts: _alerts,
        Rules: _rules,
        Pins: _pins,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        Filter: _filter,
        Search: _search,
        Page: _page,
        QuietHoursActive: _quietHoursActive,
        Now: _clock());

    private void Reproject()
    {
        var display = AlertsListProjection.Project(BuildModel(), _localizer);
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
