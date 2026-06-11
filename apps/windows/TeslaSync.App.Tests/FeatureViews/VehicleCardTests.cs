using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the VehicleCard surface's UI-thread-free logic — the vehicle/state parse adapters,
/// the derived status, the battery accent, the projection (the car viz, the battery group, the
/// interior / odometer / charge-power stat columns, the lock / Sentry flags, the actions, the i18n keys and the
/// accessibility labels), the registration metadata, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded-awake / loaded-asleep / empty / error / stale / offline). Mirrors
/// the web spec (web/src/features/vehicles/components/VehicleCard.tsx).
/// </summary>
public sealed class VehicleCardTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Parse: vehicle identity ---------------------------------------------------

    [Fact]
    public void FromVehiclesArray_prefers_the_matching_id()
    {
        var v = VehicleCardVehicle.FromVehiclesArray(
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
        var byNull = VehicleCardVehicle.FromVehiclesArray(Json("""[ { "id": 3, "vin": "ZZZ" }, { "id": 4 } ]"""), preferredId: null);
        Assert.Equal(3, byNull!.Id);

        var noMatch = VehicleCardVehicle.FromVehiclesArray(Json("""[ { "id": 3, "vin": "ZZZ" }, { "id": 4 } ]"""), preferredId: 99);
        Assert.Equal(3, noMatch!.Id);
    }

    [Fact]
    public void FromVehiclesArray_returns_null_for_empty_or_non_array()
    {
        Assert.Null(VehicleCardVehicle.FromVehiclesArray(Json("[]"), null));
        Assert.Null(VehicleCardVehicle.FromVehiclesArray(Json("{}"), null));
        Assert.Null(VehicleCardVehicle.FromVehiclesArray(Json("null"), null));
    }

    [Fact]
    public void Vehicle_name_prefers_display_name_then_vin()
    {
        Assert.Equal("My Tesla", new VehicleCardVehicle(1, "My Tesla", "VIN", "", "").Name);
        Assert.Equal("VIN", new VehicleCardVehicle(1, "  ", "VIN", "", "").Name);
    }

    [Fact]
    public void Vehicle_subtitle_and_model_trim_join_the_parts()
    {
        var full = new VehicleCardVehicle(1, "n", "VIN9", "Model 3", "Long Range");
        Assert.Equal("Model 3 Long Range", full.ModelTrim);
        Assert.Equal("Model 3 Long Range \u00B7 VIN9", full.Subtitle);

        Assert.Equal("VIN9", new VehicleCardVehicle(1, "n", "VIN9", "", "").Subtitle);
        Assert.Equal("Model Y", new VehicleCardVehicle(1, "n", "", "Model Y", "").Subtitle);
    }

    // ---- Parse: telemetry ----------------------------------------------------------

    [Fact]
    public void FromResponse_reads_the_canonical_state_object()
    {
        var t = VehicleCardTelemetry.FromResponse(Json("""
        { "state": { "vehicle_id": 7, "state": "driving", "battery_level": 72, "rated_range": 410000,
          "odometer": 12000000, "speed": 25, "inside_temp": 21.5, "is_charging": false, "charger_power": 0,
          "is_locked": true, "sentry_mode": false } }
        """));

        Assert.NotNull(t);
        Assert.Equal("driving", t!.Status);
        Assert.Equal(72, t.BatteryLevel);
        Assert.Equal(410000, t.RatedRangeMeters);
        Assert.Equal(12000000, t.OdometerMeters);
        Assert.Equal(25, t.SpeedMps);
        Assert.Equal(21.5, t.InsideTempCelsius);
        Assert.True(t.IsLocked);
        Assert.False(t.SentryMode);
    }

    [Fact]
    public void FromResponse_reads_a_plain_state_object()
    {
        var t = VehicleCardTelemetry.FromResponse(Json("""{ "state": { "state": "charging", "battery_level": 55, "is_charging": true, "charger_power": 11 } }"""));

        Assert.NotNull(t);
        Assert.Equal("charging", t!.Status);
        Assert.Equal(55, t.BatteryLevel);
        Assert.True(t.IsCharging);
        Assert.Equal(11, t.ChargerPowerKw);
    }

    [Fact]
    public void FromResponse_rebuilds_from_the_position_fallback()
    {
        var t = VehicleCardTelemetry.FromResponse(Json("""
        { "vehicle": { "state": "asleep" }, "position": { "battery_level": 40, "inside_temp": 18 }, "is_charging": true, "charger_power": 7 }
        """));

        Assert.NotNull(t);
        Assert.Equal("asleep", t!.Status);
        Assert.Equal(40, t.BatteryLevel);
        Assert.Equal(18, t.InsideTempCelsius);
        Assert.True(t.IsCharging);
        Assert.Equal(7, t.ChargerPowerKw);
    }

    [Fact]
    public void FromResponse_returns_null_when_asleep_or_stateless()
    {
        Assert.Null(VehicleCardTelemetry.FromResponse(Json("{}")));
        Assert.Null(VehicleCardTelemetry.FromResponse(Json("""{ "state": null }""")));
        Assert.Null(VehicleCardTelemetry.FromResponse(Json("null")));
    }

    // ---- Derived status (web deriveVehicleStatus) ----------------------------------

    [Fact]
    public void DeriveStatus_is_offline_when_no_state()
    {
        Assert.Equal("offline", VehicleCardProjection.DeriveStatus(null));
    }

    [Fact]
    public void DeriveStatus_prefers_charging_then_driving()
    {
        Assert.Equal("charging", VehicleCardProjection.DeriveStatus(Awake(status: "online", charging: true)));
        Assert.Equal("driving", VehicleCardProjection.DeriveStatus(Awake(status: "online", speedMps: 12)));
    }

    [Fact]
    public void DeriveStatus_passes_through_known_states_else_online()
    {
        Assert.Equal("parked", VehicleCardProjection.DeriveStatus(Awake(status: "parked")));
        Assert.Equal("asleep", VehicleCardProjection.DeriveStatus(Awake(status: "asleep")));
        Assert.Equal("online", VehicleCardProjection.DeriveStatus(Awake(status: "wat")));
    }

    // ---- Battery accent (web batteryColor) -----------------------------------------

    [Theory]
    [InlineData(80, VehicleCardAccent.Green)]
    [InlineData(61, VehicleCardAccent.Green)]
    [InlineData(60, VehicleCardAccent.Amber)]
    [InlineData(40, VehicleCardAccent.Amber)]
    [InlineData(26, VehicleCardAccent.Amber)]
    [InlineData(25, VehicleCardAccent.Red)]
    [InlineData(10, VehicleCardAccent.Red)]
    public void BatteryAccent_follows_the_60_and_25_thresholds(double level, VehicleCardAccent expected) =>
        Assert.Equal(expected, VehicleCardProjection.BatteryAccent(level));

    // ---- Status accent token -------------------------------------------------------

    [Theory]
    [InlineData("online", "TsColorSuccessBrush")]
    [InlineData("driving", "TsColorInfoBrush")]
    [InlineData("charging", "TsColorWarningBrush")]
    [InlineData("parked", "TsColorInfoBrush")]
    [InlineData("updating", "TsColorInfoBrush")]
    [InlineData("asleep", "TsChart07Brush")]
    [InlineData("offline", "TsColorDangerBrush")]
    [InlineData("weird", "TsColorTextSecondaryBrush")]
    public void StatusAccentKey_maps_each_state_to_a_token(string status, string expected) =>
        Assert.Equal(expected, VehicleCardProjection.StatusAccentKey(status));

    // ---- Model parse (web parseModelKey) -------------------------------------------

    [Theory]
    [InlineData("Model 3 Performance", TeslaModelKind.Model3)]
    [InlineData("Model S Plaid", TeslaModelKind.ModelS)]
    [InlineData("Model Y Long Range", TeslaModelKind.ModelY)]
    [InlineData("Model X", TeslaModelKind.ModelX)]
    [InlineData("Cybertruck", TeslaModelKind.Cybertruck)]
    [InlineData("", TeslaModelKind.Model3)]
    public void ParseModelKey_matches_the_web_heuristic(string model, TeslaModelKind expected) =>
        Assert.Equal(expected, VehicleCardModel.Parse(model));

    // ---- Projection: car viz -------------------------------------------------------

    [Fact]
    public void Project_viz_uses_web_defaults_when_asleep()
    {
        var viz = Project(Data(null)).Viz;

        Assert.Equal(TeslaModelKind.Model3, viz.Model);
        Assert.Equal("Model 3", viz.ModelLabel);
        Assert.Equal(VehicleCardProjection.DefaultVizBattery, viz.BatteryLevel);
        Assert.True(viz.IsLocked);     // web isLocked ?? true
        Assert.False(viz.IsCharging);  // web isCharging ?? false
        Assert.False(viz.SentryMode);  // web sentryMode ?? false
        Assert.Equal(0, viz.Speed);    // web hard-codes 0
        Assert.False(string.IsNullOrWhiteSpace(viz.AutomationName));
    }

    [Fact]
    public void Project_viz_reflects_live_state()
    {
        var viz = Project(Data(Charging(battery: 30, sentry: true))).Viz;

        Assert.Equal(30, viz.BatteryLevel);
        Assert.Equal(VehicleCardAccent.Amber, viz.BatteryAccent);
        Assert.True(viz.IsCharging);
        Assert.True(viz.SentryMode);
    }

    // ---- Projection: asleep (no stats row) -----------------------------------------

    [Fact]
    public void Project_asleep_hides_the_stats_row()
    {
        var view = Project(Data(null));

        Assert.False(view.IsAwake);
        Assert.Null(view.Battery);
        Assert.Empty(view.Stats);
        Assert.Empty(view.Flags);
        Assert.Equal("offline", view.Status);
        Assert.Equal("Offline", view.StatusText);
        Assert.Equal("My Tesla", view.Name);
        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
    }

    // ---- Projection: battery group -------------------------------------------------

    [Fact]
    public void Project_battery_group_formats_level_range_and_accent()
    {
        var battery = Project(Data(Awake(battery: 80, rangeMeters: 450000))).Battery;

        Assert.NotNull(battery);
        Assert.Equal(80, battery!.Level);
        Assert.Equal("80%", battery.LevelText);
        Assert.Equal("450.0 km", battery.RangeText);
        Assert.Equal(VehicleCardAccent.Green, battery.Accent);
    }

    [Fact]
    public void Project_battery_range_converts_to_the_display_unit()
    {
        var imperial = Project(Data(Awake(rangeMeters: 450000)), UnitPref.Imperial).Battery;
        Assert.Equal("279.6 mi", imperial!.RangeText); // 450000 / 1609.344 ≈ 279.6
    }

    [Fact]
    public void Project_battery_shows_a_dash_when_unreported()
    {
        var battery = Project(Data(Awake(battery: null, rangeMeters: null))).Battery;
        Assert.NotNull(battery);
        Assert.Equal("\u2014", battery!.LevelText);
        Assert.Equal("\u2014", battery.RangeText);
    }

    // ---- Projection: stat columns --------------------------------------------------

    [Fact]
    public void Project_idle_stats_are_interior_then_odometer()
    {
        var stats = Project(Data(Awake())).Stats;
        Assert.Equal(new[] { "interior", "odometer" }, stats.Select(s => s.Key));
    }

    [Fact]
    public void Project_charging_appends_the_charge_power_column()
    {
        var view = Project(Data(Charging(chargerKw: 11)));
        Assert.Equal(new[] { "interior", "odometer", "charging" }, view.Stats.Select(s => s.Key));

        var charging = Stat(view, "charging");
        Assert.Equal("11.0 kW", charging.Value);
        Assert.Equal(VehicleCardAccent.Green, charging.Accent);
    }

    [Fact]
    public void Project_interior_uses_the_temperature_unit()
    {
        Assert.Equal("21.0\u00B0C", Stat(Project(Data(Awake(insideTemp: 21))), "interior").Value);
        Assert.Equal("69.8\u00B0F", Stat(Project(Data(Awake(insideTemp: 21)), UnitPref.Imperial), "interior").Value);
    }

    [Fact]
    public void Project_odometer_converts_and_captions_with_the_distance_unit()
    {
        var metric = Stat(Project(Data(Awake(odometerMeters: 12000000))), "odometer");
        Assert.Equal("12,000", metric.Value);
        Assert.Equal("km", metric.Label);

        var imperial = Stat(Project(Data(Awake(odometerMeters: 12000000)), UnitPref.Imperial), "odometer");
        Assert.Equal("7,456", imperial.Value); // 12000000 / 1609.344 ≈ 7456
        Assert.Equal("mi", imperial.Label);
    }

    [Fact]
    public void Project_stats_show_a_dash_when_unreported()
    {
        var view = Project(Data(Awake(insideTemp: null, odometerMeters: null)));
        Assert.Equal("\u2014", Stat(view, "interior").Value);
        Assert.Equal("\u2014", Stat(view, "odometer").Value);
    }

    // ---- Projection: flags ---------------------------------------------------------

    [Fact]
    public void Project_flags_appear_only_when_active()
    {
        var both = Project(Data(Awake(locked: true, sentry: true)));
        Assert.Equal(new[] { "locked", "sentry" }, both.Flags.Select(f => f.Key));
        Assert.Equal(VehicleCardAccent.Green, Flag(both, "locked").Accent);
        Assert.Equal(VehicleCardAccent.Cyan, Flag(both, "sentry").Accent);

        var none = Project(Data(Awake(locked: false, sentry: false)));
        Assert.Empty(none.Flags);
    }

    // ---- Projection: actions -------------------------------------------------------

    [Fact]
    public void Project_actions_carry_the_detail_route_and_delete_target()
    {
        var actions = Project(Data(Awake())).Actions;

        Assert.Equal(7, actions.VehicleId);
        Assert.Equal("My Tesla", actions.VehicleName);
        Assert.Equal("/vehicles/7", actions.DetailsRoute);
        Assert.False(string.IsNullOrWhiteSpace(actions.ViewDetailsLabel));
        Assert.False(string.IsNullOrWhiteSpace(actions.RemoveLabel));
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = VehicleCardProjection.Project(Data(Awake(charging: true, chargerKw: 11, locked: true, sentry: true)), UnitPref.Metric, echo);

        Assert.Equal("L:card.interior", Stat(view, "interior").Label);
        Assert.Equal("L:card.charging", Stat(view, "charging").Label);
        Assert.Equal("L:card.locked", Flag(view, "locked").Label);
        Assert.Equal("L:card.sentry", Flag(view, "sentry").Label);
        Assert.Equal("L:card.viewDetails", view.Actions.ViewDetailsLabel);
        Assert.Equal("L:card.removeVehicle", view.Actions.RemoveLabel);
    }

    // ---- a11y: every element carries a spoken name ---------------------------------

    [Fact]
    public void Every_element_carries_a_non_empty_automation_name()
    {
        var view = Project(Data(Awake(charging: true, chargerKw: 11, locked: true, sentry: true)));

        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(view.Viz.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(view.Battery!.AutomationName));
        Assert.All(view.Stats, s => Assert.False(string.IsNullOrWhiteSpace(s.AutomationName)));
        Assert.All(view.Flags, f => Assert.False(string.IsNullOrWhiteSpace(f.AutomationName)));

        Assert.Equal("Locked", Flag(view, "locked").AutomationName);
        Assert.Equal("Interior: 21.0\u00B0C", Stat(view, "interior").AutomationName);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("vehicle-card", VehicleCardRegistration.Id);
        Assert.Equal("vehicles", VehicleCardRegistration.Category);
        Assert.Equal("VehicleCard", VehicleCardRegistration.Slug);
        Assert.Equal("Vehicle", VehicleCardRegistration.Name(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new VehicleCardDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VehicleCard", Assert.Single(lines));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleCardData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(VehicleCardState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_awake_exposes_the_stats_row()
    {
        using var vm = NewViewModel(Loaded(Data(Charging(chargerKw: 11))));
        await vm.LoadAsync();

        Assert.Equal(VehicleCardState.Loaded, vm.State);
        Assert.True(vm.IsAwake);
        Assert.NotNull(vm.Display.Battery);
        Assert.Contains(vm.Display.Stats, s => s.Key == "charging");
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_asleep_hides_the_stats_row()
    {
        using var vm = NewViewModel(Loaded(Data(null)));
        await vm.LoadAsync();

        Assert.Equal(VehicleCardState.Loaded, vm.State);
        Assert.False(vm.IsAwake);
        Assert.Null(vm.Display.Battery);
        Assert.Empty(vm.Display.Stats);
    }

    [Fact]
    public async Task ViewModel_no_vehicle_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleCardData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleCardState.Empty, vm.State);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleCardData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(VehicleCardState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleCardData>.Cached(Data(Awake()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(VehicleCardState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.IsAwake);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleCardData>.OfflineCached(
            Data(Awake()), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(VehicleCardState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<VehicleCardData>.Loading(),
            RepositoryResult<VehicleCardData>.Cached(Data(Awake()), Now, stale: false),
            RepositoryResult<VehicleCardData>.Loaded(Data(Charging(chargerKw: 11)), Now));
        await vm.LoadAsync();

        Assert.Equal(VehicleCardState.Loaded, vm.State);
        Assert.Contains(vm.Display.Stats, s => s.Key == "charging"); // the freshest (charging) snapshot wins
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_the_range()
    {
        using var vm = NewViewModel(Loaded(Data(Awake(rangeMeters: 450000))));
        await vm.LoadAsync();
        Assert.Equal("450.0 km", vm.Display.Battery!.RangeText);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("279.6 mi", vm.Display.Battery!.RangeText);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Data(Awake())));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(VehicleCardViewModel.State), changed);
        Assert.Contains(nameof(VehicleCardViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<VehicleCardData>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Vehicle", vm.Title);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static VehicleCardVehicle Vehicle() => new(7, "My Tesla", "VIN9", "Model 3", "Long Range");

    private static VehicleCardData Data(VehicleCardTelemetry? state) => new(Vehicle(), state);

    private static VehicleCardTelemetry Awake(
        string status = "online",
        double? battery = 80,
        double? rangeMeters = 450000,
        double? odometerMeters = 12000000,
        double? insideTemp = 21,
        double? speedMps = 0,
        bool charging = false,
        double? chargerKw = 0,
        bool locked = true,
        bool sentry = false) =>
        new(
            Status: status,
            BatteryLevel: battery,
            RatedRangeMeters: rangeMeters,
            OdometerMeters: odometerMeters,
            InsideTempCelsius: insideTemp,
            SpeedMps: speedMps,
            IsCharging: charging,
            ChargerPowerKw: chargerKw,
            IsLocked: locked,
            SentryMode: sentry);

    private static VehicleCardTelemetry Charging(double? battery = 55, double chargerKw = 11, bool sentry = false) =>
        Awake(status: "online", battery: battery, charging: true, chargerKw: chargerKw, sentry: sentry);

    private static VehicleCardDisplay Project(VehicleCardData data, UnitPref? units = null) =>
        VehicleCardProjection.Project(data, units ?? UnitPref.Metric, Localizer);

    private static VehicleCardStat Stat(VehicleCardDisplay view, string key) =>
        view.Stats.Single(s => s.Key == key);

    private static VehicleCardFlag Flag(VehicleCardDisplay view, string key) =>
        view.Flags.Single(f => f.Key == key);

    private static RepositoryResult<VehicleCardData> Loaded(VehicleCardData data) =>
        RepositoryResult<VehicleCardData>.Loaded(data, Now);

    private static VehicleCardViewModel NewViewModel(params RepositoryResult<VehicleCardData>[] emissions) =>
        new(new FakeVehicleCardSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeVehicleCardSource(params RepositoryResult<VehicleCardData>[] emissions) : IVehicleCardSource
    {
        public async IAsyncEnumerable<RepositoryResult<VehicleCardData>> StreamAsync(
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
