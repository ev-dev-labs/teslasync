using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>EnergyFlowPage</c> view — the native port of the web page's
/// data flow (web/src/features/battery/pages/EnergyFlowPage.tsx). It reads the historical energy rollup through
/// the injected <see cref="IEnergyFlowFeed"/> (web stats query, which drives the page state) and overlays the
/// real-time power-flow reading (web <c>useEnergyFlow</c>, a best-effort overlay whose failure never errors the
/// page — exactly as the web query's <c>retry:false</c> leaves the diagram on its null-safe zeros). It projects
/// each snapshot through <see cref="EnergyFlowProjection"/> with the active unit preference so the view is a thin
/// renderer, and exposes the four web data states (loading / empty / error / success) plus an in-flight flag;
/// observable so the view re-renders on <see cref="PropertyChanged"/>. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class EnergyFlowPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEnergyFlowFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly UnitPref _units;
    private readonly string? _vehicleId;
    private readonly int _days;
    private readonly Func<DateTimeOffset> _clock;
    private readonly EnergyFlowDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private bool _loading;
    private bool _hasError;
    private string? _errorDetail;
    private bool _hasStats;
    private EnergyStatsReading _stats = EnergyStatsReading.Empty;
    private EnergyFlowReading _flow = EnergyFlowReading.Empty;

    private EnergyFlowState _state = EnergyFlowState.Loading;
    private EnergyFlowDisplay _display;
    private bool _isFetching;

    /// <summary>Creates the holder over its data feed, localizer, the selected vehicle, unit preference and window.</summary>
    /// <param name="feed">The energy-flow data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="vehicleId">The selected vehicle id (web <c>activeId</c>); null renders the empty state.</param>
    /// <param name="units">The user's unit-display preference (defaults to metric km / kWh, the web default).</param>
    /// <param name="days">The trailing look-back window in days (web range picker default 7).</param>
    /// <param name="clock">Injectable clock for deterministic date formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public EnergyFlowPageViewModel(
        IEnergyFlowFeed feed,
        ILocalizer localizer,
        string? vehicleId = null,
        UnitPref? units = null,
        int days = EnergyFlowProjection.DefaultDays,
        Func<DateTimeOffset>? clock = null,
        EnergyFlowDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _vehicleId = string.IsNullOrWhiteSpace(vehicleId) ? null : vehicleId;
        _units = units ?? (UnitPref.Metric with { Energy = EnergyUnit.Kwh });
        _days = days < 1 ? EnergyFlowProjection.DefaultDays : days;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new EnergyFlowDiagnostics();

        // No vehicle selected → the web query is disabled and resolves to the empty state (not a spinner).
        _loading = _vehicleId is not null;
        _display = EnergyFlowProjection.Project(BuildModel(), _localizer, _units, _clock());
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public EnergyFlowState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public EnergyFlowDisplay Display
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

    /// <summary>The localized page title (web <c>t('Energy Flow')</c>).</summary>
    public string Title => EnergyFlowRegistration.Title(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run (or re-run) the historical load (which drives the page state) and overlay the real-time flow reading.
    /// A flow failure is swallowed (web <c>useEnergyFlow</c> <c>retry:false</c>) — only the historical query
    /// errors the page. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (_vehicleId is null)
        {
            // Web: the query is disabled with no vehicle — show the empty state, never a spinner.
            _loading = false;
            _hasStats = false;
            _hasError = false;
            Reproject();
            return;
        }

        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasStats)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var stats = await _feed.FetchStatsAsync(_vehicleId, _days, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _stats = stats;
            _hasStats = stats.HasData;
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
            _hasStats = false;
            _stats = EnergyStatsReading.Empty;
            _errorDetail = ex.Message;
            _loading = false;
        }

        // Real-time overlay — best-effort; a failure leaves the diagram on its null-safe zeros (web retry:false).
        try
        {
            _flow = await _feed.FetchFlowAsync(_vehicleId, cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception)
        {
            _flow = EnergyFlowReading.Empty;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh the rollup + flow (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

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

    private EnergyFlowModel BuildModel() => new(
        VehicleSelected: _vehicleId is not null,
        Loading: _loading,
        HasError: _hasError,
        ErrorDetail: _errorDetail,
        HasStats: _hasStats,
        Stats: _stats,
        Flow: _flow);

    private void Reproject()
    {
        var display = EnergyFlowProjection.Project(BuildModel(), _localizer, _units, _clock());
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
