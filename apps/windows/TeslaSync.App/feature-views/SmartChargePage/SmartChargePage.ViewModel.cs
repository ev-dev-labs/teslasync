using System.ComponentModel;
using System.Globalization;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SmartChargePage</c> view — the native port of the web page's
/// data flow (web/src/features/charging/pages/SmartChargePage.tsx). It consumes the two cache-then-network ports
/// (<see cref="IRatePlansSource"/> = <c>useRatePlans</c>, <see cref="IChargePlansSource"/> = <c>useChargePlans</c>)
/// concurrently and the two mutation ports (<see cref="IOptimizeChargeClient"/> = <c>useOptimizeCharge</c>,
/// <see cref="IApplyScheduleClient"/> = <c>useApplySchedule</c>) on demand. The plan-history read is the page
/// spine that drives <see cref="State"/>; the settings form, rate timeline, cost comparison and schedule panels
/// are always present and projected through <see cref="SmartChargeProjection"/> into a render-ready
/// <see cref="Display"/>. Drive it from one confinement (the UI thread); concurrent source updates are
/// serialized internally and property changes are raised for the view to marshal.
/// </summary>
public sealed class SmartChargePageViewModel : INotifyPropertyChanged, IDisposable
{
    /// <summary>The default currency fraction digits (web <c>useFormatting</c> <c>decimal_precision ?? 2</c>).</summary>
    public const int DefaultPrecision = 2;

    private static readonly IReadOnlyList<RatePlanOption> FallbackRatePlans =
    [
        new RatePlanOption("pge-ev2a", "PG&E EV2-A", string.Empty),
        new RatePlanOption("sce-tou-d", "SCE TOU-D", string.Empty),
        new RatePlanOption("sdge-tou-dr1", "SDG&E TOU-DR1", string.Empty),
    ];

    private readonly IRatePlansSource _ratePlansSource;
    private readonly IChargePlansSource _plansSource;
    private readonly IOptimizeChargeClient _optimizeClient;
    private readonly IApplyScheduleClient _applyClient;
    private readonly IWidgetVehicleSource _vehicles;
    private readonly ILocalizer _localizer;
    private readonly SmartChargeDiagnostics _diagnostics;
    private readonly Func<DateTimeOffset> _clock;
    private readonly string _currencySymbol;
    private readonly int _currencyPrecision;
    private readonly object _gate = new();

    private RepositoryResult<IReadOnlyList<ChargePlanRecord>> _plansResult = RepositoryResult<IReadOnlyList<ChargePlanRecord>>.Loading();
    private IReadOnlyList<ChargePlanRecord> _plans = System.Array.Empty<ChargePlanRecord>();
    private IReadOnlyList<RatePlanOption> _ratePlanOptions = FallbackRatePlans;
    private OptimizeChargeResult? _result;
    private long? _vehicleId;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private SmartChargeState _state = SmartChargeState.Loading;
    private SmartChargeDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;

    private int _targetSoc = 80;
    private DateTimeOffset _departBy;
    private string _ratePlanId = "pge-ev2a";
    private int _maxAmps = 32;
    private double _batteryCapacityKwh = 75;

    private bool _hasVehicle;
    private bool _isOptimizing;
    private string? _optimizeErrorMessage;
    private bool _isApplying;
    private string? _applyErrorMessage;
    private bool _applied;

    /// <summary>Creates the holder over its data ports, vehicle source, localizer, currency and clock.</summary>
    /// <param name="ratePlansSource">The cache-then-network rate-plans port (native <c>useRatePlans</c>).</param>
    /// <param name="plansSource">The cache-then-network plan-history port (native <c>useChargePlans</c>).</param>
    /// <param name="optimizeClient">The optimize mutation port (native <c>useOptimizeCharge</c>).</param>
    /// <param name="applyClient">The apply mutation port (native <c>useApplySchedule</c>).</param>
    /// <param name="vehicles">The selected/primary vehicle source (native <c>useSelectedVehicle</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The account currency symbol (defaults to "$").</param>
    /// <param name="currencyPrecision">Currency fraction digits (defaults to 2).</param>
    /// <param name="clock">The wall clock (injectable for deterministic tests).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SmartChargePageViewModel(
        IRatePlansSource ratePlansSource,
        IChargePlansSource plansSource,
        IOptimizeChargeClient optimizeClient,
        IApplyScheduleClient applyClient,
        IWidgetVehicleSource vehicles,
        ILocalizer localizer,
        string? currencySymbol = null,
        int currencyPrecision = DefaultPrecision,
        Func<DateTimeOffset>? clock = null,
        SmartChargeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(ratePlansSource);
        ArgumentNullException.ThrowIfNull(plansSource);
        ArgumentNullException.ThrowIfNull(optimizeClient);
        ArgumentNullException.ThrowIfNull(applyClient);
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(localizer);
        _ratePlansSource = ratePlansSource;
        _plansSource = plansSource;
        _optimizeClient = optimizeClient;
        _applyClient = applyClient;
        _vehicles = vehicles;
        _localizer = localizer;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _currencyPrecision = currencyPrecision < 0 ? 0 : currencyPrecision;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _diagnostics = diagnostics ?? new SmartChargeDiagnostics();
        _departBy = DefaultDepartBy(_clock());
        _display = BuildDisplay();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current plan-history data state (loading / ready / empty / error).</summary>
    public SmartChargeState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SmartChargeDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The rate-plan select options (backend list, or the web fallback when none are returned).</summary>
    public IReadOnlyList<RatePlanOption> RatePlanOptions
    {
        get => _ratePlanOptions;
        private set => Set(ref _ratePlanOptions, value);
    }

    /// <summary>Last successful plan-history update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background plan-history refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the plan-history read failed with no cached snapshot (drives the History error surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown plan-history snapshot is older than the freshness window (2-minute contract).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the History retry surface.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>The target state of charge (%), bound to the settings slider (web <c>targetSoc</c>).</summary>
    public int TargetSoc
    {
        get => _targetSoc;
        set => Set(ref _targetSoc, Math.Clamp(value, 20, 100));
    }

    /// <summary>The departure instant, bound to the settings date/time pickers (web <c>departBy</c>).</summary>
    public DateTimeOffset DepartBy
    {
        get => _departBy;
        set => Set(ref _departBy, value);
    }

    /// <summary>The selected rate-plan id (web <c>ratePlanId</c>).</summary>
    public string RatePlanId
    {
        get => _ratePlanId;
        set => Set(ref _ratePlanId, string.IsNullOrEmpty(value) ? _ratePlanId : value);
    }

    /// <summary>The maximum charge current in amps (web <c>maxAmps</c>).</summary>
    public int MaxAmps
    {
        get => _maxAmps;
        set => Set(ref _maxAmps, Math.Clamp(value, 8, 80));
    }

    /// <summary>The usable battery capacity in kWh sent as <c>battery_capacity_kwh</c> (web <c>batteryCapacity</c>).</summary>
    public double BatteryCapacityKwh
    {
        get => _batteryCapacityKwh;
        set => Set(ref _batteryCapacityKwh, value < 0 ? 0 : value);
    }

    /// <summary>True once a vehicle is resolved — the Optimize action requires one (web <c>!vehicleIdNum</c> guard).</summary>
    public bool HasVehicle
    {
        get => _hasVehicle;
        private set
        {
            if (Set(ref _hasVehicle, value))
            {
                OnPropertyChanged(nameof(CanOptimize));
            }
        }
    }

    /// <summary>True while the optimizer mutation is in flight (the Optimize button shows a spinner).</summary>
    public bool IsOptimizing
    {
        get => _isOptimizing;
        private set
        {
            if (Set(ref _isOptimizing, value))
            {
                OnPropertyChanged(nameof(CanOptimize));
            }
        }
    }

    /// <summary>Localized error shown under the settings panel when optimization fails (web red error text).</summary>
    public string? OptimizeErrorMessage
    {
        get => _optimizeErrorMessage;
        private set => Set(ref _optimizeErrorMessage, value);
    }

    /// <summary>True while the apply mutation is in flight (the Apply button shows a spinner).</summary>
    public bool IsApplying
    {
        get => _isApplying;
        private set
        {
            if (Set(ref _isApplying, value))
            {
                OnPropertyChanged(nameof(CanApply));
            }
        }
    }

    /// <summary>Localized error shown in the schedule panel when applying fails (web red error text).</summary>
    public string? ApplyErrorMessage
    {
        get => _applyErrorMessage;
        private set => Set(ref _applyErrorMessage, value);
    }

    /// <summary>True once a schedule has been applied (web <c>applied</c> — swaps the button for the success chip).</summary>
    public bool Applied
    {
        get => _applied;
        private set
        {
            if (Set(ref _applied, value))
            {
                OnPropertyChanged(nameof(CanApply));
            }
        }
    }

    /// <summary>True when an optimizer result is present (web <c>result</c> truthiness).</summary>
    public bool HasResult => _result is not null;

    /// <summary>True when the Optimize action can run (a vehicle is resolved and no optimize is in flight).</summary>
    public bool CanOptimize => _hasVehicle && !_isOptimizing;

    /// <summary>True when the Apply action can run (a result exists, not yet applied, none in flight).</summary>
    public bool CanApply => HasResult && !_applied && !_isApplying;

    /// <summary>The localized page title (web <c>chargePlanner.title</c>).</summary>
    public string Title => SmartChargeRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>chargePlanner.subtitle</c>).</summary>
    public string Subtitle => SmartChargeRegistration.Subtitle(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load of the rate plans and the plan history concurrently, after resolving the
    /// scoped vehicle. Shows the History skeleton only when nothing is already visible (otherwise keeps content
    /// while refreshing). A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        await ResolveVehicleAsync(cts.Token).ConfigureAwait(false);

        try
        {
            await Task.WhenAll(
                ConsumeRatePlansAsync(cts.Token),
                ConsumePlansAsync(cts.Token)).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Refresh the current snapshots (web auto-refetch / manual refresh / post-apply invalidation).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Run the optimizer for the current form values (web <c>handleOptimize</c>): clears any prior result and the
    /// applied flag, resolves the scoped vehicle, and POSTs the request. On success the result populates the rate
    /// timeline, cost comparison and schedule panels; on failure a localized error is surfaced.
    /// </summary>
    public async Task OptimizeAsync(CancellationToken cancellationToken = default)
    {
        long? vid = await ResolveVehicleAsync(cancellationToken).ConfigureAwait(false);
        if (vid is not { } vehicleId)
        {
            return;
        }

        Applied = false;
        ApplyErrorMessage = null;
        OptimizeErrorMessage = null;
        lock (_gate)
        {
            _result = null;
        }

        Reproject();
        IsOptimizing = true;

        try
        {
            var request = new OptimizeChargeRequestModel(
                vehicleId,
                _targetSoc,
                FormatDepartBy(_departBy),
                _ratePlanId,
                _maxAmps,
                _batteryCapacityKwh);
            var result = await _optimizeClient.OptimizeAsync(request, cancellationToken).ConfigureAwait(false);
            lock (_gate)
            {
                _result = result;
            }

            OptimizeErrorMessage = null;
        }
        catch (OperationCanceledException)
        {
            // The page is navigating away — drop the optimization silently.
        }
        catch (Exception)
        {
            OptimizeErrorMessage = _localizer.GetString("chargePlanner.optimizeError", "Optimization failed");
        }
        finally
        {
            IsOptimizing = false;
            Reproject();
            OnPropertyChanged(nameof(HasResult));
            OnPropertyChanged(nameof(CanApply));
        }
    }

    /// <summary>
    /// Apply the recommended schedule to the vehicle (web <c>handleApply</c>). On success the success chip shows
    /// and the plan history is refreshed (web <c>invalidateAndBroadcast(chargePlannerKeys.all)</c>); on failure a
    /// localized error is surfaced.
    /// </summary>
    public async Task ApplyAsync(CancellationToken cancellationToken = default)
    {
        OptimizeChargeResult? result;
        lock (_gate)
        {
            result = _result;
        }

        if (result is not { } plan)
        {
            return;
        }

        ApplyErrorMessage = null;
        IsApplying = true;

        try
        {
            await _applyClient.ApplyAsync(plan.PlanId, cancellationToken).ConfigureAwait(false);
            Applied = true;
            ApplyErrorMessage = null;
            await RefreshAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // The page is navigating away — drop the apply silently.
        }
        catch (Exception)
        {
            ApplyErrorMessage = _localizer.GetString("chargePlanner.applyError", "Failed to apply schedule");
        }
        finally
        {
            IsApplying = false;
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
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private static DateTimeOffset DefaultDepartBy(DateTimeOffset now)
    {
        var midnight = new DateTimeOffset(now.Year, now.Month, now.Day, 0, 0, 0, now.Offset);
        return midnight.AddDays(1).AddHours(7).AddMinutes(30);
    }

    private static string FormatDepartBy(DateTimeOffset departBy) =>
        departBy.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture);

    private async Task<long?> ResolveVehicleAsync(CancellationToken cancellationToken)
    {
        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        long? id = primary?.VehicleId;
        _vehicleId = id;
        HasVehicle = id is not null;
        return id;
    }

    private async Task ConsumeRatePlansAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _ratePlansSource.StreamAsync(cancellationToken).ConfigureAwait(false))
        {
            IReadOnlyList<RatePlanOption> options = result.HasValue && result.Value!.Count > 0
                ? result.Value!
                : FallbackRatePlans;
            RatePlanOptions = options;
        }
    }

    private async Task ConsumePlansAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _plansSource.StreamAsync(cancellationToken).ConfigureAwait(false))
        {
            lock (_gate)
            {
                _plansResult = result;
                _plans = result.HasValue ? result.Value! : System.Array.Empty<ChargePlanRecord>();
            }

            Recompute();
        }
    }

    private void Recompute()
    {
        RepositoryResult<IReadOnlyList<ChargePlanRecord>> plans;
        SmartChargeDisplay display;
        lock (_gate)
        {
            plans = _plansResult;
            display = BuildDisplay();
        }

        Display = display;
        ApplyHistoryState(plans);
    }

    private void Reproject()
    {
        SmartChargeDisplay display;
        lock (_gate)
        {
            display = BuildDisplay();
        }

        Display = display;
    }

    private void ApplyHistoryState(RepositoryResult<IReadOnlyList<ChargePlanRecord>> plans)
    {
        switch (plans.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }
                else
                {
                    IsFetching = true;
                }

                break;

            case LoadStatus.Cached:
                ApplyContent(plans.FetchedAt, plans.IsStale, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyContent(plans.FetchedAt, plans.IsStale, fetching: true, offline: false, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyContent(plans.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Empty:
                ApplyEmpty(plans.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyContent(plans.FetchedAt, stale: true, fetching: false, offline: true, error: plans.Error);
                break;

            default:
                SetError(plans.Error);
                break;
        }
    }

    private void ApplyContent(DateTimeOffset? fetchedAt, bool stale, bool fetching, bool offline, RepositoryError? error)
    {
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = _plans.Count > 0 ? SmartChargeState.Ready : SmartChargeState.Empty;
    }

    private void ApplyEmpty(DateTimeOffset? fetchedAt)
    {
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = SmartChargeState.Empty;
    }

    private bool HasContent() => _state is SmartChargeState.Ready or SmartChargeState.Empty;

    private SmartChargeDisplay BuildDisplay()
    {
        OptimizeChargeResult? result = _result;
        return SmartChargeProjection.Project(result, _plans, _localizer, _currencySymbol, _currencyPrecision, _clock());
    }

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        ErrorMessage = null;
        State = SmartChargeState.Loading;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = SmartChargeState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "error.offline",
            _ => "error.loadFailed",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your charge plans",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached charge plans",
            _ => "Failed to load data",
        };

        return _localizer.GetString(key, fallback);
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        OnPropertyChanged(name);
        return true;
    }

    private void OnPropertyChanged(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
