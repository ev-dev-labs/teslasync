using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>The outcome of a typed-automation import (web import handler): success, or a localized failure message to surface.</summary>
public sealed record AutomationImportResult(bool Success, string? ErrorMessage)
{
    /// <summary>The shared success result.</summary>
    public static AutomationImportResult Ok { get; } = new(true, null);
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>AutomationsListPage</c> view — the native port of the web
/// page's data flow (web/src/features/automations/pages/AutomationsListPage.tsx). It owns the URL-equivalent
/// client state (status filter + search), reads the hub through the injected <see cref="IAutomationsListFeed"/>
/// (web <c>useAutomations</c> + sibling queries), writes the per-card actions back through the same port (web
/// <c>useToggleAutomation</c> / <c>useReEnableAutomation</c> / <c>useDeleteAutomation</c> /
/// <c>useTestRunAutomation</c>) reloading on success exactly as the web mutations invalidate their queries, and
/// projects the result through <see cref="AutomationsListProjection"/> so the view is a thin renderer. It surfaces
/// the four web data states (loading / empty / error / success) plus an in-flight flag; observable so the view
/// re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); not internally
/// synchronised.
/// </summary>
public sealed class AutomationsListPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAutomationsListFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly AutomationsListDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<AutomationSummary> _items = Array.Empty<AutomationSummary>();
    private IReadOnlyList<AutomationVehicleRef> _vehicles = Array.Empty<AutomationVehicleRef>();
    private IReadOnlyList<AutomationPin> _pins = Array.Empty<AutomationPin>();
    private IReadOnlyList<AutomationHistoryEntry> _history = Array.Empty<AutomationHistoryEntry>();
    private AutomationHistorySummary? _historySummary;
    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private AutomationStatusFilter _statusFilter = AutomationStatusFilter.All;
    private string _search = string.Empty;

    private AutomationsListState _state = AutomationsListState.Loading;
    private AutomationsListDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The automations-hub data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic relative-time formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public AutomationsListPageViewModel(
        IAutomationsListFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        AutomationsListDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new AutomationsListDiagnostics();
        _display = AutomationsListProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public AutomationsListState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public AutomationsListDisplay Display
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

    /// <summary>The localized page title (web <c>automations.title</c>).</summary>
    public string Title => AutomationsListRegistration.Title(_localizer);

    /// <summary>The active status filter (web <c>statusFilter</c>).</summary>
    public AutomationStatusFilter StatusFilter => _statusFilter;

    /// <summary>The active search query (web <c>search</c>).</summary>
    public string Search => _search;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the hub load (web <c>useAutomations</c> + sibling queries).</summary>
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
            var snapshot = await _feed.FetchAsync(AutomationsListRegistration.HistoryLimit, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _items = snapshot.Automations ?? Array.Empty<AutomationSummary>();
            _vehicles = snapshot.Vehicles ?? Array.Empty<AutomationVehicleRef>();
            _pins = snapshot.Pins ?? Array.Empty<AutomationPin>();
            _history = snapshot.History ?? Array.Empty<AutomationHistoryEntry>();
            _historySummary = snapshot.HistorySummary;
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
            // web isError: surface the query-error region; the cards fall back to their error branch.
            _hasError = true;
            _errorDetail = ex.Message;
            _loading = false;
            _items = Array.Empty<AutomationSummary>();
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the hub (web manual retry / query refetch).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Set the status filter (web <c>setStatusFilter</c>); client-side, re-projects without a reload.</summary>
    public void SetStatusFilter(string wire)
    {
        _statusFilter = AutomationStatusFilters.FromWire(wire);
        Reproject();
    }

    /// <summary>Set the search query (web <c>setSearch</c>); client-side, re-projects without a reload.</summary>
    public void SetSearch(string search)
    {
        _search = search ?? string.Empty;
        Reproject();
    }

    /// <summary>Clear the filters (web "Reset filters" empty-state action).</summary>
    public void ResetFilters()
    {
        _statusFilter = AutomationStatusFilter.All;
        _search = string.Empty;
        Reproject();
    }

    /// <summary>Toggle an automation (web <c>onToggle</c> → <c>useToggleAutomation</c>); reloads on success.</summary>
    public Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken = default) =>
        MutateThenReloadAsync(ct => _feed.ToggleAsync(id, enabled, ct), cancellationToken);

    /// <summary>Re-enable an auto-disabled automation (web <c>onReEnable</c>); reloads on success.</summary>
    public Task ReEnableAsync(long id, CancellationToken cancellationToken = default) =>
        MutateThenReloadAsync(ct => _feed.ReEnableAsync(id, ct), cancellationToken);

    /// <summary>Delete an automation (web <c>onDelete</c>); reloads on success.</summary>
    public Task DeleteAsync(long id, CancellationToken cancellationToken = default) =>
        MutateThenReloadAsync(ct => _feed.DeleteAsync(id, ct), cancellationToken);

    /// <summary>Queue a test run (web <c>onTestRun</c>); reloads on success.</summary>
    public Task TestRunAsync(long id, CancellationToken cancellationToken = default) =>
        MutateThenReloadAsync(ct => _feed.TestRunAsync(id, ct), cancellationToken);

    /// <summary>
    /// Import a typed automation export (web import handler): rejects an untyped / legacy envelope with the
    /// typed-envelope-required message, otherwise posts it and reloads. Returns the localized outcome so the view
    /// can surface a failure dialog.
    /// </summary>
    public async Task<AutomationImportResult> ImportAsync(string envelopeJson, CancellationToken cancellationToken = default)
    {
        if (!AutomationImportEnvelope.IsValid(envelopeJson))
        {
            return new AutomationImportResult(false, _display.ImportTypedEnvelopeRequired);
        }

        IsFetching = true;
        try
        {
            await _feed.ImportAsync(envelopeJson, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            IsFetching = false;
            return new AutomationImportResult(false, null);
        }
        catch (Exception ex)
        {
            IsFetching = false;
            string reason = string.IsNullOrEmpty(ex.Message) ? _display.ImportUnknownError : ex.Message;
            string message = string.Format(CultureInfo.CurrentCulture, _display.ImportFailedTemplate, reason);
            return new AutomationImportResult(false, message);
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
        return AutomationImportResult.Ok;
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

    private async Task MutateThenReloadAsync(Func<CancellationToken, Task> mutate, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(mutate);

        IsFetching = true;
        try
        {
            await mutate(cancellationToken).ConfigureAwait(false);
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

        // web mutation onSuccess invalidates the automations queries → the list reloads.
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    private AutomationsListModel BuildModel() => new(
        Items: _items,
        Vehicles: _vehicles,
        Pins: _pins,
        History: _history,
        HistorySummary: _historySummary,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        StatusFilter: _statusFilter,
        Search: _search);

    private void Reproject()
    {
        var display = AutomationsListProjection.Project(BuildModel(), _localizer, _clock());
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
