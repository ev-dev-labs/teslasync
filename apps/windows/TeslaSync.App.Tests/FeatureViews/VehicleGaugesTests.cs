using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the VehicleGauges surface's UI-thread-free logic — the vehicle/state parse
/// adapters, the <c>parseModelKey</c> port, the projection (the four radial gauges, the metric bars, the
/// status chips, the colour selection, the unit conversion, the i18n keys and the accessibility labels), the
/// registration metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/vehicles/components/VehicleGauges.tsx).
/// </summary>
public sealed class VehicleGaugesTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private const string CyanBrush = "TsChartSpeedBrush";
    private const string PurpleBrush = "TsChartPowerBrush";
    private const string GoodBrush = "TsColorSuccessBrush";
    private const string WarnBrush = "TsColorWarningBrush";
    private const string BadBrush = "TsColorDangerBrush";
    private const string MutedBrush = "TsColorTextMutedBrush";

    // ---- Parse: model key (web parseModelKey) --------------------------------------

    [Theory]
    [InlineData("Model 3 P", TeslaModelKey.Model3)]
    [InlineData("Model 3", TeslaModelKey.Model3)]
    [InlineData("Model S Plaid", TeslaModelKey.ModelS)]
    [InlineData("Model Y Long Range", TeslaModelKey.ModelY)]
    [InlineData("Model X", TeslaModelKey.ModelX)]
    [InlineData("Cybertruck", TeslaModelKey.Cybertruck)]
    [InlineData("", TeslaModelKey.Model3)]
    [InlineData(null, TeslaModelKey.Model3)]
    public void ParseModelKey_matches_the_web(string? model, TeslaModelKey expected) =>
        Assert.Equal(expected, VehicleGaugesVehicle.ParseModelKey(model));

    // ---- Parse: vehicle identity ---------------------------------------------------

    [Fact]
    public void FromVehiclesArray_prefers_the_matching_id()
    {
        var v = VehicleGaugesVehicle.FromVehiclesArray(
            Json("""[ { "id": 1, "vin": "AAA" }, { "id": 7, "display_name": "My Tesla", "vin": "BBB", "model": "Model 3", "exterior_color": "PearlWhite" } ]"""),
            preferredId: 7);

        Assert.NotNull(v);
        Assert.Equal(7, v!.Id);
        Assert.Equal("My Tesla", v.DisplayName);
        Assert.Equal("BBB", v.Vin);
        Assert.Equal("PearlWhite", v.ExteriorColor);
        Assert.Equal(TeslaModelKey.Model3, v.ModelKey);
    }

    [Fact]
    public void FromVehiclesArray_falls_back_to_the_first_entry()
    {
        var byNull = VehicleGaugesVehicle.FromVehiclesArray(Json("""[ { "id": 3, "vin": "ZZZ" }, { "id": 4 } ]"""), preferredId: null);
        Assert.Equal(3, byNull!.Id);

        var noMatch = VehicleGaugesVehicle.FromVehiclesArray(Json("""[ { "id": 3, "vin": "ZZZ" }, { "id": 4 } ]"""), preferredId: 99);
        Assert.Equal(3, noMatch!.Id);
    }

    [Fact]
    public void FromVehiclesArray_returns_null_for_empty_or_non_array()
    {
        Assert.Null(VehicleGaugesVehicle.FromVehiclesArray(Json("[]"), null));
        Assert.Null(VehicleGaugesVehicle.FromVehiclesArray(Json("{}"), null));
        Assert.Null(VehicleGaugesVehicle.FromVehiclesArray(Json("null"), null));
    }

    [Fact]
    public void Vehicle_name_prefers_display_name_then_vin()
    {
        Assert.Equal("My Tesla", new VehicleGaugesVehicle(1, "My Tesla", "VIN", "", "").Name);
        Assert.Equal("VIN", new VehicleGaugesVehicle(1, "  ", "VIN", "", "").Name);
    }

    // ---- Parse: telemetry ----------------------------------------------------------

    [Fact]
    public void FromResponse_reads_the_canonical_state_object()
    {
        var t = VehicleGaugesTelemetry.FromResponse(Json("""
        { "state": { "vehicle_id": 7, "state": "driving", "battery_level": 72, "rated_range": 410000, "speed": 25,
          "charger_power": 0, "charge_rate": 0, "is_charging": false, "is_climate_on": true, "is_locked": true,
          "sentry_mode": false, "software_version": "2026.8.9" } }
        """));

        Assert.NotNull(t);
        Assert.Equal("driving", t!.Status);
        Assert.Equal(72, t.BatteryLevel);
        Assert.Equal(410000, t.RatedRangeMeters);
        Assert.Equal(25, t.SpeedMps);
        Assert.True(t.IsClimateOn);
        Assert.True(t.IsLocked);
        Assert.False(t.SentryMode);
        Assert.Equal("2026.8.9", t.SoftwareVersion);
    }

    [Fact]
    public void FromResponse_reads_a_plain_state_object()
    {
        var t = VehicleGaugesTelemetry.FromResponse(Json("""{ "state": { "state": "charging", "battery_level": 55, "is_charging": true, "charger_power": 11, "charge_rate": 50000 } }"""));

        Assert.NotNull(t);
        Assert.Equal("charging", t!.Status);
        Assert.Equal(55, t.BatteryLevel);
        Assert.True(t.IsCharging);
        Assert.Equal(11, t.ChargerPowerKw);
        Assert.Equal(50000, t.ChargeRateMeters);
    }

    [Fact]
    public void FromResponse_returns_null_when_asleep_or_stateless()
    {
        Assert.Null(VehicleGaugesTelemetry.FromResponse(Json("{}")));
        Assert.Null(VehicleGaugesTelemetry.FromResponse(Json("""{ "state": null }""")));
        Assert.Null(VehicleGaugesTelemetry.FromResponse(Json("null")));
    }

    [Fact]
    public void FromResponse_rebuilds_from_the_position_fallback()
    {
        var t = VehicleGaugesTelemetry.FromResponse(Json("""
        { "vehicle": { "state": "asleep" }, "position": { "battery_level": 40, "rated_range": 300000, "is_locked": true },
          "is_charging": true, "is_climate_on": true, "charger_power": 7 }
        """));

        Assert.NotNull(t);
        Assert.Equal("asleep", t!.Status);
        Assert.Equal(40, t.BatteryLevel);
        Assert.Equal(300000, t.RatedRangeMeters);
        Assert.True(t.IsCharging);
        Assert.True(t.IsClimateOn);
        Assert.True(t.IsLocked);
        Assert.Equal(7, t.ChargerPowerKw);
    }

    // ---- Projection: empty ---------------------------------------------------------

    [Fact]
    public void Project_with_no_state_is_empty()
    {
        var view = Project(Data(null));

        Assert.False(view.HasData);
        Assert.Null(view.Car);
        Assert.Empty(view.Gauges);
        Assert.Empty(view.Metrics);
        Assert.Empty(view.Chips);
        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
    }

    [Fact]
    public void Project_with_no_vehicle_is_empty()
    {
        var view = VehicleGaugesProjection.Project(new VehicleGaugesData(VehicleGaugesVehicle.None, State()), UnitPref.Metric, Localizer);
        Assert.False(view.HasData);
    }

    // ---- Projection: gauges --------------------------------------------------------

    [Fact]
    public void Project_renders_the_four_gauges_in_web_order()
    {
        var view = Project(Data(State(speed: 25)));

        Assert.Equal(new[] { "battery", "range", "speed", "power" }, view.Gauges.Select(g => g.Key).ToArray());
        Assert.True(view.HasData);
        Assert.NotNull(view.Car);
    }

    [Fact]
    public void Battery_gauge_color_follows_state_of_charge()
    {
        Assert.Equal(GoodBrush, Gauge(Project(Data(State(battery: 73))), "battery").BrushKey);
        Assert.Equal(WarnBrush, Gauge(Project(Data(State(battery: 40))), "battery").BrushKey);
        Assert.Equal(BadBrush, Gauge(Project(Data(State(battery: 10))), "battery").BrushKey);
    }

    [Fact]
    public void Battery_gauge_carries_value_max_and_unit()
    {
        var g = Gauge(Project(Data(State(battery: 73))), "battery");
        Assert.Equal(73, g.Value);
        Assert.Equal(100, g.Max);
        Assert.Equal("%", g.Unit);
    }

    [Fact]
    public void Range_gauge_converts_to_metric_and_imperial()
    {
        var metric = Gauge(Project(Data(State(ratedRange: 410000)), UnitPref.Metric), "range");
        Assert.Equal(410, metric.Value);
        Assert.Equal("km", metric.Unit);
        Assert.Equal(CyanBrush, metric.BrushKey);

        var imperial = Gauge(Project(Data(State(ratedRange: 410000)), UnitPref.Imperial), "range");
        Assert.Equal(255, imperial.Value); // 410000 / 1609.344 = 254.76 → 255
        Assert.Equal("mi", imperial.Unit);
    }

    [Fact]
    public void Speed_gauge_is_purple_when_moving_and_muted_when_parked()
    {
        var moving = Gauge(Project(Data(State(speed: 25)), UnitPref.Metric), "speed");
        Assert.Equal(90, moving.Value); // 25 m/s → 90 km/h
        Assert.Equal("km/h", moving.Unit);
        Assert.Equal(PurpleBrush, moving.BrushKey);

        Assert.Equal(MutedBrush, Gauge(Project(Data(State(speed: 0))), "speed").BrushKey);
    }

    [Fact]
    public void Power_gauge_is_green_while_charging_and_muted_otherwise()
    {
        var charging = Gauge(Project(Data(State(charging: true, chargerPower: 11))), "power");
        Assert.Equal(11, charging.Value);
        Assert.Equal(250, charging.Max);
        Assert.Equal("kW", charging.Unit);
        Assert.Equal(GoodBrush, charging.BrushKey);

        Assert.Equal(MutedBrush, Gauge(Project(Data(State(charging: false))), "power").BrushKey);
    }

    // ---- Projection: metric bars ---------------------------------------------------

    [Fact]
    public void Metric_bars_omit_charge_rate_when_not_charging()
    {
        var view = Project(Data(State(charging: false)));
        Assert.Equal(new[] { "battery-level", "estimated-range" }, view.Metrics.Select(m => m.Key).ToArray());
        Assert.False(view.IsCharging);
    }

    [Fact]
    public void Metric_bars_include_charge_rate_when_charging()
    {
        var view = Project(Data(State(charging: true, chargerPower: 11, chargeRate: 50000)));
        Assert.Equal(new[] { "battery-level", "estimated-range", "charge-rate" }, view.Metrics.Select(m => m.Key).ToArray());
        Assert.True(view.IsCharging);

        var rate = Metric(view, "charge-rate");
        Assert.Equal(GoodBrush, rate.BrushKey);
        Assert.EndsWith("/h", rate.ValueText);
    }

    [Fact]
    public void Battery_level_bar_color_and_value_text()
    {
        var bar = Metric(Project(Data(State(battery: 73))), "battery-level");
        Assert.Equal(GoodBrush, bar.BrushKey);
        Assert.Equal("73%", bar.ValueText);
        Assert.Equal(73, bar.Value);
        Assert.Equal(100, bar.Max);
    }

    [Fact]
    public void Estimated_range_bar_uses_cyan_and_formats_distance()
    {
        var bar = Metric(Project(Data(State(ratedRange: 410000)), UnitPref.Metric), "estimated-range");
        Assert.Equal(CyanBrush, bar.BrushKey);
        Assert.Contains("410", bar.ValueText);
        Assert.Contains("km", bar.ValueText);
    }

    // ---- Projection: chips ---------------------------------------------------------

    [Fact]
    public void Chips_render_lock_sentry_climate_and_firmware()
    {
        var view = Project(Data(State(locked: true, sentry: true, climate: true, software: "2026.8.9")));
        Assert.Equal(new[] { "lock", "sentry", "climate", "firmware" }, view.Chips.Select(c => c.Key).ToArray());

        Assert.Equal(GoodBrush, Chip(view, "lock").BrushKey);   // locked → green
        Assert.Equal(BadBrush, Chip(view, "sentry").BrushKey);  // sentry on → red
        Assert.Equal(CyanBrush, Chip(view, "climate").BrushKey); // climate on → cyan
        Assert.Equal(PurpleBrush, Chip(view, "firmware").BrushKey);
        Assert.Equal("2026.8.9", Chip(view, "firmware").Label);
    }

    [Fact]
    public void Chips_reflect_off_states()
    {
        var view = Project(Data(State(locked: false, sentry: false, climate: false, software: "")));
        Assert.Equal(WarnBrush, Chip(view, "lock").BrushKey);    // unlocked → amber
        Assert.Equal(MutedBrush, Chip(view, "sentry").BrushKey); // sentry off → muted
        Assert.Equal(MutedBrush, Chip(view, "climate").BrushKey); // climate off → muted
        Assert.Equal("N/A", Chip(view, "firmware").Label);
    }

    // ---- Projection: car visualization ---------------------------------------------

    [Fact]
    public void Car_mirrors_the_live_state()
    {
        var car = Project(Data(State(speed: 25, charging: true, locked: true, sentry: true))).Car;
        Assert.NotNull(car);
        Assert.True(car!.IsDriving);
        Assert.True(car.IsCharging);
        Assert.True(car.Locked);
        Assert.True(car.SentryMode);
        Assert.False(string.IsNullOrWhiteSpace(car.AutomationName));
    }

    // ---- Accessibility -------------------------------------------------------------

    [Fact]
    public void Every_gauge_metric_and_chip_has_a_narrator_name()
    {
        var view = Project(Data(State(charging: true, chargerPower: 11, chargeRate: 50000, speed: 25)));

        Assert.All(view.Gauges, g => Assert.False(string.IsNullOrWhiteSpace(g.AutomationName)));
        Assert.All(view.Metrics, m => Assert.False(string.IsNullOrWhiteSpace(m.AutomationName)));
        Assert.All(view.Chips, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
        Assert.Contains("Battery", Gauge(view, "battery").AutomationName);
    }

    // ---- View-model: per-state transitions -----------------------------------------

    [Fact]
    public async Task Loading_shows_the_skeleton_state()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugesData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(VehicleGaugesState.Loading, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task Loaded_projects_the_gauges()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleGaugesData>.Loading(),
            RepositoryResult<VehicleGaugesData>.Loaded(Data(State()), Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleGaugesState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Gauges.Count);
    }

    [Fact]
    public async Task A_vehicle_without_live_state_is_empty()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugesData>.Loaded(Data(null), Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleGaugesState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task An_empty_emission_is_empty()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugesData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleGaugesState.Empty, vm.State);
    }

    [Fact]
    public async Task A_hard_failure_shows_the_error_state()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugesData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(VehicleGaugesState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task A_stale_cache_shows_the_stale_state()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugesData>.Cached(Data(State()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(VehicleGaugesState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task An_offline_cache_shows_the_offline_state()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleGaugesData>.OfflineCached(Data(State()), Now, new RepositoryError(RepositoryErrorKind.Offline, "offline")));
        await vm.LoadAsync();

        Assert.Equal(VehicleGaugesState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task Changing_units_reprojects_the_loaded_snapshot()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleGaugesData>.Loaded(Data(State(ratedRange: 410000)), Now));
        await vm.LoadAsync();
        Assert.Equal("km", Gauge(vm.Display, "range").Unit);

        vm.Units = UnitPref.Imperial;
        Assert.Equal("mi", Gauge(vm.Display, "range").Unit);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleGaugesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal("view.opened slug=VehicleGauges", Assert.Single(lines));
        Assert.Equal(1, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_exposes_the_canonical_slug()
    {
        Assert.Equal("VehicleGauges", VehicleGaugesRegistration.Slug);
        Assert.False(string.IsNullOrWhiteSpace(VehicleGaugesRegistration.Name(Localizer)));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static VehicleGaugesVehicle Vehicle() => new(7, "My Tesla", "VIN9", "Model 3", "PearlWhite");

    private static VehicleGaugesData Data(VehicleGaugesTelemetry? state) => new(Vehicle(), state);

    private static VehicleGaugesTelemetry State(
        string status = "online",
        double? battery = 73,
        double? ratedRange = 410000,
        double? speed = 0,
        double? chargerPower = 0,
        double? chargeRate = 0,
        bool charging = false,
        bool climate = false,
        bool locked = true,
        bool sentry = false,
        string? software = "2026.8.9") =>
        new(status, battery, ratedRange, speed, chargerPower, chargeRate, charging, climate, locked, sentry, software);

    private static VehicleGaugesDisplay Project(VehicleGaugesData data, UnitPref? units = null) =>
        VehicleGaugesProjection.Project(data, units ?? UnitPref.Metric, Localizer);

    private static VehicleGaugesGauge Gauge(VehicleGaugesDisplay view, string key) =>
        view.Gauges.Single(g => g.Key == key);

    private static VehicleGaugesMetric Metric(VehicleGaugesDisplay view, string key) =>
        view.Metrics.Single(m => m.Key == key);

    private static VehicleGaugesChip Chip(VehicleGaugesDisplay view, string key) =>
        view.Chips.Single(c => c.Key == key);

    private static VehicleGaugesViewModel NewViewModel(params RepositoryResult<VehicleGaugesData>[] emissions) =>
        new(new FakeVehicleGaugesSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeVehicleGaugesSource(params RepositoryResult<VehicleGaugesData>[] emissions) : IVehicleGaugesSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleGaugesData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }
}
