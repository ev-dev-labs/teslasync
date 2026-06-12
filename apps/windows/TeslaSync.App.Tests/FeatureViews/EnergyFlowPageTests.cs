using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Battery;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>EnergyFlowPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/battery/pages/EnergyFlowPage.tsx), the tolerant flow + stats parsers (incl. the platform
/// <c>{data:…}</c> envelope), the view-model's four-state matrix (loading / empty / error / success) with the
/// best-effort real-time overlay, and the generated-client feed's request shaping (web <c>useEnergyFlow</c> +
/// the historical <c>?days=N</c> query). The WinUI view is exercised by the app build; its per-region visibility
/// is driven entirely by the <see cref="EnergyFlowDisplay"/> flags asserted here.
/// </summary>
public sealed class EnergyFlowPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);
    private static readonly UnitPref Metric = UnitPref.Metric with { Energy = EnergyUnit.Kwh };
    private static readonly UnitPref Imperial = UnitPref.Metric with { Distance = DistanceUnit.Mi, Energy = EnergyUnit.Kwh };

    // The 44 i18n keys the manifest requires the page to resolve (web key == English default).
    private static readonly string[] RequiredStringKeys =
    [
        "AC Power", "Accessories", "Avg Energy/Day", "Battery", "CO\u2082 Saved", "Charging", "DC Power",
        "Daily Distance", "Daily Efficiency", "Daily Energy History", "Daily Energy Usage", "Date", "Distance",
        "Driving", "Efficiency", "Efficiency Metrics", "Energy", "Energy Flow", "Energy Flow Diagram", "Excellent",
        "Good", "Grid", "HVAC", "High", "Motor", "N/A", "No Data", "No daily distance data available.",
        "No daily energy data available.", "No efficiency data available.",
        "No energy flow data available for this vehicle and time range.", "No energy history records available.",
        "No energy records found.", "No live data", "Period", "Power distribution and energy analysis",
        "Total Charged", "Total Energy", "days", "kW", "kWh", "kg", "kg CO\u2082", "per day",
    ];

    private static EnergyFlowReading SampleFlow(
        double? dc = 48.0,
        double? ac = 2.0,
        double? remaining = 62.5,
        double? soc = 73.0,
        string? chargeState = "Charging") =>
        new(dc, ac, remaining, null, null, soc, chargeState);

    private static EnergyDailyEntry Day(string date, double energyWh, double distanceM, double effWhPerM) =>
        new(date, energyWh, distanceM, effWhPerM, 0);

    private static EnergyStatsReading SampleStats(IReadOnlyList<EnergyDailyEntry>? daily = null) => new(
        HasData: true,
        VehicleId: 1,
        PeriodDays: 7,
        TotalEnergyUsedWh: 120_000,
        TotalEnergyChargedWh: 140_000,
        TotalWh: 0,
        TotalCost: 0,
        TotalDistanceM: 800_000,
        AvgEfficiencyWhPerM: 0.15,
        Co2SavedKg: 42.3,
        DailyBreakdown: daily ??
        [
            Day("2026-06-10", 10_000, 60_000, 0.16),
            Day("2026-06-11", 12_000, 70_000, 0.17),
            Day("2026-06-12", 8_000, 50_000, 0.15),
        ]);

    private static EnergyFlowModel SuccessModel(
        EnergyStatsReading? stats = null,
        EnergyFlowReading? flow = null) => new(
        VehicleSelected: true,
        Loading: false,
        HasError: false,
        ErrorDetail: null,
        HasStats: true,
        Stats: stats ?? SampleStats(),
        Flow: flow ?? SampleFlow());

    private static EnergyFlowDisplay Project(EnergyFlowModel model, UnitPref? units = null) =>
        EnergyFlowProjection.Project(model, Localizer, units ?? Metric, Now);

    // ── i18n key coverage (all 44 manifest strings, in every data state) ────────────────────────────────

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();
        _ = EnergyFlowProjection.Project(SuccessModel(), recorder, Metric, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();
        _ = EnergyFlowProjection.Project(EnergyFlowModel.Initial, recorder, Metric, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four data states ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(EnergyFlowModel.Initial);

        Assert.Equal(EnergyFlowState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_stats()
    {
        var model = EnergyFlowModel.Initial with { VehicleSelected = false, Loading = false, HasStats = false };
        var display = Project(model);

        Assert.Equal(EnergyFlowState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.Equal("No Data", display.EmptyTitle);
        Assert.Equal("No energy flow data available for this vehicle and time range.", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_stats_query_failed()
    {
        var model = EnergyFlowModel.Initial with { Loading = false, HasError = true, ErrorDetail = "network down", HasStats = false };
        var display = Project(model);

        Assert.Equal(EnergyFlowState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.Equal("Failed to load data: network down", display.ErrorText);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void State_success_renders_all_sections()
    {
        var display = Project(SuccessModel());

        Assert.Equal(EnergyFlowState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    // ── Section 1: energy flow diagram (GlassPanel1..8 + RadialGauge) ────────────────────────────────────

    [Fact]
    public void Flow_diagram_header_and_charge_badge()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Energy Flow Diagram", display.FlowDiagramTitle);
        Assert.True(display.ChargeStateVisible);
        Assert.Equal("Charging", display.ChargeStateText);
        Assert.Equal(StatusKind.Success, display.ChargeStateStatus);
    }

    [Fact]
    public void Flow_charge_badge_is_neutral_for_non_charging_state()
    {
        var display = Project(SuccessModel(flow: SampleFlow(chargeState: "Disconnected")));

        Assert.True(display.ChargeStateVisible);
        Assert.Equal("Disconnected", display.ChargeStateText);
        Assert.Equal(StatusKind.Neutral, display.ChargeStateStatus);
    }

    [Fact]
    public void Flow_charge_badge_hidden_when_no_state()
    {
        var display = Project(SuccessModel(flow: SampleFlow(chargeState: null)));
        Assert.False(display.ChargeStateVisible);
        Assert.Equal(string.Empty, display.ChargeStateText);
    }

    [Fact]
    public void Flow_grid_and_motor_nodes_render_labels()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Grid", display.Grid.Label);
        Assert.Equal("Motor", display.Motor.Label);
        Assert.Equal("No live data", display.Motor.Value);
    }

    [Fact]
    public void Flow_charging_edge_sums_dc_and_ac_power_and_is_active()
    {
        var display = Project(SuccessModel(flow: SampleFlow(dc: 48, ac: 2)));

        Assert.Equal("Charging", display.ChargingEdge.Label);
        Assert.Equal("50.0 kW", display.ChargingEdge.Value);
        Assert.True(display.ChargingEdge.Active);
    }

    [Fact]
    public void Flow_charging_edge_inactive_when_no_power()
    {
        var display = Project(SuccessModel(flow: SampleFlow(dc: 0, ac: 0)));

        Assert.Equal("0.0 kW", display.ChargingEdge.Value);
        Assert.False(display.ChargingEdge.Active);
    }

    [Fact]
    public void Flow_driving_edge_is_always_na_and_inactive()
    {
        var display = Project(SuccessModel());
        Assert.Equal("Driving", display.DrivingEdge.Label);
        Assert.Equal("N/A", display.DrivingEdge.Value);
        Assert.False(display.DrivingEdge.Active);
    }

    [Fact]
    public void Flow_battery_gauge_reads_soc_and_energy_remaining()
    {
        var display = Project(SuccessModel(flow: SampleFlow(soc: 73, remaining: 62.5)));

        Assert.Equal("Battery", display.BatteryLabel);
        Assert.Equal(73.0, display.BatterySoc);
        Assert.Equal("%", display.BatterySocUnit);
        Assert.True(display.EnergyRemainingVisible);
        Assert.Equal("62.5 kWh", display.EnergyRemainingText);
    }

    [Fact]
    public void Flow_energy_remaining_hidden_when_null()
    {
        var display = Project(SuccessModel(flow: SampleFlow(remaining: null)));
        Assert.False(display.EnergyRemainingVisible);
        Assert.Equal(string.Empty, display.EnergyRemainingText);
    }

    [Fact]
    public void Flow_dc_ac_nodes_format_power_hvac_and_accessories_are_na()
    {
        var display = Project(SuccessModel(flow: SampleFlow(dc: 48, ac: 2)));

        Assert.Equal("DC Power", display.DcPower.Label);
        Assert.Equal("48.0 kW", display.DcPower.Value);
        Assert.Equal("AC Power", display.AcPower.Label);
        Assert.Equal("2.0 kW", display.AcPower.Value);
        Assert.Equal("HVAC", display.Hvac.Label);
        Assert.Equal("N/A", display.Hvac.Value);
        Assert.Equal("Accessories", display.Accessories.Label);
        Assert.Equal("N/A", display.Accessories.Value);
    }

    [Fact]
    public void Flow_diagram_is_null_safe_when_no_live_reading()
    {
        var display = Project(SuccessModel(flow: EnergyFlowReading.Empty));

        Assert.Equal(0.0, display.BatterySoc);
        Assert.Equal("0.0 kW", display.ChargingEdge.Value);
        Assert.Equal("0.0 kW", display.DcPower.Value);
        Assert.False(display.ChargeStateVisible);
        Assert.False(display.EnergyRemainingVisible);
    }

    // ── Section 2: six historical summary tiles ─────────────────────────────────────────────────────────

    [Fact]
    public void Metric_tiles_project_labels_values_and_sublabels()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Total Energy", display.TotalEnergy.Label);
        Assert.Equal("120.00 kWh", display.TotalEnergy.Value);

        Assert.Equal("Total Charged", display.TotalCharged.Label);
        Assert.Equal("140.00 kWh", display.TotalCharged.Value);

        Assert.Equal("Distance", display.Distance.Label);
        Assert.Equal("800.0 km", display.Distance.Value);
        Assert.Equal("km", display.Distance.Sublabel);

        Assert.Equal("Efficiency", display.Efficiency.Label);
        Assert.Equal("150", display.Efficiency.Value);   // 0.15 Wh/m × 1000 → 150 Wh/km
        Assert.Equal("Wh/km", display.Efficiency.Sublabel);

        Assert.Equal("CO\u2082 Saved", display.Co2Saved.Label);
        Assert.Equal("42.3", display.Co2Saved.Value);
        Assert.Equal("kg", display.Co2Saved.Sublabel);

        Assert.Equal("Period", display.Period.Label);
        Assert.Equal("7", display.Period.Value);
        Assert.Equal("days", display.Period.Sublabel);
    }

    [Fact]
    public void Metric_tiles_use_imperial_units_when_preferred()
    {
        var display = Project(SuccessModel(), Imperial);

        Assert.Equal("mi", display.Distance.Sublabel);
        Assert.Equal("Wh/mi", display.Efficiency.Sublabel);
        Assert.Equal("241", display.Efficiency.Value);   // 0.15 × 1609.344 → 241 (rounded)
    }

    // ── Section 3/4: charts ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Daily_energy_area_chart_has_one_series_with_a_point_per_day()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasDailyEnergy);
        var series = Assert.Single(display.DailyEnergySeries);
        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal("Energy", series.Name);
        Assert.Equal(3, series.Points.Count);
        Assert.Equal(10_000, series.Points[0].Y);   // SI watt-hours plotted (web parity)
    }

    [Fact]
    public void Daily_distance_bar_chart_plots_distance_per_day()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasDailyDistance);
        var series = Assert.Single(display.DailyDistanceSeries);
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal("Distance (km)", series.Name);
        Assert.Equal(60_000, series.Points[0].Y);
    }

    [Fact]
    public void Daily_efficiency_bar_chart_filters_non_positive_and_scales_to_unit()
    {
        var daily = new[]
        {
            Day("2026-06-10", 10_000, 60_000, 0.16),
            Day("2026-06-11", 12_000, 70_000, 0),   // dropped (efficiency <= 0)
        };
        var display = Project(SuccessModel(stats: SampleStats(daily)));

        Assert.True(display.HasDailyEfficiency);
        var series = Assert.Single(display.DailyEfficiencySeries);
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal("Wh/km", series.Name);
        Assert.Equal(160, Assert.Single(series.Points).Y);   // 0.16 × 1000, only the positive day
    }

    [Fact]
    public void Charts_are_empty_when_no_daily_breakdown()
    {
        var display = Project(SuccessModel(stats: SampleStats(Array.Empty<EnergyDailyEntry>())));

        Assert.False(display.HasDailyEnergy);
        Assert.False(display.HasDailyDistance);
        Assert.False(display.HasDailyEfficiency);
        Assert.Empty(display.DailyEnergySeries);
        Assert.Equal("No daily energy data available.", display.NoDailyEnergyMessage);
        Assert.Equal("No daily distance data available.", display.NoDailyDistanceMessage);
        Assert.Equal("No efficiency data available.", display.NoEfficiencyMessage);
    }

    // ── Section 5: efficiency metrics sub-cards ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0.0, "No Data", StatusKind.Neutral)]
    [InlineData(0.12, "Excellent", StatusKind.Success)]
    [InlineData(0.18, "Good", StatusKind.Warning)]
    [InlineData(0.25, "High", StatusKind.Danger)]
    public void Efficiency_card_badge_follows_thresholds(double rawWhPerM, string badge, StatusKind status)
    {
        var stats = SampleStats() with { AvgEfficiencyWhPerM = rawWhPerM };
        var display = Project(SuccessModel(stats: stats));

        Assert.Equal("Efficiency Metrics", display.EfficiencyMetricsTitle);
        Assert.Equal("Wh/km", display.EfficiencyCard.Label);
        Assert.Equal(badge, display.EfficiencyCard.BadgeText);
        Assert.Equal(status, display.EfficiencyCard.BadgeStatus);
    }

    [Fact]
    public void Efficiency_metrics_co2_and_avg_per_day_cards()
    {
        var display = Project(SuccessModel());

        Assert.Equal("CO\u2082 Saved", display.Co2Card.Label);
        Assert.Equal("42.3", display.Co2Card.Value);
        Assert.Equal("kg CO\u2082", display.Co2Card.BadgeText);
        Assert.Equal(StatusKind.Success, display.Co2Card.BadgeStatus);

        Assert.Equal("Avg Energy/Day", display.AvgPerDayCard.Label);
        Assert.Equal("17.14 kWh", display.AvgPerDayCard.Value);   // 120000 Wh / 7 days → 17.14 kWh
        Assert.Equal("per day", display.AvgPerDayCard.BadgeText);
        Assert.Equal(StatusKind.Info, display.AvgPerDayCard.BadgeStatus);
    }

    // ── Section 6: daily energy history table ───────────────────────────────────────────────────────────

    [Fact]
    public void History_table_has_four_columns()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Daily Energy History", display.DailyHistoryTitle);
        Assert.Collection(
            display.HistoryColumns,
            c => AssertColumn(c, "date", "Date", numeric: false),
            c => AssertColumn(c, "energy", "Energy", numeric: true),
            c => AssertColumn(c, "distance", "Distance (km)", numeric: true),
            c => AssertColumn(c, "efficiency", "Wh/km", numeric: true));
    }

    [Fact]
    public void History_rows_are_sorted_date_descending_and_formatted()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasHistory);
        Assert.Equal(3, display.HistoryRows.Count);

        var first = display.HistoryRows[0];
        Assert.Equal("2026-06-12", first.Key);   // latest day first (web default sort)
        Assert.Equal("Jun 12", first.Date);
        Assert.Equal("8.00 kWh", first.Energy);
        Assert.Equal("50.0 km", first.Distance);
        Assert.Equal("150", first.Efficiency);   // 0.15 × 1000
    }

    [Fact]
    public void History_empty_when_no_rows()
    {
        var display = Project(SuccessModel(stats: SampleStats(Array.Empty<EnergyDailyEntry>())));

        Assert.False(display.HasHistory);
        Assert.Equal("No energy history records available.", display.HistoryEmptyMessage);
        Assert.Equal("No energy records found.", display.HistoryTableEmptyMessage);
    }

    // ── Unit math parity ─────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0.15, DistanceUnit.Km, 150)]
    [InlineData(0.15, DistanceUnit.Mi, 241)]    // 0.15 × 1609.344 = 241.4 → 241
    [InlineData(0.2049, DistanceUnit.Km, 205)]
    public void EfficiencyForDisplay_matches_web(double raw, DistanceUnit unit, double expected) =>
        Assert.Equal(expected, EnergyFlowProjection.EfficiencyForDisplay(raw, unit));

    [Fact]
    public void FormatDate_renders_short_month_day_and_em_dash_for_invalid()
    {
        Assert.Equal("Jun 12", EnergyFlowProjection.FormatDate("2026-06-12", Now));
        Assert.Equal("\u2014", EnergyFlowProjection.FormatDate(null, Now));
        Assert.Equal("\u2014", EnergyFlowProjection.FormatDate("not-a-date", Now));
    }

    // ── Tolerant JSON parsing ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Flow_parse_unwraps_envelope_and_reads_fields()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":{\"dc_charging_power\":48.5,\"ac_charging_power\":1.5,\"energy_remaining\":60.0," +
            "\"soc\":80,\"charge_state\":\"Charging\"}}");

        var flow = EnergyFlowReading.FromJson(doc.RootElement);

        Assert.Equal(48.5, flow.DcChargingPower);
        Assert.Equal(1.5, flow.AcChargingPower);
        Assert.Equal(60.0, flow.EnergyRemaining);
        Assert.Equal(80, flow.Soc);
        Assert.Equal("Charging", flow.ChargeState);
    }

    [Fact]
    public void Flow_parse_tolerates_nulls_and_non_objects()
    {
        using var nulls = JsonDocument.Parse("{\"dc_charging_power\":null,\"soc\":null}");
        var flow = EnergyFlowReading.FromJson(nulls.RootElement);
        Assert.Null(flow.DcChargingPower);
        Assert.Null(flow.Soc);

        using var notObject = JsonDocument.Parse("42");
        Assert.Equal(EnergyFlowReading.Empty, EnergyFlowReading.FromJson(notObject.RootElement));
    }

    [Fact]
    public void Stats_parse_unwraps_envelope_reads_totals_and_daily_breakdown()
    {
        using var doc = JsonDocument.Parse(
            "{\"data\":{\"vehicle_id\":3,\"period_days\":30,\"total_energy_used_wh\":50000," +
            "\"total_energy_charged_wh\":60000,\"total_distance_m\":400000,\"avg_efficiency_wh_per_m\":0.125," +
            "\"co2_saved_kg\":21.5,\"daily_breakdown\":[{\"date\":\"2026-06-12\",\"energy_wh\":1000," +
            "\"distance_m\":8000,\"efficiency_wh_per_m\":0.125,\"cost\":1.2}]}}");

        var stats = EnergyStatsReading.FromJson(doc.RootElement);

        Assert.True(stats.HasData);
        Assert.Equal(3, stats.VehicleId);
        Assert.Equal(30, stats.PeriodDays);
        Assert.Equal(50000, stats.TotalEnergyUsedWh);
        Assert.Equal(0.125, stats.AvgEfficiencyWhPerM);
        var day = Assert.Single(stats.DailyBreakdown);
        Assert.Equal("2026-06-12", day.Date);
        Assert.Equal(1000, day.EnergyWh);
        Assert.Equal(8000, day.DistanceM);
    }

    [Fact]
    public void Stats_parse_treats_non_object_as_no_data()
    {
        using var notObject = JsonDocument.Parse("null");
        Assert.False(EnergyStatsReading.FromJson(notObject.RootElement).HasData);
    }

    // ── View-model state matrix ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_stats_and_flow_into_the_success_state()
    {
        var feed = new FakeEnergyFlowFeed(SampleStats(), SampleFlow());
        using var vm = new EnergyFlowPageViewModel(feed, Localizer, vehicleId: "1", clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.True(vm.Display.ChargeStateVisible);
        Assert.False(vm.IsFetching);
        Assert.Equal(1, feed.StatsCount);
        Assert.Equal(1, feed.FlowCount);
        Assert.Equal(EnergyFlowProjection.DefaultDays, feed.LastDays);
    }

    [Fact]
    public async Task ViewModel_no_vehicle_is_the_empty_state_without_fetching()
    {
        var feed = new FakeEnergyFlowFeed(SampleStats(), SampleFlow());
        using var vm = new EnergyFlowPageViewModel(feed, Localizer, vehicleId: null, clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
        Assert.Equal(0, feed.StatsCount);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new EnergyFlowPageViewModel(EmptyEnergyFlowFeed.Instance, Localizer, vehicleId: "1", clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_stats_failure_is_the_error_state()
    {
        using var vm = new EnergyFlowPageViewModel(new ThrowingStatsFeed(), Localizer, vehicleId: "1", clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.Contains("Failed to load data", vm.Display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ViewModel_flow_failure_does_not_error_the_page()
    {
        // web useEnergyFlow has retry:false — a flow failure leaves the diagram null-safe, not an error.
        var feed = new FlowThrowingFeed(SampleStats());
        using var vm = new EnergyFlowPageViewModel(feed, Localizer, vehicleId: "1", clock: () => Now);

        await vm.LoadAsync();

        Assert.Equal(EnergyFlowState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal("0.0 kW", vm.Display.ChargingEdge.Value);   // null-safe zeros
        Assert.False(vm.Display.ChargeStateVisible);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeEnergyFlowFeed(SampleStats(), SampleFlow());
        using var vm = new EnergyFlowPageViewModel(feed, Localizer, vehicleId: "1", clock: () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.StatsCount);
        Assert.Equal(2, feed.FlowCount);
    }

    // ── Generated-client feed (web useEnergyFlow + the historical days query) ───────────────────────────

    [Fact]
    public async Task ClientFeed_stats_sends_the_energy_operation_with_vehicle_and_days()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"data\":{\"period_days\":7}}"));
        var feed = new EnergyFlowClientFeed(api);

        var stats = await feed.FetchStatsAsync("42", 7, default);

        Assert.True(stats.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_energy", request.OperationId);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
        Assert.Equal("7", request.Query!["days"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_flow_sends_the_energy_flow_operation_with_vehicle()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"data\":{\"soc\":55}}"));
        var feed = new EnergyFlowClientFeed(api);

        var flow = await feed.FetchFlowAsync("42", default);

        Assert.Equal(55, flow.Soc);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vehicles_vehicleID_energy_flow", request.OperationId);
        Assert.Equal("42", request.PathParams!["vehicleID"]);
    }

    [Fact]
    public async Task ClientFeed_propagates_api_exception()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new EnergyFlowClientFeed(api);

        var ex = await Assert.ThrowsAsync<ApiException>(() => feed.FetchStatsAsync("1", 7, default));
        Assert.Equal(500, ex.StatusCode);
    }

    [Fact]
    public void ClientFeed_operations_resolve_against_the_generated_endpoint_table()
    {
        var api = new FakeApiClient();
        Assert.Equal(EnergyFlowRegistration.OperationStats, api.ResolveEndpoint(EnergyFlowRegistration.OperationStats).OperationId);
        Assert.Equal(EnergyFlowRegistration.OperationFlow, api.ResolveEndpoint(EnergyFlowRegistration.OperationFlow).OperationId);
    }

    // ── Registration + diagnostics ───────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("EnergyFlow", EnergyFlowRegistration.RouteName);
        Assert.Equal("get_api_v1_vehicles_vehicleID_energy_flow", EnergyFlowRegistration.OperationFlow);
        Assert.Equal("get_api_v1_vehicles_vehicleID_energy", EnergyFlowRegistration.OperationStats);
        Assert.Equal("Energy Flow", EnergyFlowRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new EnergyFlowDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=EnergyFlowPage", Assert.Single(lines));
    }

    private static void AssertColumn(EnergyHistoryColumn column, string key, string header, bool numeric)
    {
        Assert.Equal(key, column.Key);
        Assert.Equal(header, column.Header);
        Assert.Equal(numeric, column.IsNumeric);
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeEnergyFlowFeed(EnergyStatsReading stats, EnergyFlowReading flow) : IEnergyFlowFeed
    {
        public int StatsCount { get; private set; }

        public int FlowCount { get; private set; }

        public int LastDays { get; private set; }

        public Task<EnergyStatsReading> FetchStatsAsync(string vehicleId, int days, CancellationToken cancellationToken)
        {
            StatsCount++;
            LastDays = days;
            return Task.FromResult(stats);
        }

        public Task<EnergyFlowReading> FetchFlowAsync(string vehicleId, CancellationToken cancellationToken)
        {
            FlowCount++;
            return Task.FromResult(flow);
        }
    }

    private sealed class ThrowingStatsFeed : IEnergyFlowFeed
    {
        public Task<EnergyStatsReading> FetchStatsAsync(string vehicleId, int days, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("Failed to load data");

        public Task<EnergyFlowReading> FetchFlowAsync(string vehicleId, CancellationToken cancellationToken) =>
            Task.FromResult(EnergyFlowReading.Empty);
    }

    private sealed class FlowThrowingFeed(EnergyStatsReading stats) : IEnergyFlowFeed
    {
        public Task<EnergyStatsReading> FetchStatsAsync(string vehicleId, int days, CancellationToken cancellationToken) =>
            Task.FromResult(stats);

        public Task<EnergyFlowReading> FetchFlowAsync(string vehicleId, CancellationToken cancellationToken) =>
            throw new ApiException("flow unavailable", 503);
    }
}
