using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.FeatureViews.Driving;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TripPlannerPage</c> surface's Microsoft.UI-free logic — the tolerant trip-plan
/// parser (route / legs / charge stops / weather / SOC curve), the SI→display projection (distance / duration /
/// energy / cost with units + currency and the interpolated battery + weather captions), the plan-mutation
/// view-model's loading / error / success matrix plus the vehicle resolve and send-to-car command, and the two
/// generated-client adapters' request shaping (web <c>usePlanTrip</c> + <c>handleSendToCar</c>). The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the <see cref="TripPlannerDisplay"/>
/// flags asserted here. Mirrors the web spec (web/src/features/driving/pages/TripPlannerPage.tsx).
/// </summary>
public sealed class TripPlannerPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The 30 i18n keys the manifest requires the page to resolve (web key names).
    private static readonly string[] RequiredStringKeys =
    [
        "common.free",
        "tripPlanner.disclaimer",
        "tripPlanner.form.currentSOC", "tripPlanner.form.destination", "tripPlanner.form.drivingSpeed",
        "tripPlanner.form.error", "tripPlanner.form.from", "tripPlanner.form.minArrival", "tripPlanner.form.origin",
        "tripPlanner.form.planTrip", "tripPlanner.form.planning", "tripPlanner.form.sendToCar",
        "tripPlanner.form.title", "tripPlanner.form.to", "tripPlanner.form.vehicleBattery",
        "tripPlanner.notFeasible",
        "tripPlanner.speed.brisk", "tripPlanner.speed.fast", "tripPlanner.speed.normal", "tripPlanner.speed.relaxed",
        "tripPlanner.stats.chargingTime", "tripPlanner.stats.cost", "tripPlanner.stats.distance",
        "tripPlanner.stats.drivingTime", "tripPlanner.stats.energy", "tripPlanner.stats.totalTime",
        "tripPlanner.subtitle", "tripPlanner.title",
        "tripPlanner.weather.factor", "tripPlanner.weather.title",
    ];

    private const string PlanJson = """
    {
      "route": {
        "total_distance_m": 450000, "total_duration_s": 18000, "driving_duration_s": 14400,
        "charging_duration_s": 3600, "total_energy_wh": 75000, "estimated_cost": 12.5,
        "arrival_soc": 25, "feasible": true, "is_estimate": true
      },
      "legs": [
        { "from": {"lat":1,"lng":2,"name":"A"}, "to": {"lat":3,"lng":4,"name":"B"},
          "distance_m":450000, "duration_s":14400, "energy_wh":75000, "start_soc":80, "arrival_soc":25 }
      ],
      "charge_stops": [
        { "name":"Supercharger", "location": {"lat":3,"lng":4}, "charge_from_soc":20, "charge_to_soc":80,
          "charge_duration_s":3600, "energy_wh":40000, "cost":10, "is_recommended": true }
      ],
      "weather_impact": { "avg_temp_c": -5, "efficiency_factor": 0.85, "note": "Cold weather reduces range" },
      "soc_curve": [ {"distance_m":0,"soc":80}, {"distance_m":225000,"soc":50}, {"distance_m":450000,"soc":25} ]
    }
    """;

    private static TripPlanSnapshot Plan(string json = PlanJson)
    {
        using var doc = JsonDocument.Parse(json);
        return TripPlanSnapshot.FromJson(doc.RootElement);
    }

    // ---- Parser -------------------------------------------------------------------

    [Fact]
    public void Parser_reads_the_route_legs_stops_weather_and_curve()
    {
        var plan = Plan();

        Assert.Equal(450000, plan.Route.TotalDistanceM);
        Assert.Equal(18000, plan.Route.TotalDurationS);
        Assert.Equal(3600, plan.Route.ChargingDurationS);
        Assert.Equal(75000, plan.Route.TotalEnergyWh);
        Assert.Equal(12.5, plan.Route.EstimatedCost);
        Assert.True(plan.Route.Feasible);
        Assert.True(plan.Route.IsEstimate);

        Assert.Single(plan.MapLegs);
        Assert.Equal(1, plan.MapLegs[0].From.Lat);
        Assert.Equal(4, plan.MapLegs[0].To.Lng);

        Assert.Single(plan.MapStops);
        Assert.Equal("Supercharger", plan.MapStops[0].Name);

        Assert.Equal(3, plan.SocCurve.Count);
        Assert.Equal(80, plan.SocCurve[0].Soc);
        Assert.Single(plan.ChargeStopSocs);
        Assert.Equal(20, plan.ChargeStopSocs[0].ChargeFromSoc);

        Assert.Equal(-5, plan.Weather.AvgTempC);
        Assert.Equal(0.85, plan.Weather.EfficiencyFactor);
        Assert.True(plan.Weather.HasImpact);
        Assert.Equal(JsonValueKind.Object, plan.RawPlan.ValueKind);
    }

    [Fact]
    public void Parser_tolerates_an_empty_or_partial_payload()
    {
        using var empty = JsonDocument.Parse("{}");
        var plan = TripPlanSnapshot.FromJson(empty.RootElement);

        Assert.Equal(0, plan.Route.TotalDistanceM);
        Assert.True(plan.Route.Feasible);
        Assert.False(plan.Route.IsEstimate);
        Assert.Empty(plan.MapLegs);
        Assert.Empty(plan.MapStops);
        Assert.Empty(plan.SocCurve);
        Assert.False(plan.Weather.HasImpact);

        using var partial = JsonDocument.Parse("""{"route":{"total_distance_m":1000},"legs":"oops"}""");
        var p2 = TripPlanSnapshot.FromJson(partial.RootElement);
        Assert.Equal(1000, p2.Route.TotalDistanceM);
        Assert.Empty(p2.MapLegs);
    }

    // ---- Projection: strings -------------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        TripPlannerProjection.Project(Plan(), vehicleBatteryLevel: 72, isPlanning: false, isError: true,
            UnitPref.Metric, "$", recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_interpolates_the_battery_and_weather_captions()
    {
        var display = TripPlannerProjection.Project(Plan(), vehicleBatteryLevel: 72, isPlanning: false,
            isError: false, UnitPref.Metric, "$", Localizer);

        Assert.Equal("Vehicle at 72%", display.VehicleBatteryText);
        Assert.True(display.HasVehicleBattery);
        Assert.Equal("Efficiency factor: 0.85\u00D7", display.WeatherFactorText);
        Assert.True(display.ShowWeatherFactor);
    }

    [Fact]
    public void Projection_hides_the_battery_caption_when_no_level_is_reported()
    {
        var display = TripPlannerProjection.Project(Plan(), vehicleBatteryLevel: null, isPlanning: false,
            isError: false, UnitPref.Metric, "$", Localizer);

        Assert.False(display.HasVehicleBattery);
    }

    // ---- Projection: the six stat tiles -------------------------------------------

    [Fact]
    public void Projection_formats_the_six_summary_stats()
    {
        var display = TripPlannerProjection.Project(Plan(), vehicleBatteryLevel: 72, isPlanning: false,
            isError: false, UnitPref.Metric, "$", Localizer);

        Assert.True(display.ShowStats);
        Assert.Equal(6, display.Stats.Count);

        Assert.Contains("450", Stat(display, "distance").Value);
        Assert.Equal("5h 0m", Stat(display, "totalTime").Value);
        Assert.Equal("4h 0m", Stat(display, "drivingTime").Value);
        Assert.Equal("1h 0m", Stat(display, "chargingTime").Value);
        Assert.Contains("75", Stat(display, "energy").Value);
        Assert.Equal("$12.50", Stat(display, "cost").Value);
    }

    [Fact]
    public void Projection_shows_the_free_cost_label_when_the_route_is_free()
    {
        var display = TripPlannerProjection.Project(Plan(FreePlanJson), vehicleBatteryLevel: null,
            isPlanning: false, isError: false, UnitPref.Metric, "$", Localizer);

        Assert.Equal("Free", Stat(display, "cost").Value);
        Assert.Equal("\u2014", Stat(display, "chargingTime").Value); // charging_duration_s == 0 → em dash
    }

    [Fact]
    public void Projection_dashes_every_stat_before_a_plan_resolves()
    {
        var display = TripPlannerProjection.Project(result: null, vehicleBatteryLevel: null, isPlanning: false,
            isError: false, UnitPref.Metric, "$", Localizer);

        Assert.False(display.ShowStats);
        foreach (var stat in display.Stats)
        {
            Assert.Equal("\u2014", stat.Value);
        }
    }

    // ---- Projection: the branch gates (panels / states) ---------------------------

    [Fact]
    public void Projection_gates_the_disclaimer_feasibility_and_weather_panels()
    {
        var estimate = TripPlannerProjection.Project(Plan(), vehicleBatteryLevel: null, isPlanning: false,
            isError: false, UnitPref.Metric, "$", Localizer);
        Assert.True(estimate.ShowDisclaimer);            // route.is_estimate
        Assert.False(estimate.ShowFeasibilityWarning);   // feasible == true
        Assert.True(estimate.ShowWeather);               // efficiency_factor != 1.0

        var infeasible = TripPlannerProjection.Project(Plan(InfeasiblePlanJson), vehicleBatteryLevel: null,
            isPlanning: false, isError: false, UnitPref.Metric, "$", Localizer);
        Assert.False(infeasible.ShowDisclaimer);         // is_estimate == false
        Assert.True(infeasible.ShowFeasibilityWarning);  // feasible == false
        Assert.False(infeasible.ShowWeather);            // efficiency_factor == 1.0
    }

    [Fact]
    public void Projection_surfaces_the_three_data_states()
    {
        // loading — the action label switches to "Planning..." while in flight.
        var loading = TripPlannerProjection.Project(result: null, vehicleBatteryLevel: null, isPlanning: true,
            isError: false, UnitPref.Metric, "$", Localizer);
        Assert.Equal(loading.PlanningText, loading.PlanButtonText);
        Assert.False(loading.ShowPlanError);

        // error — the plan-error banner shows.
        var error = TripPlannerProjection.Project(result: null, vehicleBatteryLevel: null, isPlanning: false,
            isError: true, UnitPref.Metric, "$", Localizer);
        Assert.True(error.ShowPlanError);

        // success — the result regions render.
        var success = TripPlannerProjection.Project(Plan(), vehicleBatteryLevel: null, isPlanning: false,
            isError: false, UnitPref.Metric, "$", Localizer);
        Assert.True(success.ShowStats);
        Assert.Equal(success.PlanTripText, success.PlanButtonText);
    }

    // ---- View-model: the plan-mutation matrix -------------------------------------

    [Fact]
    public async Task ViewModel_resolves_the_scoped_vehicle_on_load()
    {
        using var vm = NewViewModel(vehicle: Vehicle(5, batteryLevel: 72));

        await vm.LoadAsync();

        Assert.True(vm.HasVehicle);
        Assert.Equal(5, vm.VehicleId);
        Assert.Equal(72, vm.VehicleBatteryLevel);
        Assert.True(vm.Display.HasVehicleBattery);
    }

    [Fact]
    public async Task ViewModel_can_plan_requires_origin_destination_and_vehicle()
    {
        using var vm = NewViewModel(vehicle: Vehicle(5));
        await vm.LoadAsync();
        Assert.False(vm.CanPlan);

        vm.Origin = new TripLocationModel(1, 2, "A");
        Assert.False(vm.CanPlan);

        vm.Destination = new TripLocationModel(3, 4, "B");
        Assert.True(vm.CanPlan);
    }

    [Fact]
    public async Task ViewModel_plans_a_trip_then_resolves_success()
    {
        var client = new FakePlanTripClient(Plan());
        using var vm = NewViewModel(vehicle: Vehicle(5), planClient: client);
        await vm.LoadAsync();
        vm.Origin = new TripLocationModel(1, 2, "A");
        vm.Destination = new TripLocationModel(3, 4, "B");

        await vm.PlanAsync();

        Assert.Equal(TripPlannerPlanState.Success, vm.State);
        Assert.True(vm.HasResult);
        Assert.True(vm.Display.ShowStats);
        Assert.True(vm.CanSendToCar);
    }

    [Fact]
    public async Task ViewModel_marks_the_planning_state_while_in_flight()
    {
        var gate = new GatedPlanTripClient();
        using var vm = NewViewModel(vehicle: Vehicle(5), planClient: gate);
        await vm.LoadAsync();
        vm.Origin = new TripLocationModel(1, 2, "A");
        vm.Destination = new TripLocationModel(3, 4, "B");

        var planTask = vm.PlanAsync();
        Assert.True(vm.IsPlanning);
        Assert.Equal(TripPlannerPlanState.Planning, vm.State);
        Assert.Equal(vm.Display.PlanningText, vm.Display.PlanButtonText);

        gate.Complete(Plan());
        await planTask;

        Assert.False(vm.IsPlanning);
        Assert.Equal(TripPlannerPlanState.Success, vm.State);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_plan_failure()
    {
        using var vm = NewViewModel(vehicle: Vehicle(5), planClient: new ThrowingPlanTripClient());
        await vm.LoadAsync();
        vm.Origin = new TripLocationModel(1, 2, "A");
        vm.Destination = new TripLocationModel(3, 4, "B");

        await vm.PlanAsync();

        Assert.Equal(TripPlannerPlanState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.ShowPlanError);
        Assert.False(vm.HasResult);
    }

    [Fact]
    public async Task ViewModel_sends_the_destination_to_the_car()
    {
        var send = new FakeSendToCarClient();
        using var vm = NewViewModel(vehicle: Vehicle(5), planClient: new FakePlanTripClient(Plan()), sendClient: send);
        await vm.LoadAsync();
        vm.Origin = new TripLocationModel(1, 2, "A");
        vm.Destination = new TripLocationModel(3.5, 4.5, "B");
        await vm.PlanAsync();

        await vm.SendToCarAsync();

        Assert.Equal(1, send.Calls);
        Assert.Equal(5, send.LastVehicleId);
        Assert.Equal(3.5, send.LastLat);
        Assert.Equal(4.5, send.LastLng);
    }

    [Fact]
    public async Task ViewModel_does_not_send_to_car_without_a_plan()
    {
        var send = new FakeSendToCarClient();
        using var vm = NewViewModel(vehicle: Vehicle(5), sendClient: send);
        await vm.LoadAsync();
        vm.Destination = new TripLocationModel(3.5, 4.5, "B");

        await vm.SendToCarAsync();

        Assert.Equal(0, send.Calls);
    }

    [Fact]
    public void ViewModel_records_a_pii_safe_view_opened_event()
    {
        var lines = new List<string>();
        using var vm = new TripPlannerPageViewModel(
            NoopPlanTripClient.Instance, NoopSendToCarClient.Instance, TripPlannerNoVehicleSource.Instance,
            Localizer, diagnostics: new TripPlannerDiagnostics(lines.Add));

        vm.NotifyOpened();

        Assert.Contains("view.opened slug=TripPlannerPage", lines);
    }

    // ---- Source: generated-client request shaping ---------------------------------

    [Fact]
    public async Task PlanTripClient_shapes_the_plan_request()
    {
        var api = new StubApiClient(PlanJson);
        var client = new PlanTripClient(api);

        var request = new TripPlanRequestModel(
            7, new TripLocationModel(1, 2, "A"), new TripLocationModel(3, 4, "B"), 80, 90, 20, 1.2);
        await client.PlanAsync(request);

        Assert.NotNull(api.LastRequest);
        Assert.Equal("post_api_v1_trip_planner_plan", api.LastRequest!.OperationId);

        var body = Assert.IsType<Dictionary<string, object?>>(api.LastRequest.Body);
        Assert.Equal(7L, body["vehicle_id"]);
        Assert.Equal(80, body["current_soc"]);
        Assert.Equal(90, body["charge_limit_soc"]);
        Assert.Equal(20, body["min_arrival_soc"]);

        var origin = Assert.IsType<Dictionary<string, object?>>(body["origin"]);
        Assert.Equal(1d, origin["lat"]);
        Assert.Equal("A", origin["name"]);

        var prefs = Assert.IsType<Dictionary<string, object?>>(body["preferences"]);
        Assert.Equal(1.2, prefs["speed_factor"]);
        Assert.Equal(true, prefs["include_weather"]);
        Assert.Equal(true, prefs["prefer_superchargers"]);
    }

    [Fact]
    public async Task SendToCarClient_shapes_the_navigation_command()
    {
        var api = new StubApiClient("{}");
        var client = new SendToCarClient(api);

        await client.SendNavigationAsync(7, 12.5, -8.25);

        Assert.NotNull(api.LastRequest);
        Assert.Equal("post_api_v1_vehicles_vehicleID_command", api.LastRequest!.OperationId);
        Assert.Equal("7", api.LastRequest.PathParams!["vehicleID"]);

        var body = Assert.IsType<Dictionary<string, object?>>(api.LastRequest.Body);
        Assert.Equal("navigation_request", body["command"]);
        var prms = Assert.IsType<Dictionary<string, object?>>(body["params"]);
        Assert.Equal(12.5, prms["lat"]);
        Assert.Equal(-8.25, prms["lon"]); // web parity: the command param is "lon", not "lng"
    }

    // ---- Registration -------------------------------------------------------------

    [Fact]
    public void Registration_mirrors_the_web_route_and_constants()
    {
        Assert.Equal("TripPlanner", TripPlannerRegistration.RouteName);
        Assert.Equal("trip-planner", TripPlannerRegistration.Route);
        Assert.Equal("TripPlannerPage", TripPlannerRegistration.Slug);
        Assert.Equal(90, TripPlannerRegistration.ChargeLimitSoc);
        Assert.Equal("Trip Planner", TripPlannerRegistration.Title(Localizer));
        Assert.Equal(
            "Plan your route with range estimation and charging stops",
            TripPlannerRegistration.Subtitle(Localizer));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private const string FreePlanJson = """
    {
      "route": { "total_distance_m": 100000, "total_duration_s": 7200, "driving_duration_s": 7200,
        "charging_duration_s": 0, "total_energy_wh": 15000, "estimated_cost": 0,
        "arrival_soc": 60, "feasible": true, "is_estimate": false },
      "weather_impact": { "avg_temp_c": null, "efficiency_factor": 1.0, "note": "" },
      "soc_curve": [], "legs": [], "charge_stops": []
    }
    """;

    private const string InfeasiblePlanJson = """
    {
      "route": { "total_distance_m": 900000, "total_duration_s": 36000, "driving_duration_s": 36000,
        "charging_duration_s": 0, "total_energy_wh": 150000, "estimated_cost": 0,
        "arrival_soc": 2, "feasible": false, "is_estimate": false },
      "weather_impact": { "avg_temp_c": null, "efficiency_factor": 1.0, "note": "" },
      "soc_curve": [], "legs": [], "charge_stops": []
    }
    """;

    private static TripStat Stat(TripPlannerDisplay display, string key)
    {
        foreach (var stat in display.Stats)
        {
            if (string.Equals(stat.Key, key, StringComparison.Ordinal))
            {
                return stat;
            }
        }

        throw new KeyNotFoundException(key);
    }

    private static WidgetVehicleSnapshot Vehicle(long id, double? batteryLevel = null) =>
        new() { VehicleId = id, DisplayName = "Test", BatteryLevel = batteryLevel };

    private static TripPlannerPageViewModel NewViewModel(
        WidgetVehicleSnapshot? vehicle = null,
        IPlanTripClient? planClient = null,
        ISendToCarClient? sendClient = null) =>
        new(
            planClient ?? new FakePlanTripClient(Plan()),
            sendClient ?? new FakeSendToCarClient(),
            new FakeVehicleSource(vehicle),
            Localizer,
            UnitPref.Metric,
            "$");

    private sealed class FakeVehicleSource(WidgetVehicleSnapshot? vehicle) : IWidgetVehicleSource
    {
        public Task<WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(vehicle);

        public Task<WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
            Task.FromResult(vehicle);
    }

    private sealed class FakePlanTripClient(TripPlanSnapshot result) : IPlanTripClient
    {
        public Task<TripPlanSnapshot> PlanAsync(TripPlanRequestModel request, CancellationToken cancellationToken = default) =>
            Task.FromResult(result);
    }

    private sealed class ThrowingPlanTripClient : IPlanTripClient
    {
        public Task<TripPlanSnapshot> PlanAsync(TripPlanRequestModel request, CancellationToken cancellationToken = default) =>
            Task.FromException<TripPlanSnapshot>(new InvalidOperationException("plan failed"));
    }

    private sealed class GatedPlanTripClient : IPlanTripClient
    {
        private readonly TaskCompletionSource<TripPlanSnapshot> _gate =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<TripPlanSnapshot> PlanAsync(TripPlanRequestModel request, CancellationToken cancellationToken = default) =>
            _gate.Task;

        public void Complete(TripPlanSnapshot result) => _gate.SetResult(result);
    }

    private sealed class FakeSendToCarClient : ISendToCarClient
    {
        public int Calls { get; private set; }

        public long LastVehicleId { get; private set; }

        public double LastLat { get; private set; }

        public double LastLng { get; private set; }

        public Task SendNavigationAsync(long vehicleId, double lat, double lng, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastVehicleId = vehicleId;
            LastLat = lat;
            LastLng = lng;
            return Task.CompletedTask;
        }
    }

    private sealed class StubApiClient(string json) : IApiClient
    {
        private readonly JsonElement _element = JsonDocument.Parse(json).RootElement.Clone();

        public ApiRequest? LastRequest { get; private set; }

        public GeneratedApi.EndpointDescriptor ResolveEndpoint(string operationId) =>
            throw new NotSupportedException("The Trip Planner source tests never resolve endpoint descriptors directly.");

        public Task<T> SendAsync<T>(ApiRequest request, CancellationToken cancellationToken = default)
        {
            LastRequest = request;
            return Task.FromResult((T)(object)_element);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
