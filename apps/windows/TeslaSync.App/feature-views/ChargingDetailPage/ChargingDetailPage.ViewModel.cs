using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>ChargingDetailPage</c> view — the native port of the web
/// page's data flow (web/src/features/charging/pages/ChargingDetailPage.tsx). It reads the four-source charging
/// snapshot for one session id through the injected <see cref="IChargingDetailPageFeed"/> (the native
/// <c>useChargingSessionDetail</c> + <c>useChargeTelemetry</c> + <c>useVehicle</c> +
/// <c>useChargingTelemetryLatest</c> hooks), projects it through <see cref="ChargingDetailProjection"/> with the
/// active units, currency and clock, and surfaces the four web data states (loading / empty / error / success)
/// plus the header freshness flags so the view is a thin renderer. Observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class ChargingDetailPageViewModel : INotifyPropertyChanged, IDisposable
{
    private const double DefaultCostPerKwh = 0.15;
    private const string DefaultCurrencySymbol = "$";

    private readonly IChargingDetailPageFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly ChargingDetailPageDiagnostics _diagnostics;
    private readonly long _sessionId;
    private readonly double _costPerKwh;
    private readonly string _currencySymbol;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private ChargingDetailSnapshot _snapshot = ChargingDetailSnapshot.Empty;
    private bool _hasData;
    private bool _loading = true;
    private string? _errorDetail;

    private ChargingDetailState _state = ChargingDetailState.Loading;
    private ChargingDetailDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer, session id, units, currency and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The four-source charging data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="sessionId">The charging session id from the route (web <c>:id</c> param).</param>
    /// <param name="units">The user's unit-display preference (defaults to metric).</param>
    /// <param name="clock">Injectable clock for deterministic freshness / date formatting in tests.</param>
    /// <param name="costPerKwh">The settings cost-per-kWh rate (web <c>useFormatting().costPerKwh</c>).</param>
    /// <param name="currencySymbol">The settings currency symbol (web <c>useFormatting().currencySymbol</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public ChargingDetailPageViewModel(
        IChargingDetailPageFeed feed,
        ILocalizer localizer,
        long sessionId,
        UnitPref? units = null,
        Func<DateTimeOffset>? clock = null,
        double costPerKwh = DefaultCostPerKwh,
        string? currencySymbol = null,
        ChargingDetailPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _sessionId = sessionId;
        _units = units ?? UnitPref.Metric;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _costPerKwh = costPerKwh;
        _currencySymbol = string.IsNullOrEmpty(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;
        _diagnostics = diagnostics ?? new ChargingDetailPageDiagnostics();
        _display = ChargingDetailProjection.Project(BuildModel(), _units, _localizer, _clock(), _costPerKwh, _currencySymbol);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public ChargingDetailState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public ChargingDetailDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _errorDetail is not null;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The charging session id this holder is bound to.</summary>
    public long SessionId => _sessionId;

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
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
            Reproject();
        }
    }

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the charging-detail load and fold the result into the data state.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (!_hasData)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            var snapshot = await _feed.FetchAsync(_sessionId, cts.Token).ConfigureAwait(false);
            cts.Token.ThrowIfCancellationRequested();

            _snapshot = snapshot;
            _hasData = snapshot.HasSession;
            _errorDetail = null;
            _loading = false;
            _updatedAt = _clock();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }
        catch (ApiException ex)
        {
            SetError(ex.Message);
        }
        catch (Exception ex)
        {
            SetError(ex.Message);
        }

        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
    }

    /// <summary>Refresh the charging detail (web query refetch / Retry).</summary>
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

    private void SetError(string? detail)
    {
        _errorDetail = string.IsNullOrWhiteSpace(detail) ? "unknown error" : detail;
        _snapshot = ChargingDetailSnapshot.Empty;
        _hasData = false;
        _loading = false;
    }

    private ChargingDetailModel BuildModel() => new(_snapshot, _loading, _errorDetail);

    private void Reproject()
    {
        var display = ChargingDetailProjection.Project(BuildModel(), _units, _localizer, _clock(), _costPerKwh, _currencySymbol);
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
