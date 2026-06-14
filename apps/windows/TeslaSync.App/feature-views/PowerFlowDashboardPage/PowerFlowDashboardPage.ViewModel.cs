using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>PowerFlowDashboardPage</c> view — the native port of the web
/// page's data flow (web/src/features/battery/pages/PowerFlowDashboardPage.tsx). It reads the current snapshot
/// through the injected <see cref="IPowerFlowFeed"/> (web <c>useTeslaEnergyLiveStatus</c>, which drives the page
/// state) and overlays the historical samples the two charts plot (web <c>useTeslaEnergyLiveStatusHistory</c>, a
/// best-effort overlay whose failure leaves the charts empty rather than erroring the page). It exposes a manual
/// refresh (web <c>useRefreshTeslaEnergyLiveStatus</c>: a POST that fetches a fresh snapshot from Tesla and then
/// re-reads both queries). Each model is projected through <see cref="PowerFlowProjection"/> with the active unit
/// preference so the view is a thin renderer, and it exposes the data states (loading / empty / error / success)
/// plus in-flight + refreshing flags; observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PowerFlowDashboardPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPowerFlowFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly UnitPref _units;
    private readonly long _siteId;
    private readonly Func<DateTimeOffset> _clock;
    private readonly PowerFlowDashboardDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _loading = true;
    private bool _hasError;
    private string? _errorDetail;
    private bool _hasLive;
    private PowerFlowLiveReading _live = PowerFlowLiveReading.Empty;
    private bool _historyLoading = true;
    private IReadOnlyList<PowerFlowHistoryEntry> _history = Array.Empty<PowerFlowHistoryEntry>();

    private PowerFlowState _state = PowerFlowState.Loading;
    private PowerFlowDisplay _display;
    private bool _isFetching;
    private bool _isRefreshing;

    /// <summary>Creates the holder over its data feed, localizer, the energy-site id, unit preference and clock.</summary>
    /// <param name="feed">The power-flow data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="siteId">The Tesla energy-site id (web <c>DEFAULT_SITE_ID</c>); defaults to 1.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric, the web default).</param>
    /// <param name="clock">Injectable clock for deterministic date formatting / staleness in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PowerFlowDashboardPageViewModel(
        IPowerFlowFeed feed,
        ILocalizer localizer,
        long siteId = PowerFlowDashboardRegistration.DefaultSiteId,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        PowerFlowDashboardDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _siteId = siteId;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new PowerFlowDashboardDiagnostics();

        _display = PowerFlowProjection.Project(BuildModel(), _localizer, _units, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public PowerFlowState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public PowerFlowDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch of the snapshot / history is in flight.</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True while the manual Tesla refresh (the POST) is in flight (web mutation <c>isPending</c>).</summary>
    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set => Set(ref _isRefreshing, value);
    }

    /// <summary>The localized page title (web <c>t('powerFlow.title')</c>).</summary>
    public string Title => PowerFlowDashboardRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the live-status read (which drives the page state) and overlay the historical samples. A
    /// history failure is swallowed (the charts fall back to their empty body) — only the live-status query errors
    /// the page. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasLive)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var live = await _feed.FetchLiveStatusAsync(_siteId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _live = live;
            _hasLive = live.HasData;
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
            _hasError = true;
            _hasLive = false;
            _live = PowerFlowLiveReading.Empty;
            _errorDetail = ex.Message;
            _loading = false;
        }

        // The scaffold (or error surface) is now resolved; the two charts enter their loading state.
        _historyLoading = true;
        Reproject();

        var now = _clock();
        try
        {
            _history = await _feed.FetchLiveStatusHistoryAsync(
                _siteId,
                PowerFlowProjection.WindowSince(now),
                PowerFlowProjection.WindowUntil(now),
                PowerFlowProjection.HistoryLimit,
                cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            // Best-effort overlay (web hook is independent of the page state) — leave the charts empty.
            _history = Array.Empty<PowerFlowHistoryEntry>();
        }

        _historyLoading = false;
        IsFetching = false;
        Reproject();
    }

    /// <summary>
    /// Fetch a fresh snapshot from Tesla (web <c>useRefreshTeslaEnergyLiveStatus</c> POST) and, on success, re-read
    /// the snapshot + history (web onSuccess query invalidation). A failed POST leaves the current state unchanged.
    /// </summary>
    public async Task RefreshAsync(CancellationToken cancellationToken = default)
    {
        if (_isRefreshing)
        {
            return;
        }

        IsRefreshing = true;
        bool succeeded;
        try
        {
            await _feed.RefreshLiveStatusAsync(_siteId, cancellationToken).ConfigureAwait(false);
            succeeded = true;
        }
        catch (OperationCanceledException)
        {
            IsRefreshing = false;
            return;
        }
        catch (Exception)
        {
            succeeded = false;
        }

        IsRefreshing = false;

        if (succeeded)
        {
            await LoadAsync(cancellationToken).ConfigureAwait(false);
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

    private PowerFlowModel BuildModel() => new(
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        HasLive: _hasLive,
        Live: _live,
        HistoryLoading: _historyLoading,
        History: _history);

    private void Reproject()
    {
        var display = PowerFlowProjection.Project(BuildModel(), _localizer, _units, _clock());
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
