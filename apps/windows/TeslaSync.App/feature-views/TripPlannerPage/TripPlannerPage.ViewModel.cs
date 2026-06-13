using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>TripPlannerPage</c> view — the native port of the web page's
/// data flow (web/src/features/driving/pages/TripPlannerPage.tsx). It owns the route-input form state (origin /
/// destination places, the current- and minimum-arrival-SOC sliders, the driving-speed factor), resolves the scoped
/// vehicle through <see cref="IWidgetVehicleSource"/> (the native <c>useSelectedVehicle</c>), runs the plan mutation
/// through <see cref="IPlanTripClient"/> (the native <c>usePlanTrip</c>) and the send-to-car command through
/// <see cref="ISendToCarClient"/> (the native <c>handleSendToCar</c>). Every emission is projected through
/// <see cref="TripPlannerProjection"/> into a render-ready <see cref="Display"/>, and the mutually-exclusive plan
/// <see cref="State"/> (idle / planning / error / success) plus the form/result properties drive the thin view.
/// Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class TripPlannerPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPlanTripClient _planClient;
    private readonly ISendToCarClient _sendToCarClient;
    private readonly IWidgetVehicleSource _vehicles;
    private readonly ILocalizer _localizer;
    private readonly TripPlannerDiagnostics _diagnostics;
    private readonly string _currencySymbol;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private TripPlannerPlanState _state = TripPlannerPlanState.Idle;
    private TripPlannerDisplay _display;

    private TripLocationModel? _origin;
    private TripLocationModel? _destination;
    private int _currentSoc = TripPlannerRegistration.DefaultCurrentSoc;
    private int _minArrivalSoc = TripPlannerRegistration.DefaultMinArrivalSoc;
    private double _speedFactor = TripPlannerRegistration.DefaultSpeedFactor;

    private TripPlanSnapshot? _result;
    private long? _vehicleId;
    private double? _vehicleBatteryLevel;
    private bool _hasVehicle;
    private bool _isPlanning;
    private bool _isError;

    /// <summary>Creates the holder over its mutation ports, vehicle source, localizer, units, currency and diagnostics.</summary>
    /// <param name="planClient">The plan mutation port (native <c>usePlanTrip</c>).</param>
    /// <param name="sendToCarClient">The send-to-car command port (native <c>handleSendToCar</c>).</param>
    /// <param name="vehicles">The selected/primary vehicle source (native <c>useSelectedVehicle</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="currencySymbol">The currency symbol for the cost tile (web <c>useFormatting()</c>); null = "$".</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public TripPlannerPageViewModel(
        IPlanTripClient planClient,
        ISendToCarClient sendToCarClient,
        IWidgetVehicleSource vehicles,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null,
        TripPlannerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(planClient);
        ArgumentNullException.ThrowIfNull(sendToCarClient);
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(localizer);

        _planClient = planClient;
        _sendToCarClient = sendToCarClient;
        _vehicles = vehicles;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _diagnostics = diagnostics ?? new TripPlannerDiagnostics();
        _display = BuildDisplay();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive plan state (idle / planning / error / success).</summary>
    public TripPlannerPlanState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model the view binds to.</summary>
    public TripPlannerDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The chosen origin place (web <c>origin</c>); null until one is picked.</summary>
    public TripLocationModel? Origin
    {
        get => _origin;
        set
        {
            if (Set(ref _origin, value))
            {
                OnPropertyChanged(nameof(CanPlan));
            }
        }
    }

    /// <summary>The chosen destination place (web <c>destination</c>); null until one is picked.</summary>
    public TripLocationModel? Destination
    {
        get => _destination;
        set
        {
            if (Set(ref _destination, value))
            {
                OnPropertyChanged(nameof(CanPlan));
                OnPropertyChanged(nameof(CanSendToCar));
            }
        }
    }

    /// <summary>The current state of charge, percent — bound to the slider (web <c>currentSOC</c>, clamped 10–100).</summary>
    public int CurrentSoc
    {
        get => _currentSoc;
        set => Set(ref _currentSoc, Math.Clamp(value, 10, 100));
    }

    /// <summary>The minimum arrival SOC, percent — bound to the slider (web <c>minArrivalSOC</c>, clamped 5–50).</summary>
    public int MinArrivalSoc
    {
        get => _minArrivalSoc;
        set => Set(ref _minArrivalSoc, Math.Clamp(value, 5, 50));
    }

    /// <summary>The driving-speed factor — bound to the select (web <c>speedFactor</c>).</summary>
    public double SpeedFactor
    {
        get => _speedFactor;
        set => Set(ref _speedFactor, value <= 0 ? 1.0 : value);
    }

    /// <summary>The resolved plan, or null before one is requested (web <c>plan</c>).</summary>
    public TripPlanSnapshot? Result => _result;

    /// <summary>The scoped vehicle id, or null when none is resolved.</summary>
    public long? VehicleId => _vehicleId;

    /// <summary>The scoped vehicle's battery percent, or null when unknown (web <c>currentVehicle?.battery_level</c>).</summary>
    public double? VehicleBatteryLevel => _vehicleBatteryLevel;

    /// <summary>True once a vehicle is resolved — the plan action requires one (web <c>activeVehicle !== ''</c>).</summary>
    public bool HasVehicle
    {
        get => _hasVehicle;
        private set
        {
            if (Set(ref _hasVehicle, value))
            {
                OnPropertyChanged(nameof(CanPlan));
                OnPropertyChanged(nameof(CanSendToCar));
            }
        }
    }

    /// <summary>True while the plan mutation is in flight (web <c>planMutation.isPending</c>).</summary>
    public bool IsPlanning
    {
        get => _isPlanning;
        private set
        {
            if (Set(ref _isPlanning, value))
            {
                OnPropertyChanged(nameof(CanPlan));
            }
        }
    }

    /// <summary>True when the last plan mutation failed (web <c>planMutation.isError</c>).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when a plan result is present (web <c>plan</c> truthiness).</summary>
    public bool HasResult => _result is not null;

    /// <summary>True when the plan action can run (origin, destination and a vehicle resolved, none in flight).</summary>
    public bool CanPlan => _origin is not null && _destination is not null && _hasVehicle && !_isPlanning;

    /// <summary>True when the send-to-car action can run (a plan + destination + vehicle, web gate <c>plan &amp;&amp; destination</c>).</summary>
    public bool CanSendToCar => HasResult && _destination is not null && _hasVehicle;

    /// <summary>The active display-unit preference (web <c>useUnits</c>).</summary>
    public UnitPref Units => _units;

    /// <summary>The active currency symbol (web <c>useFormatting</c>).</summary>
    public string CurrencySymbol => _currencySymbol;

    /// <summary>The active distance display unit (web <c>unitPrefs.distance</c>).</summary>
    public DistanceUnit DistanceUnit => _units.Distance;

    /// <summary>The localized page title (web <c>tripPlanner.title</c>).</summary>
    public string Title => TripPlannerRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>tripPlanner.subtitle</c>).</summary>
    public string Subtitle => TripPlannerRegistration.Subtitle(_localizer);

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Resolve the scoped (primary) vehicle on mount (web <c>useSelectedVehicle</c>): populates the vehicle id and
    /// battery level the form and request use. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        try
        {
            var primary = await _vehicles.GetPrimaryAsync(cts.Token).ConfigureAwait(false);
            _vehicleId = primary?.VehicleId;
            _vehicleBatteryLevel = primary?.BatteryLevel;
            OnPropertyChanged(nameof(VehicleId));
            OnPropertyChanged(nameof(VehicleBatteryLevel));
            HasVehicle = primary is not null && primary.VehicleId > 0;
            Reproject();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop silently.
        }
    }

    /// <summary>
    /// Run the planner for the current form values (web <c>handlePlan</c>): guards on a resolved origin, destination
    /// and vehicle, clears any prior error, POSTs the request and, on success, stores the parsed plan that drives the
    /// summary stats, map, weather, SOC chart and leg list; on failure the error banner is surfaced.
    /// </summary>
    public async Task PlanAsync(CancellationToken cancellationToken = default)
    {
        if (_origin is not { } origin || _destination is not { } destination || _vehicleId is not { } vehicleId)
        {
            return;
        }

        IsError = false;
        IsPlanning = true;
        State = TripPlannerPlanState.Planning;
        Reproject();

        try
        {
            var request = new TripPlanRequestModel(
                vehicleId,
                origin,
                destination,
                _currentSoc,
                TripPlannerRegistration.ChargeLimitSoc,
                _minArrivalSoc,
                _speedFactor);

            var result = await _planClient.PlanAsync(request, cancellationToken).ConfigureAwait(false);
            _result = result;
            IsError = false;
            State = TripPlannerPlanState.Success;
        }
        catch (OperationCanceledException)
        {
            // The page is navigating away — drop the plan silently.
        }
        catch (Exception)
        {
            IsError = true;
            State = TripPlannerPlanState.Error;
        }
        finally
        {
            IsPlanning = false;
            Reproject();
            OnPropertyChanged(nameof(Result));
            OnPropertyChanged(nameof(HasResult));
            OnPropertyChanged(nameof(CanSendToCar));
        }
    }

    /// <summary>
    /// Send the planned destination to the vehicle (web <c>handleSendToCar</c>): POSTs a navigation request and
    /// swallows any failure exactly as the web's fire-and-forget try/catch does.
    /// </summary>
    public async Task SendToCarAsync(CancellationToken cancellationToken = default)
    {
        if (_destination is not { } destination || _vehicleId is not { } vehicleId || !HasResult)
        {
            return;
        }

        try
        {
            await _sendToCarClient.SendNavigationAsync(vehicleId, destination.Lat, destination.Lng, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // The page is navigating away — drop the command silently.
        }
        catch (Exception)
        {
            // Web parity: errors are handled by the mutation/toast layer, never surfaced inline here.
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

    private void Reproject() => Display = BuildDisplay();

    private TripPlannerDisplay BuildDisplay() => TripPlannerProjection.Project(
        _result, _vehicleBatteryLevel, _isPlanning, _isError, _units, _currencySymbol, _localizer);

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
