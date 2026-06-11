using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the BatteryRangePanel surface's UI-thread-free logic — the state parse adapter, the
/// state-of-charge band thresholds, the projection (battery gauge plus the rated-range / ideal-range / charging
/// cards, the i18n keys and the accessibility labels), the registration metadata, the diagnostics, and the
/// state-holder view-model's per-state transitions (loading / loaded / empty / asleep / error / stale /
/// offline). Mirrors the web spec
/// (web/src/features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx).
/// </summary>
public sealed class BatteryRangePanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    // ---- Parse: telemetry ----------------------------------------------------------

    [Fact]
    public void FromResponse_reads_the_canonical_state_object()
    {
        var t = BatteryRangeTelemetry.FromResponse(Json("""
        { "state": { "vehicle_id": 7, "battery_level": 72, "rated_range": 410000, "ideal_range": 430000,
          "is_charging": false, "charge_rate": 0, "time_to_full_charge": 0 } }
        """));

        Assert.NotNull(t);
        Assert.Equal(72, t!.BatteryLevel);
        Assert.Equal(410000, t.RatedRangeMeters);
        Assert.Equal(430000, t.IdealRangeMeters);
        Assert.False(t.IsCharging);
        Assert.Equal(0, t.ChargeRateMeters);
        Assert.Equal(0, t.TimeToFullChargeHours);
    }

    [Fact]
    public void FromResponse_reads_a_plain_state_object()
    {
        var t = BatteryRangeTelemetry.FromResponse(Json("""
        { "state": { "battery_level": 55, "is_charging": true, "charge_rate": 50000, "time_to_full_charge": 1.5 } }
        """));

        Assert.NotNull(t);
        Assert.Equal(55, t!.BatteryLevel);
        Assert.True(t.IsCharging);
        Assert.Equal(50000, t.ChargeRateMeters);
        Assert.Equal(1.5, t.TimeToFullChargeHours);
    }

    [Fact]
    public void FromResponse_rebuilds_from_the_position_fallback()
    {
        var t = BatteryRangeTelemetry.FromResponse(Json("""
        { "vehicle": { "state": "charging" }, "position": { "battery_level": 40, "rated_range": 300000, "ideal_range": 320000 },
          "is_charging": true, "charge_rate": 30000, "time_to_full_charge": 3 }
        """));

        Assert.NotNull(t);
        Assert.Equal(40, t!.BatteryLevel);
        Assert.Equal(300000, t.RatedRangeMeters);
        Assert.Equal(320000, t.IdealRangeMeters);
        Assert.True(t.IsCharging);
        Assert.Equal(30000, t.ChargeRateMeters);
        Assert.Equal(3, t.TimeToFullChargeHours);
    }

    [Fact]
    public void FromResponse_returns_null_when_asleep_or_stateless()
    {
        Assert.Null(BatteryRangeTelemetry.FromResponse(Json("{}")));
        Assert.Null(BatteryRangeTelemetry.FromResponse(Json("""{ "state": null }""")));
        Assert.Null(BatteryRangeTelemetry.FromResponse(Json("null")));
    }

    [Fact]
    public void FromResponse_tolerates_missing_fields()
    {
        var t = BatteryRangeTelemetry.FromResponse(Json("""{ "state": { "vehicle_id": 1 } }"""));

        Assert.NotNull(t);
        Assert.Null(t!.BatteryLevel);
        Assert.Null(t.RatedRangeMeters);
        Assert.Null(t.IdealRangeMeters);
        Assert.False(t.IsCharging);
        Assert.Null(t.ChargeRateMeters);
        Assert.Null(t.TimeToFullChargeHours);
    }

    [Fact]
    public void Data_has_data_only_when_a_vehicle_and_state_are_present()
    {
        Assert.False(BatteryRangeData.Empty.HasData);
        Assert.False(new BatteryRangeData(HasVehicle: true, State: null).HasData);
        Assert.True(new BatteryRangeData(HasVehicle: true, State: Idle()).HasData);
    }

    // ---- State-of-charge band (web batteryColor thresholds) ------------------------

    [Theory]
    [InlineData(100, StatusKind.Success)]
    [InlineData(61, StatusKind.Success)]
    [InlineData(60, StatusKind.Warning)] // web: level > 60 is green, so 60 is amber
    [InlineData(40, StatusKind.Warning)]
    [InlineData(26, StatusKind.Warning)]
    [InlineData(25, StatusKind.Danger)]  // web: level > 25 is amber, so 25 is red
    [InlineData(10, StatusKind.Danger)]
    [InlineData(0, StatusKind.Danger)]
    public void BatteryBand_maps_each_state_of_charge_to_its_health_band(double level, StatusKind expected) =>
        Assert.Equal(expected, BatteryRangePanelProjection.BatteryBand(level));

    [Theory]
    [InlineData(StatusKind.Success, BatteryRangeAccent.Green)]
    [InlineData(StatusKind.Warning, BatteryRangeAccent.Amber)]
    [InlineData(StatusKind.Danger, BatteryRangeAccent.Red)]
    public void BandAccent_maps_each_band_to_its_accent(StatusKind band, BatteryRangeAccent expected) =>
        Assert.Equal(expected, BatteryRangePanelProjection.BandAccent(band));

    [Fact]
    public void Project_carries_the_band_and_accent_onto_the_gauge()
    {
        Assert.Equal(StatusKind.Success, Project(Idle(battery: 80)).BatteryBand);
        Assert.Equal(BatteryRangeAccent.Green, Project(Idle(battery: 80)).BatteryAccent);

        Assert.Equal(StatusKind.Warning, Project(Idle(battery: 45)).BatteryBand);
        Assert.Equal(BatteryRangeAccent.Amber, Project(Idle(battery: 45)).BatteryAccent);

        Assert.Equal(StatusKind.Danger, Project(Idle(battery: 12)).BatteryBand);
        Assert.Equal(BatteryRangeAccent.Red, Project(Idle(battery: 12)).BatteryAccent);
    }

    // ---- Projection: gauge ---------------------------------------------------------

    [Fact]
    public void Project_clamps_and_formats_the_battery_gauge()
    {
        var view = Project(Idle(battery: 72));

        Assert.True(view.HasData);
        Assert.Equal(72, view.BatteryLevel);
        Assert.Equal("72", view.BatteryValueText);
        Assert.Equal("%", view.BatteryUnit);
        Assert.Equal("Battery", view.BatteryLabel);
    }

    [Fact]
    public void Project_clamps_an_out_of_range_state_of_charge()
    {
        Assert.Equal(100, Project(Idle(battery: 130)).BatteryLevel);
        Assert.Equal(0, Project(Idle(battery: -5)).BatteryLevel);
    }

    [Fact]
    public void Project_null_state_yields_the_empty_display()
    {
        var view = BatteryRangePanelProjection.Project(null, UnitPref.Metric, Localizer);

        Assert.False(view.HasData);
        Assert.Empty(view.Metrics);
        Assert.Equal("Battery", view.BatteryLabel);
    }

    // ---- Projection: metric cards --------------------------------------------------

    [Fact]
    public void Project_formats_the_range_cards_in_metric_units()
    {
        var view = Project(Idle(ratedRangeMeters: 410000, idealRangeMeters: 430000));

        Assert.Equal("410 km", Metric(view, "rated-range").Value);
        Assert.Equal("Rated Range", Metric(view, "rated-range").Label);
        Assert.Equal(BatteryRangeAccent.Cyan, Metric(view, "rated-range").Accent);

        Assert.Equal("430 km", Metric(view, "ideal-range").Value);
        Assert.Equal("Ideal Range", Metric(view, "ideal-range").Label);
        Assert.Equal(BatteryRangeAccent.Green, Metric(view, "ideal-range").Accent);
    }

    [Fact]
    public void Project_formats_the_range_cards_in_imperial_units()
    {
        var view = BatteryRangePanelProjection.Project(Idle(ratedRangeMeters: 450000), UnitPref.Imperial, Localizer);
        Assert.Equal("280 mi", Metric(view, "rated-range").Value);
    }

    [Fact]
    public void Project_charging_card_shows_the_rate_and_time_to_full()
    {
        var view = Project(Charging(chargeRateMeters: 48000, timeToFullHours: 2.5));
        var card = Metric(view, "charging");

        Assert.Equal("Charging", card.Label);
        Assert.Equal("48.0 km/h", card.Value);
        Assert.Equal(BatteryRangeAccent.Green, card.Accent);
        Assert.Equal("Full in 2.5h", card.Subtitle);
    }

    [Fact]
    public void Project_charging_card_hides_the_subtitle_when_time_to_full_is_zero()
    {
        var card = Metric(Project(Charging(timeToFullHours: 0)), "charging");

        Assert.Equal(BatteryRangeAccent.Green, card.Accent);
        Assert.Null(card.Subtitle);
    }

    [Fact]
    public void Project_idle_card_shows_not_charging()
    {
        var card = Metric(Project(Idle()), "charging");

        Assert.Equal("Not Charging", card.Value);
        Assert.Equal(BatteryRangeAccent.Cyan, card.Accent);
        Assert.Null(card.Subtitle);
    }

    [Fact]
    public void Project_renders_exactly_the_three_web_cards_in_order()
    {
        var view = Project(Charging());
        Assert.Equal(new[] { "rated-range", "ideal-range", "charging" }, view.Metrics.Select(m => m.Key).ToArray());
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var view = BatteryRangePanelProjection.Project(Charging(), UnitPref.Metric, echo);

        Assert.Equal("L:common.battery", view.BatteryLabel);
        Assert.Equal("L:vehicles.detail.ratedRange", Metric(view, "rated-range").Label);
        Assert.Equal("L:vehicles.detail.idealRange", Metric(view, "ideal-range").Label);
        Assert.Equal("L:common.charging", Metric(view, "charging").Label);
        Assert.Equal("L:vehicles.detail.fullIn 2.5h", Metric(view, "charging").Subtitle);
    }

    [Fact]
    public void Idle_charging_card_resolves_the_not_charging_key()
    {
        var view = BatteryRangePanelProjection.Project(Idle(), UnitPref.Metric, new KeyEchoLocalizer());
        Assert.Equal("L:common.notCharging", Metric(view, "charging").Value);
    }

    // ---- a11y: every element carries a spoken name ---------------------------------

    [Fact]
    public void Every_gauge_and_card_carries_a_non_empty_automation_name()
    {
        var view = Project(Charging());

        Assert.False(string.IsNullOrWhiteSpace(view.BatteryAutomationName));
        Assert.All(view.Metrics, m => Assert.False(string.IsNullOrWhiteSpace(m.AutomationName)));
    }

    [Fact]
    public void Automation_names_compose_label_value_and_subtitle()
    {
        var view = Project(Charging(chargeRateMeters: 48000, timeToFullHours: 2.5));

        Assert.Equal("Battery: 72 %", view.BatteryAutomationName);
        Assert.Equal("Rated Range: 410 km", Metric(view, "rated-range").AutomationName);
        Assert.Equal("Charging: 48.0 km/h. Full in 2.5h", Metric(view, "charging").AutomationName);
    }

    [Fact]
    public void Idle_card_automation_name_omits_the_subtitle()
    {
        Assert.Equal("Charging: Not Charging", Metric(Project(Idle()), "charging").AutomationName);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(BatteryRangePanelState.Loading, vm.State);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_the_gauge_and_cards()
    {
        using var vm = NewViewModel(Loaded(Data(Idle())));
        await vm.LoadAsync();

        Assert.Equal(BatteryRangePanelState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
        Assert.Equal(3, vm.Display.Metrics.Count);
    }

    [Fact]
    public async Task ViewModel_no_vehicle_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryRangePanelState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_asleep_vehicle_renders_empty()
    {
        using var vm = NewViewModel(Loaded(new BatteryRangeData(HasVehicle: true, State: null)));
        await vm.LoadAsync();

        Assert.Equal(BatteryRangePanelState.Empty, vm.State);
        Assert.False(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryRangeData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(BatteryRangePanelState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeData>.Cached(Data(Idle()), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(BatteryRangePanelState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_message()
    {
        using var vm = NewViewModel(RepositoryResult<BatteryRangeData>.OfflineCached(
            Data(Idle()), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(BatteryRangePanelState.Offline, vm.State);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<BatteryRangeData>.Loading(),
            RepositoryResult<BatteryRangeData>.Cached(Data(Idle(battery: 40)), Now, stale: false),
            RepositoryResult<BatteryRangeData>.Loaded(Data(Idle(battery: 90)), Now));
        await vm.LoadAsync();

        Assert.Equal(BatteryRangePanelState.Loaded, vm.State);
        Assert.Equal(90, vm.Display.BatteryLevel); // the freshest snapshot wins
    }

    [Fact]
    public async Task ViewModel_unit_change_reprojects_the_range_cards()
    {
        using var vm = NewViewModel(Loaded(Data(Idle(ratedRangeMeters: 450000))));
        await vm.LoadAsync();
        Assert.Equal("450 km", Metric(vm.Display, "rated-range").Value);

        vm.Units = UnitPref.Imperial;

        Assert.Equal("280 mi", Metric(vm.Display, "rated-range").Value);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Data(Idle())));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(BatteryRangePanelViewModel.State), changed);
        Assert.Contains(nameof(BatteryRangePanelViewModel.Display), changed);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract() =>
        Assert.Equal("BatteryRangePanel", BatteryRangePanelRegistration.Slug);

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryRangePanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryRangePanel", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static BatteryRangeData Data(BatteryRangeTelemetry? state) => new(HasVehicle: true, State: state);

    private static BatteryRangeTelemetry Idle(
        double? battery = 72,
        double? ratedRangeMeters = 410000,
        double? idealRangeMeters = 430000) =>
        new(
            BatteryLevel: battery,
            RatedRangeMeters: ratedRangeMeters,
            IdealRangeMeters: idealRangeMeters,
            IsCharging: false,
            ChargeRateMeters: 0,
            TimeToFullChargeHours: 0);

    private static BatteryRangeTelemetry Charging(double chargeRateMeters = 48000, double timeToFullHours = 2.5) =>
        Idle() with
        {
            IsCharging = true,
            ChargeRateMeters = chargeRateMeters,
            TimeToFullChargeHours = timeToFullHours,
        };

    private static BatteryRangeDisplay Project(BatteryRangeTelemetry state) =>
        BatteryRangePanelProjection.Project(state, UnitPref.Metric, Localizer);

    private static BatteryRangeMetric Metric(BatteryRangeDisplay view, string key) =>
        view.Metrics.Single(m => m.Key == key);

    private static RepositoryResult<BatteryRangeData> Loaded(BatteryRangeData data) =>
        RepositoryResult<BatteryRangeData>.Loaded(data, Now);

    private static BatteryRangePanelViewModel NewViewModel(params RepositoryResult<BatteryRangeData>[] emissions) =>
        new(new FakeBatteryRangePanelSource(emissions), Localizer, UnitPref.Metric);

    private sealed class FakeBatteryRangePanelSource(params RepositoryResult<BatteryRangeData>[] emissions) : IBatteryRangePanelSource
    {
        public async IAsyncEnumerable<RepositoryResult<BatteryRangeData>> StreamAsync(
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
