using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the VehicleHero surface's UI-thread-free logic — the vehicle/state parse adapters,
/// the context-aware projection (header, radial gauges, charging panel, the driving/charging/idle stat grid
/// plus the always-visible tiles, the quick actions, the i18n keys and the accessibility labels), the
/// registration metadata, the diagnostics, and the state-holder view-model's per-state transitions
/// (loading / loaded / asleep / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/dashboard/components/VehicleHero.tsx).
/// </summary>
public sealed class VehicleHeroTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Parse: vehicle identity ---------------------------------------------------

    [Fact]
    public void FromVehiclesArray_prefers_the_matching_id()
    {
        var v = VehicleHeroVehicle.FromVehiclesArray(
            Json("""[ { "id": 1, "vin": "AAA" }, { "id": 7, "display_name": "My Tesla", "vin": "BBB", "model": "Model 3", "trim_badging": "Long Range" } ]"""),
            preferredId: 7);

        Assert.NotNull(v);
        Assert.Equal(7, v!.Id);
        Assert.Equal("My Tesla", v.DisplayName);
        Assert.Equal("BBB", v.Vin);
        Assert.Equal("Model 3", v.Model);
        Assert.Equal("Long Range", v.TrimBadging);
    }

    [Fact]
    public void FromVehiclesArray_falls_back_to_the_first_entry()
    {
        var byNull = VehicleHeroVehicle.FromVehiclesArray(Json("""[ { "id": 3, "vin": "ZZZ" }, { "id": 4 } ]"""), preferredId: null);
        Assert.Equal(3, byNull!.Id);

        var noMatch = VehicleHeroVehicle.FromVehiclesArray(Json("""[ { "id": 3, "vin": "ZZZ" }, { "id": 4 } ]"""), preferredId: 99);
        Assert.Equal(3, noMatch!.Id);
    }

    [Fact]
    public void FromVehiclesArray_returns_null_for_empty_or_non_array()
    {
        Assert.Null(VehicleHeroVehicle.FromVehiclesArray(Json("[]"), null));
        Assert.Null(VehicleHeroVehicle.FromVehiclesArray(Json("{}"), null));
        Assert.Null(VehicleHeroVehicle.FromVehiclesArray(Json("null"), null));
    }

    [Fact]
    public void Vehicle_name_prefers_display_name_then_vin()
    {
        Assert.Equal("My Tesla", new VehicleHeroVehicle(1, "My Tesla", "VIN", "", "").Name);
        Assert.Equal("VIN", new VehicleHeroVehicle(1, "  ", "VIN", "", "").Name);
    }

    [Fact]
    public void Vehicle_subtitle_joins_model_trim_and_vin()
    {
        Assert.Equal("Model 3 Long Range \u00B7 VIN9", new VehicleHeroVehicle(1, "n", "VIN9", "Model 3", "Long Range").Subtitle);
        Assert.Equal("VIN9", new VehicleHeroVehicle(1, "n", "VIN9", "", "").Subtitle);
        Assert.Equal("Model Y", new VehicleHeroVehicle(1, "n", "", "Model Y", "").Subtitle);
    }

    // ---- Parse: telemetry ----------------------------------------------------------

    [Fact]
    public void FromResponse_reads_the_canonical_state_object()
    {
        var t = VehicleHeroTelemetry.FromResponse(Json("""
        { "state": { "vehicle_id": 7, "state": "driving", "battery_level": 72, "rated_range": 410000, "ideal_range": 430000,
          "odometer": 12000000, "speed": 25, "power": 30, "inside_temp": 21.5, "outside_temp": 14, "is_charging": false,
          "charger_power": 0, "charge_rate": 0, "time_to_full_charge": 0, "is_locked": true, "sentry_mode": false,
          "software_version": "2026.8.9" } }
        """));

        Assert.NotNull(t);
        Assert.Equal("driving", t!.Status);
        Assert.Equal(72, t.BatteryLevel);
        Assert.Equal(410000, t.RatedRangeMeters);
        Assert.Equal(430000, t.IdealRangeMeters);
        Assert.Equal(12000000, t.OdometerMeters);
        Assert.Equal(25, t.SpeedMps);
        Assert.Equal(30, t.PowerKw);
        Assert.Equal(21.5, t.InsideTempCelsius);
        Assert.True(t.IsLocked);
        Assert.False(t.SentryMode);
        Assert.Equal("2026.8.9", t.SoftwareVersion);
    }

    [Fact]
    public void FromResponse_reads_a_plain_state_object()
    {
        var t = VehicleHeroTelemetry.FromResponse(Json("""{ "state": { "state": "charging", "battery_level": 55, "is_charging": true, "charger_power": 11 } }"""));

        Assert.NotNull(t);
        Assert.Equal("charging", t!.Status);
        Assert.Equal(55, t.BatteryLevel);
        Assert.True(t.IsCharging);
        Assert.Equal(11, t.ChargerPowerKw);
    }

    [Fact]
    public void FromResponse_returns_null_when_asleep_or_stateless()
    {
        Assert.Null(VehicleHeroTelemetry.FromResponse(Json("{}")));
        Assert.Null(VehicleHeroTelemetry.FromResponse(Json("""{ "state": null }""")));
        Assert.Null(VehicleHeroTelemetry.FromResponse(Json("null")));
    }

    [Fact]
    public void FromResponse_rebuilds_from_the_position_fallback()
    {
        var t = VehicleHeroTelemetry.FromResponse(Json("""
        { "vehicle": { "state": "asleep" }, "position": { "battery_level": 40, "inside_temp": 18 }, "is_charging": true, "charger_power": 7 }
        """));

        Assert.NotNull(t);
        Assert.Equal("asleep", t!.Status);
        Assert.Equal(40, t.BatteryLevel);
        Assert.Equal(18, t.InsideTempCelsius);
        Assert.True(t.IsCharging);
        Assert.Equal(7, t.ChargerPowerKw);
    }

    // ---- Projection: asleep --------------------------------------------------------

    [Fact]
    public void Project_asleep_renders_the_wake_panel_only()
    {
        var view = Project(Data(null));

        Assert.False(view.IsAwake);
        Assert.Empty(view.Gauges);
        Assert.Empty(view.Stats);
        Assert.Empty(view.Actions);
        Assert.False(view.IsCharging);
        Assert.Null(view.Charging);
        Assert.Equal("Vehicle asleep \u2014 wake to see live data", view.AsleepMessage);
        Assert.Equal("Wake Up", view.WakeAction.Label);
        Assert.Equal("/commands", view.WakeAction.Route);
        Assert.Equal("offline", view.Status);
        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
    }

    // ---- Projection: gauges --------------------------------------------------------

    [Fact]
    public void Project_idle_builds_battery_range_and_two_temperature_gauges()
    {
        var view = Project(Data(Idle()));

        Assert.Equal(new[] { "battery", "range", "inside", "outside" }, view.Gauges.Select(g => g.Key));
        Assert.True(view.IsAwake);
    }

    [Fact]
    public void Project_driving_adds_the_speed_gauge()
    {
        var view = Project(Data(Driving()));
        Assert.Equal(new[] { "battery", "range", "speed", "inside", "outside" }, view.Gauges.Select(g => g.Key));
    }

    [Fact]
    public void Project_charging_adds_the_power_gauge()
    {
        var view = Project(Data(Charging()));
        Assert.Equal(new[] { "battery", "range", "power", "inside", "outside" }, view.Gauges.Select(g => g.Key));
    }

    [Fact]
    public void Project_battery_gauge_accent_follows_the_fifty_percent_threshold()
    {
        Assert.Equal(VehicleHeroAccent.Green, Gauge(Project(Data(Idle(battery: 80))), "battery").Accent);
        Assert.Equal(VehicleHeroAccent.Amber, Gauge(Project(Data(Idle(battery: 40))), "battery").Accent);
    }

    [Fact]
    public void Project_range_gauge_converts_to_the_display_unit()
    {
        var metric = Gauge(Project(Data(Idle(ratedRangeMeters: 450000))), "range");
        Assert.Equal(450, metric.Value);
        Assert.Equal("km", metric.Unit);
        Assert.Equal(VehicleHeroAccent.Cyan, metric.Accent);

        var imperial = Gauge(Project(Data(Idle(ratedRangeMeters: 450000)), UnitPref.Imperial), "range");
        Assert.Equal(280, imperial.Value); // 450000 m / 1609.344 ≈ 279.6 → 280
        Assert.Equal("mi", imperial.Unit);
    }

    [Fact]
    public void Project_temperature_gauge_max_depends_on_the_unit()
    {
        Assert.Equal(50, Gauge(Project(Data(Idle())), "inside").Max);
        Assert.Equal(122, Gauge(Project(Data(Idle()), UnitPref.Imperial), "inside").Max);
    }

    [Fact]
    public void Project_speed_gauge_converts_metres_per_second_to_the_display_unit()
    {
        var gauge = Gauge(Project(Data(Driving(speedMps: 25))), "speed");
        Assert.Equal(90, gauge.Value); // 25 m/s * 3600 / 1000 = 90 km/h
        Assert.Equal("km/h", gauge.Unit);
        Assert.Equal(VehicleHeroAccent.Purple, gauge.Accent);
    }

    // ---- Projection: charging panel ------------------------------------------------

    [Fact]
    public void Project_charging_panel_formats_power_rate_time_and_done()
    {
        var view = Project(Data(Charging(chargerPowerKw: 11, chargeRateMeters: 48000, timeToFullHours: 2.5)));

        Assert.True(view.IsCharging);
        var charging = view.Charging;
        Assert.NotNull(charging);
        Assert.Equal("Charging", charging!.Header);
        Assert.Equal("11.0 kW", charging.PowerText);
        Assert.Equal("48 km/h", charging.RateText);
        Assert.Equal("2.5h", charging.TimeToFullText);
        Assert.NotNull(charging.DoneAtText);
        Assert.StartsWith("Done ~", charging.DoneAtText);
    }

    [Fact]
    public void Project_charging_time_to_full_shows_a_dash_when_zero()
    {
        var charging = Project(Data(Charging(timeToFullHours: 0))).Charging;
        Assert.NotNull(charging);
        Assert.Equal("\u2014", charging!.TimeToFullText);
        Assert.Null(charging.DoneAtText);
    }

    // ---- Projection: stat grid -----------------------------------------------------

    [Fact]
    public void Project_driving_stat_grid_matches_the_web_order()
    {
        var stats = Project(Data(Driving())).Stats;
        Assert.Equal(
            new[] { "speed", "power", "odometer", "ideal-range", "status", "sentry", "firmware", "power-summary" },
            stats.Select(s => s.Key));
    }

    [Fact]
    public void Project_charging_stat_grid_matches_the_web_order()
    {
        var stats = Project(Data(Charging())).Stats;
        Assert.Equal(
            new[] { "charge-rate", "time-to-full", "ideal-range", "odometer", "status", "sentry", "firmware", "power-summary" },
            stats.Select(s => s.Key));
    }

    [Fact]
    public void Project_idle_stat_grid_matches_the_web_order()
    {
        var stats = Project(Data(Idle())).Stats;
        Assert.Equal(
            new[] { "inside", "outside", "odometer", "ideal-range", "status", "sentry", "firmware", "power-summary" },
            stats.Select(s => s.Key));
    }

    [Fact]
    public void Project_power_tile_accent_follows_the_sign()
    {
        Assert.Equal(VehicleHeroAccent.Amber, Stat(Project(Data(Driving(powerKw: 30))), "power").Accent);
        Assert.Equal(VehicleHeroAccent.Green, Stat(Project(Data(Driving(powerKw: -12))), "power").Accent);
        Assert.Equal(VehicleHeroAccent.Neutral, Stat(Project(Data(Driving(powerKw: 0))), "power-summary").Accent);
    }

    [Fact]
    public void Project_status_and_sentry_tiles_reflect_the_flags()
    {
        var locked = Project(Data(Idle(locked: true, sentry: true)));
        Assert.Equal("Locked", Stat(locked, "status").Value);
        Assert.Equal(VehicleHeroAccent.Green, Stat(locked, "status").Accent);
        Assert.Equal("Active", Stat(locked, "sentry").Value);
        Assert.Equal(VehicleHeroAccent.Red, Stat(locked, "sentry").Accent);

        var unlocked = Project(Data(Idle(locked: false, sentry: false)));
        Assert.Equal("Unlocked", Stat(unlocked, "status").Value);
        Assert.Equal(VehicleHeroAccent.Amber, Stat(unlocked, "status").Accent);
        Assert.Equal("Off", Stat(unlocked, "sentry").Value);
        Assert.Equal(VehicleHeroAccent.Neutral, Stat(unlocked, "sentry").Accent);
    }

    [Fact]
    public void Project_firmware_tile_shows_the_version_or_a_dash()
    {
        Assert.Equal("2026.8.9", Stat(Project(Data(Idle(firmware: "2026.8.9"))), "firmware").Value);
        Assert.Equal("\u2014", Stat(Project(Data(Idle(firmware: null))), "firmware").Value);
    }

    [Fact]
    public void Project_idle_temperature_tiles_show_a_dash_when_unreported()
    {
        var view = Project(Data(Idle(insideTemp: null, outsideTemp: null)));
        Assert.Equal("\u2014", Stat(view, "inside").Value);
        Assert.Equal("\u2014", Stat(view, "outside").Value);
    }

    // ---- Projection: quick actions -------------------------------------------------

    [Fact]
    public void Project_builds_the_four_quick_actions_with_routes()
    {
        var actions = Project(Data(Idle())).Actions;

        Assert.Equal(new[] { "details", "commands", "live-map", "digital-twin" }, actions.Select(a => a.Key));
        Assert.Equal("/vehicles/7", actions[0].Route);
        Assert.Equal("/commands", actions[1].Route);
        Assert.Equal("/live", actions[2].Route);
        Assert.Equal("/digital-twin", actions[3].Route);
    }

    // ---- Status accent -------------------------------------------------------------

    [Theory]
    [InlineData("online", "TsColorSuccessBrush")]
    [InlineData("driving", "TsColorInfoBrush")]
    [InlineData("charging", "TsColorWarningBrush")]
    [InlineData("offline", "TsColorDangerBrush")]
    [InlineData("asleep", "TsChart07Brush")]
    [InlineData("weird", "TsColorTextSecondaryBrush")]
    public void StatusAccentKey_maps_each_state_to_a_token(string status, string expected) =>
        Assert.Equal(expected, VehicleHeroProjection.StatusAccentKey(status));

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = VehicleHeroProjection.Project(Data(Charging()), UnitPref.Metric, Now, echo);

        Assert.Equal("L:hero.battery", Gauge(view, "battery").Label);
        Assert.Equal("L:hero.range", Gauge(view, "range").Label);
        Assert.Equal("L:hero.power", Gauge(view, "power").Label);
        Assert.Equal("L:hero.inside", Gauge(view, "inside").Label);
        Assert.Equal("L:hero.charging", view.Charging!.Header);
        Assert.Equal("L:hero.chargeRate", view.Charging.RateLabel);
        Assert.Equal("L:common.status", Stat(view, "status").Label);
        Assert.Equal("L:common.sentry", Stat(view, "sentry").Label);
        Assert.Equal("L:hero.firmware", Stat(view, "firmware").Label);
        Assert.Equal("L:hero.details", view.Actions[0].Label);
        Assert.Equal("L:hero.digitalTwin", view.Actions[3].Label);
    }

    [Fact]
    public void Asleep_message_and_wake_resolve_through_catalog_keys()
    {
        var view = VehicleHeroProjection.Project(Data(null), UnitPref.Metric, Now, new KeyEchoLocalizer());
        Assert.Equal("L:hero.asleep", view.AsleepMessage);
        Assert.Equal("L:hero.wakeUp", view.WakeAction.Label);
    }

    // ---- a11y: every element carries a spoken name ---------------------------------

    [Fact]
    public void Every_gauge_stat_and_action_carries_a_non_empty_automation_name()
    {
        var view = Project(Data(Charging()));

        Assert.All(view.Gauges, g => Assert.False(string.IsNullOrWhiteSpace(g.AutomationName)));
        Assert.All(view.Stats, s => Assert.False(string.IsNullOrWhiteSpace(s.AutomationName)));
        Assert.All(view.Actions, a => Assert.False(string.IsNullOrWhiteSpace(a.AutomationName)));
        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(view.Charging!.AutomationName));

        Assert.Equal("Battery: 60 %", Gauge(view, "battery").AutomationName);
        Assert.Equal("Status: Locked", Stat(view, "status").AutomationName);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_awake_exposes_the_hero()
    {
        using var vm = NewViewModel(Loaded(Data(Driving())));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroState.Loaded, vm.State);
        Assert.True(vm.IsAwake);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
        Assert.NotEmpty(vm.Display.Gauges);
    }

    [Fact]
    public async Task ViewModel_loaded_asleep_renders_the_wake_panel()
    {
        using var vm = NewViewModel(Loaded(Data(null)));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroState.Loaded, vm.State);
        Assert.False(vm.IsAwake);
        Assert.Empty(vm.Display.Gauges);
    }

    [Fact]
    public async Task ViewModel_no_vehicle_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroState.Empty, vm.State);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleHeroData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroData>.Cached(Data(Idle()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsAwake);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroData>.OfflineCached(
            Data(Idle()), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleHeroData>.Loading(),
            RepositoryResult<VehicleHeroData>.Cached(Data(Idle()), Now, stale: false),
            RepositoryResult<VehicleHeroData>.Loaded(Data(Driving()), Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleHeroState.Loaded, vm.State);
        Assert.Contains(vm.Display.Gauges, g => g.Key == "speed"); // the freshest (driving) snapshot wins
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_the_range_gauge()
    {
        using var vm = NewViewModel(Loaded(Data(Idle(ratedRangeMeters: 450000))));
        await vm.LoadAsync();
        Assert.Equal(450, Gauge(vm.Display, "range").Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal(280, Gauge(vm.Display, "range").Value);
        Assert.Equal("mi", Gauge(vm.Display, "range").Unit);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Data(Idle())));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(VehicleHeroViewModel.State), changed);
        Assert.Contains(nameof(VehicleHeroViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleHeroData>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Vehicle overview", vm.Title);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("vehicle-hero", VehicleHeroRegistration.Id);
        Assert.Equal("dashboard", VehicleHeroRegistration.Category);
        Assert.Equal("VehicleHero", VehicleHeroRegistration.Slug);
        Assert.Equal("Vehicle overview", VehicleHeroRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleHeroDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleHero", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static VehicleHeroVehicle Vehicle() => new(7, "My Tesla", "VIN9", "Model 3", "Long Range");

    private static VehicleHeroData Data(VehicleHeroTelemetry? state) => new(Vehicle(), state);

    private static VehicleHeroTelemetry Idle(
        double? battery = 80,
        double? ratedRangeMeters = 450000,
        double? insideTemp = 21,
        double? outsideTemp = 15,
        bool locked = true,
        bool sentry = false,
        string? firmware = "2026.8.9") =>
        new(
            Status: "online",
            BatteryLevel: battery,
            RatedRangeMeters: ratedRangeMeters,
            IdealRangeMeters: 430000,
            OdometerMeters: 12000000,
            SpeedMps: 0,
            PowerKw: 0,
            InsideTempCelsius: insideTemp,
            OutsideTempCelsius: outsideTemp,
            IsCharging: false,
            ChargerPowerKw: 0,
            ChargeRateMeters: 0,
            TimeToFullChargeHours: 0,
            IsLocked: locked,
            SentryMode: sentry,
            SoftwareVersion: firmware);

    private static VehicleHeroTelemetry Driving(double speedMps = 25, double powerKw = 30) =>
        Idle() with { Status = "driving", SpeedMps = speedMps, PowerKw = powerKw };

    private static VehicleHeroTelemetry Charging(
        double chargerPowerKw = 11,
        double chargeRateMeters = 48000,
        double timeToFullHours = 2.5) =>
        Idle(battery: 60) with
        {
            Status = "charging",
            IsCharging = true,
            ChargerPowerKw = chargerPowerKw,
            ChargeRateMeters = chargeRateMeters,
            TimeToFullChargeHours = timeToFullHours,
        };

    private static VehicleHeroDisplay Project(VehicleHeroData data, UnitPref? units = null) =>
        VehicleHeroProjection.Project(data, units ?? UnitPref.Metric, Now, Localizer);

    private static VehicleHeroGauge Gauge(VehicleHeroDisplay view, string key) =>
        view.Gauges.Single(g => g.Key == key);

    private static VehicleHeroStat Stat(VehicleHeroDisplay view, string key) =>
        view.Stats.Single(s => s.Key == key);

    private static RepositoryResult<VehicleHeroData> Loaded(VehicleHeroData data) =>
        RepositoryResult<VehicleHeroData>.Loaded(data, Now);

    private static VehicleHeroViewModel NewViewModel(params RepositoryResult<VehicleHeroData>[] emissions) =>
        new(new FakeVehicleHeroSource(emissions), Localizer, UnitPref.Metric, static () => Now);

    private sealed class FakeVehicleHeroSource(params RepositoryResult<VehicleHeroData>[] emissions) : IVehicleHeroSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleHeroData>> StreamAsync(
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

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
