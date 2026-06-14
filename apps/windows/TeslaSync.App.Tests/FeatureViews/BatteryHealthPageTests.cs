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
/// Headless verification of the <c>BatteryHealthPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/battery/pages/BatteryHealthPage.tsx), the tolerant four-source parsers, the four-state
/// matrix (loading / empty / error / success), the SI temperature / distance / energy formatting at the
/// display boundary, the smart-insight and recommendation logic, and the generated-client feed's request
/// shaping (web <c>useBatteryHealthAnalytics</c> + <c>useBatteryDegradation</c> +
/// <c>useChargingSessionsPaginated</c> + <c>useChargingTelemetryLatest</c>). The WinUI view is exercised by the
/// app build; its per-region visibility is driven entirely by the <see cref="BatteryHealthDisplay"/> flags
/// asserted here.
/// </summary>
public sealed class BatteryHealthPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);
    private const string Degrees = "\u00B0";

    // The 105 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "battery.bar.capacity", "battery.bar.cycles", "battery.bar.degradation",
        "battery.chart.acdc", "battery.chart.acdc.aria", "battery.chart.actual", "battery.chart.capacityTrend",
        "battery.chart.capacityTrend.aria", "battery.chart.chargeDist", "battery.chart.chargeDistSub",
        "battery.chart.chargeEnded", "battery.chart.chargeStarted", "battery.chart.dashedProjected",
        "battery.chart.noBreakdown", "battery.chart.noRange", "battery.chart.noSessions", "battery.chart.noTrend",
        "battery.chart.predicted", "battery.chart.range", "battery.chart.rangeTrend", "battery.chart.rangeTrend.aria",
        "battery.empty", "battery.gauge.capacity", "battery.gauge.cycles", "battery.gauge.degradation",
        "battery.gauge.health", "battery.habit.avgEnd", "battery.habit.avgStart", "battery.habit.home",
        "battery.habit.supercharger", "battery.health.degraded", "battery.health.excellent", "battery.health.good",
        "battery.insight.concernDesc", "battery.insight.concernTitle", "battery.insight.deepDischargeDesc",
        "battery.insight.deepDischargeTitle", "battery.insight.excellentDesc", "battery.insight.excellentTitle",
        "battery.insight.goodDesc", "battery.insight.goodHabitsDesc", "battery.insight.goodHabitsTitle",
        "battery.insight.goodTitle", "battery.insight.highFastChargeDesc", "battery.insight.highFastChargeTitle",
        "battery.insight.highSuperchargerDesc", "battery.insight.highSuperchargerTitle", "battery.insight.lowDegDesc",
        "battery.insight.lowDegTitle", "battery.insights.empty", "battery.insights.title", "battery.metric.age",
        "battery.metric.currentCap", "battery.metric.cycles", "battery.metric.degradation",
        "battery.metric.fullChargeComplete", "battery.metric.originalCap", "battery.metric.soh", "battery.months",
        "battery.newVsNow.capNew", "battery.newVsNow.capNow", "battery.newVsNow.lost", "battery.newVsNow.rangeNew",
        "battery.newVsNow.rangeNow", "battery.newVsNow.title", "battery.perYear", "battery.recommendations.title",
        "battery.section.acdcFailed", "battery.section.capacityRangeFailed", "battery.section.chargeDistFailed",
        "battery.section.heroFailed", "battery.section.insightsFailed", "battery.section.metricBarsFailed",
        "battery.section.quickLinksFailed", "battery.section.recommendationsFailed", "battery.section.summaryCardsFailed",
        "battery.section.thermalFailed", "battery.stats.acSessions", "battery.stats.cycles", "battery.stats.dcSessions",
        "battery.stats.empty", "battery.stats.title", "battery.stats.totalEnergy", "battery.stats.totalSessions",
        "battery.subtitle", "battery.thermal.heater", "battery.thermal.moduleNumber", "battery.thermal.moduleTempMax",
        "battery.thermal.moduleTempMin", "battery.thermal.tempSpread", "battery.thermal.title", "battery.tip.aboveAvg",
        "battery.tip.avoid100", "battery.tip.avoidDeep", "battery.tip.great", "battery.tip.reduceFast", "battery.title",
        "battery.warrantyLimit", "battery.warrantyNote", "battery.yearsTo80", "battery.yr",
        "common.no", "common.off", "common.on", "common.yes",
    ];

    private static BatteryHealthHistoryPoint HistoryPoint(
        string date = "2026-01-01", double odometerKm = 15000, double soh = 92, double capacityWh = 72000, double rangeKm = 480) =>
        new(date, odometerKm, soh, capacityWh, rangeKm);

    private static BatteryHealthAnalytics Health(
        double soh = 92,
        double estimated = 72.5,
        double original = 78,
        double rateYr = 2.3,
        double ageMonths = 30,
        double cycles = 342,
        double dod = 45,
        double fast = 18,
        double full = 12,
        IReadOnlyList<BatteryHealthHistoryPoint>? history = null) =>
        new(soh, estimated, original, rateYr, ageMonths, cycles, dod, fast, full, 84, 70, history ?? [HistoryPoint()]);

    private static BatteryHealthForecast Forecast(
        bool enough = true,
        double slope = -1.5,
        double years = 5.2,
        IReadOnlyList<ForecastProjectionPoint>? points = null) =>
        new(new ForecastPrediction(enough, slope, years, "2031-06-01", points ?? [new ForecastProjectionPoint("2031-06-15", 80)]));

    private static ChargeSessionSummary Session(
        double start = 20, double? end = 80, string? charger = null, double? peak = null, double energyWh = 30000) =>
        new(start, end, charger, peak, energyWh);

    private static ChargeThermalLatest Thermal(
        bool? full = true, double? max = 30, double? min = 20, long? numMax = 3, long? numMin = 7, bool? heater = false) =>
        new(full, max, min, numMax, numMin, heater);

    private static BatteryHealthPageModel SuccessModel(
        BatteryHealthAnalytics? health = null,
        BatteryHealthForecast? forecast = null,
        IReadOnlyList<ChargeSessionSummary>? sessions = null,
        ChargeThermalLatest? thermal = null) =>
        new(
            BatteryHealthPageSnapshot.Compose(health ?? Health(), forecast ?? Forecast(), sessions ?? [Session()], thermal ?? Thermal()),
            false,
            null);

    private static BatteryHealthDisplay Project(BatteryHealthPageModel model, UnitPref? units = null) =>
        BatteryHealthProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 105 manifest strings) ------------------------------

    [Fact]
    public void Required_string_key_set_has_exactly_one_hundred_five_unique_keys() =>
        Assert.Equal(105, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = BatteryHealthProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = BatteryHealthProjection.Project(BatteryHealthPageModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(BatteryHealthPageModel.Initial);

        Assert.Equal(BatteryHealthState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_health_object()
    {
        var display = Project(new BatteryHealthPageModel(BatteryHealthPageSnapshot.Empty, false, null));

        Assert.Equal(BatteryHealthState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_error_when_health_query_failed()
    {
        var display = Project(new BatteryHealthPageModel(BatteryHealthPageSnapshot.Empty, false, "network down"));

        Assert.Equal(BatteryHealthState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_health_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(BatteryHealthState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Health-score hero (four gauges + badge + years-to-80) ---------------------

    [Fact]
    public void Hero_projects_four_gauges_with_labels_units_and_scales()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.Gauges.Count);
        Assert.Equal("Health Score", display.Gauges[0].Label);
        Assert.Equal(92, display.Gauges[0].Value);
        Assert.Equal("/100", display.Gauges[0].Unit);
        Assert.Equal("Capacity", display.Gauges[1].Label);
        Assert.Equal("%", display.Gauges[1].Unit);
        Assert.Equal(100, display.Gauges[1].Max);
        Assert.Equal("Degradation", display.Gauges[2].Label);
        Assert.Equal(10, display.Gauges[2].Max);
        Assert.Equal("Cycles", display.Gauges[3].Label);
        Assert.Equal(1500, display.Gauges[3].Max);
    }

    [Fact]
    public void Capacity_gauge_is_estimated_over_original_clamped()
    {
        var display = Project(SuccessModel(Health(estimated: 39, original: 78)));
        Assert.Equal(50, display.Gauges[1].Value, 3);
    }

    [Fact]
    public void Capacity_gauge_is_zero_when_original_capacity_missing()
    {
        var display = Project(SuccessModel(Health(estimated: 70, original: 0)));
        Assert.Equal(0, display.Gauges[1].Value);
    }

    [Theory]
    [InlineData(95, "Excellent", StatusKind.Success, 1)]
    [InlineData(80, "Good", StatusKind.Warning, 3)]
    [InlineData(65, "Degraded", StatusKind.Danger, 5)]
    public void Health_badge_and_gauge_color_follow_thresholds(double soh, string expectedText, StatusKind expectedStatus, int colorIndex)
    {
        var display = Project(SuccessModel(Health(soh: soh)));

        Assert.Equal(expectedText, display.HealthBadgeText);
        Assert.Equal(expectedStatus, display.HealthBadgeStatus);
        Assert.Equal(colorIndex, display.Gauges[0].ColorIndex);
    }

    [Fact]
    public void Years_to_80_uses_the_prediction_when_trustworthy()
    {
        var display = Project(SuccessModel(forecast: Forecast(years: 5.2)));
        Assert.Equal("5.2", display.YearsTo80Value);
    }

    [Fact]
    public void Years_to_80_is_em_dash_when_projection_not_trustworthy()
    {
        var display = Project(SuccessModel(forecast: Forecast(enough: false)));
        Assert.Equal("\u2014", display.YearsTo80Value);
    }

    [Theory]
    [InlineData(true, -1.5, 5.2, true)]
    [InlineData(false, -1.5, 5.2, false)]
    [InlineData(true, -60, 5.2, false)]
    [InlineData(true, -1.5, 0, false)]
    public void Projection_trustworthy_matches_web_guard(bool enough, double slope, double years, bool expected) =>
        Assert.Equal(expected, BatteryHealthProjection.ProjectionTrustworthy(Forecast(enough, slope, years)));

    // ---- Metric bars ---------------------------------------------------------------

    [Fact]
    public void Metric_bars_project_capacity_degradation_and_cycles()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.MetricBars.Count);
        Assert.Equal("Current Capacity", display.MetricBars[0].Label);
        Assert.Equal(93, display.MetricBars[0].Value);
        Assert.Equal("72.5 / 78.0 kWh", display.MetricBars[0].Caption);
        Assert.Equal("Degradation", display.MetricBars[1].Label);
        Assert.Equal(10, display.MetricBars[1].Max);
        Assert.Equal("2.30% per year", display.MetricBars[1].Caption);
        Assert.Equal("Charge Cycles", display.MetricBars[2].Label);
        Assert.Equal(1500, display.MetricBars[2].Max);
    }

    // ---- Summary cards -------------------------------------------------------------

    [Fact]
    public void Summary_cards_project_seven_tiles_with_labels_and_values()
    {
        var display = Project(SuccessModel());

        Assert.Equal(7, display.SummaryCards.Count);
        Assert.Equal("State of Health", display.SummaryCards[0].Label);
        Assert.Equal("92.00%", display.SummaryCards[0].Value);
        Assert.Equal("Current Capacity", display.SummaryCards[1].Label);
        Assert.Equal("72.5 kWh", display.SummaryCards[1].Value);
        Assert.Equal("Original Capacity", display.SummaryCards[2].Label);
        Assert.Equal("78.0 kWh", display.SummaryCards[2].Value);
        Assert.Equal("Degradation Rate", display.SummaryCards[3].Label);
        Assert.Equal("2.30%/yr", display.SummaryCards[3].Value);
        Assert.Equal("Total Cycles", display.SummaryCards[4].Label);
        Assert.Equal("342", display.SummaryCards[4].Value);
        Assert.Equal("Battery Age", display.SummaryCards[5].Label);
        Assert.Equal("30 months", display.SummaryCards[5].Value);
        Assert.Equal("Full Charge Complete", display.SummaryCards[6].Label);
        Assert.Equal("Yes", display.SummaryCards[6].Value);
    }

    [Fact]
    public void Battery_age_card_is_em_dash_when_age_unknown()
    {
        var display = Project(SuccessModel(Health(ageMonths: 0)));
        Assert.Equal("\u2014", display.SummaryCards[5].Value);
    }

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(true, "Yes")]
    [InlineData(false, "No")]
    public void Full_charge_complete_card_maps_the_nullable_flag(bool? flag, string expected)
    {
        var display = Project(SuccessModel(thermal: Thermal(full: flag)));
        Assert.Equal(expected, display.SummaryCards[6].Value);
    }

    // ---- Thermal monitoring --------------------------------------------------------

    [Fact]
    public void Thermal_cards_convert_si_celsius_and_carry_module_numbers()
    {
        var display = Project(SuccessModel(thermal: Thermal(max: 30, min: 20, numMax: 3, numMin: 7)));

        Assert.Equal(4, display.ThermalCards.Count);
        Assert.Equal("Module Temp (Max)", display.ThermalCards[0].Label);
        Assert.Equal($"30.0 {Degrees}C", display.ThermalCards[0].Value);
        Assert.Equal("Module #3", display.ThermalCards[0].Sublabel);
        Assert.Equal($"20.0 {Degrees}C", display.ThermalCards[1].Value);
        Assert.Equal("Module #7", display.ThermalCards[1].Sublabel);
        Assert.Equal($"10.0 {Degrees}C", display.ThermalCards[3].Value);
    }

    [Fact]
    public void Thermal_cards_render_in_imperial_units()
    {
        var display = Project(SuccessModel(thermal: Thermal(max: 30, min: 20)), UnitPref.Imperial);

        Assert.Equal($"86.0 {Degrees}F", display.ThermalCards[0].Value);
        Assert.Equal($"68.0 {Degrees}F", display.ThermalCards[1].Value);
        Assert.Equal($"18.0 {Degrees}F", display.ThermalCards[3].Value);
    }

    [Theory]
    [InlineData(null, "\u2014")]
    [InlineData(true, "On")]
    [InlineData(false, "Off")]
    public void Heater_card_maps_the_nullable_flag(bool? flag, string expected)
    {
        var display = Project(SuccessModel(thermal: Thermal(heater: flag)));
        Assert.Equal(expected, display.ThermalCards[2].Value);
    }

    [Fact]
    public void Thermal_cards_are_em_dash_when_telemetry_missing()
    {
        var snapshot = BatteryHealthPageSnapshot.Compose(Health(), Forecast(), [Session()], thermal: null);
        var display = Project(new BatteryHealthPageModel(snapshot, false, null));

        Assert.Equal("\u2014", display.ThermalCards[0].Value);
        Assert.Null(display.ThermalCards[0].Sublabel);
        Assert.Equal("\u2014", display.ThermalCards[3].Value);
    }

    // ---- Smart insights ------------------------------------------------------------

    [Fact]
    public void Insights_excellent_good_habits_and_low_degradation_for_healthy_pack()
    {
        var display = Project(SuccessModel(Health(soh: 92, fast: 18, rateYr: 2.3), sessions: [Session()]));

        Assert.Equal(3, display.Insights.Count);
        Assert.Equal("Excellent Health", display.Insights[0].Title);
        Assert.Equal(StatusKind.Success, display.Insights[0].Status);
        Assert.Contains("92/100", display.Insights[0].Description, StringComparison.Ordinal);
        Assert.Equal("Good Charging Habits", display.Insights[1].Title);
        Assert.Equal("Low Degradation Rate", display.Insights[2].Title);
        Assert.Contains("2.3%", display.Insights[2].Description, StringComparison.Ordinal);
    }

    [Fact]
    public void Insights_flag_concern_and_high_fast_charging()
    {
        var display = Project(SuccessModel(Health(soh: 60, fast: 70, rateYr: 4), sessions: [Session()]));

        Assert.Equal("Health Concern", display.Insights[0].Title);
        Assert.Equal(StatusKind.Danger, display.Insights[0].Status);
        Assert.Equal("High Fast-Charge Usage", display.Insights[1].Title);
        Assert.Contains("70.00%", display.Insights[1].Description, StringComparison.Ordinal);
        Assert.DoesNotContain(display.Insights, x => x.Title == "Low Degradation Rate");
    }

    [Fact]
    public void Insights_flag_deep_discharges_and_supercharger_usage()
    {
        var sessions = new List<ChargeSessionSummary>
        {
            Session(start: 5, charger: "Tesla Supercharger"),
            Session(start: 4, charger: "Tesla Supercharger"),
            Session(start: 3, charger: "Tesla Supercharger"),
            Session(start: 2, charger: "Tesla Supercharger"),
        };
        var display = Project(SuccessModel(Health(soh: 80, fast: 10), sessions: sessions));

        Assert.Contains(display.Insights, x => x.Title == "Deep Discharges Detected" && x.Description.Contains('4', StringComparison.Ordinal));
        Assert.Contains(display.Insights, x => x.Title == "High Supercharger Usage");
    }

    // ---- Capacity trend & range trend charts ---------------------------------------

    [Fact]
    public void Capacity_trend_joins_actual_and_projected_segments()
    {
        var history = new List<BatteryHealthHistoryPoint> { HistoryPoint(date: "2026-01-01", soh: 100) };
        var points = new List<ForecastProjectionPoint> { new("2031-06-15", 80) };
        var display = Project(SuccessModel(Health(history: history), Forecast(points: points)));

        Assert.True(display.CapacityTrend.HasData);
        var actual = display.CapacityTrend.Series.Single(x => x.Name == "Actual %");
        Assert.Equal(ChartSeriesKind.Area, actual.Kind);
        Assert.Equal(2, actual.Points.Count);
        Assert.Equal(100, actual.Points[^1].Y);
        var predicted = display.CapacityTrend.Series.Single(x => x.Name == "Predicted %");
        Assert.Equal(80, predicted.Points.Single().Y);
        Assert.Contains(display.CapacityTrend.Annotations, a => a.Value == 80);
        Assert.Contains(display.CapacityTrend.Annotations, a => a.Value == 70);
    }

    [Fact]
    public void Capacity_trend_has_no_data_without_history_or_projection()
    {
        var display = Project(SuccessModel(Health(history: []), Forecast(enough: false)));
        Assert.False(display.CapacityTrend.HasData);
    }

    [Fact]
    public void Range_trend_builds_a_series_in_user_units()
    {
        var history = new List<BatteryHealthHistoryPoint>
        {
            HistoryPoint(date: "2026-01-01", rangeKm: 500),
            HistoryPoint(date: "2026-02-01", rangeKm: 470),
        };
        var display = Project(SuccessModel(Health(history: history)), UnitPref.Imperial);

        Assert.True(display.RangeTrend.HasData);
        var series = Assert.Single(display.RangeTrend.Series);
        Assert.Contains("mi", series.Name, StringComparison.Ordinal);
        double expectedFirst = Math.Round(UnitConverters.DistanceFromSi(500 * 1000.0, DistanceUnit.Mi), MidpointRounding.AwayFromZero);
        Assert.Equal(expectedFirst, series.Points[0].Y);
    }

    [Fact]
    public void Range_trend_has_no_data_when_all_ranges_zero()
    {
        var history = new List<BatteryHealthHistoryPoint> { HistoryPoint(rangeKm: 0), HistoryPoint(rangeKm: 0) };
        var display = Project(SuccessModel(Health(history: history)));
        Assert.False(display.RangeTrend.HasData);
    }

    // ---- Charge-level distribution + habits ----------------------------------------

    [Fact]
    public void Charge_distribution_buckets_sessions_and_builds_two_series()
    {
        var sessions = new List<ChargeSessionSummary> { Session(start: 25, end: 85), Session(start: 5, end: 95) };
        var display = Project(SuccessModel(sessions: sessions));

        Assert.True(display.ChargeDist.HasData);
        Assert.Equal(2, display.ChargeDist.Series.Count);
        var started = display.ChargeDist.Series.Single(x => x.Name == "Charge Started");
        Assert.Equal(10, started.Points.Count);
        Assert.Equal(1, started.Points[2].Y); // 25% -> bucket 2
        Assert.Equal(1, started.Points[0].Y); // 5% -> bucket 0
    }

    [Fact]
    public void Charge_habits_project_averages_and_counts()
    {
        var sessions = new List<ChargeSessionSummary>
        {
            Session(start: 20, end: 80, charger: "Tesla"),
            Session(start: 40, end: 90, charger: null),
        };
        var display = Project(SuccessModel(sessions: sessions));

        Assert.Equal(4, display.ChargeDist.Habits.Count);
        Assert.Equal("30.00%", display.ChargeDist.Habits[0].Value); // avg start (20+40)/2
        Assert.Equal("85.00%", display.ChargeDist.Habits[1].Value); // avg end (80+90)/2
        Assert.Equal("1", display.ChargeDist.Habits[2].Value);      // supercharger count
        Assert.Equal("1", display.ChargeDist.Habits[3].Value);      // home charges
    }

    [Fact]
    public void Charge_distribution_is_empty_without_sessions()
    {
        var display = Project(SuccessModel(sessions: []));
        Assert.False(display.ChargeDist.HasData);
        Assert.Empty(display.ChargeDist.Habits);
    }

    // ---- New vs Now ----------------------------------------------------------------

    [Fact]
    public void New_vs_now_projects_capacity_and_range_cards_with_deltas()
    {
        var history = new List<BatteryHealthHistoryPoint>
        {
            HistoryPoint(date: "2026-01-01", rangeKm: 500),
            HistoryPoint(date: "2026-06-01", rangeKm: 450),
        };
        var display = Project(SuccessModel(Health(estimated: 72.5, original: 78, history: history)));

        Assert.Equal(4, display.NewVsNowCards.Count);
        Assert.Equal("78.0", display.NewVsNowCards[0].Value);
        Assert.Null(display.NewVsNowCards[0].Delta);
        Assert.Equal("72.5", display.NewVsNowCards[1].Value);
        Assert.Equal("-5.5 kWh", display.NewVsNowCards[1].Delta);
        Assert.Equal("500", display.NewVsNowCards[2].Value);
        Assert.NotNull(display.NewVsNowCards[3].Delta);
        Assert.Contains("lost", display.NewVsNowCards[3].Delta!, StringComparison.Ordinal);
    }

    [Fact]
    public void New_vs_now_range_is_em_dash_without_history()
    {
        var display = Project(SuccessModel(Health(history: [])));
        Assert.Equal("\u2014", display.NewVsNowCards[2].Value);
        Assert.Null(display.NewVsNowCards[3].Delta);
    }

    // ---- AC/DC breakdown + charging statistics -------------------------------------

    [Fact]
    public void Ac_dc_breakdown_splits_energy_by_charger_type()
    {
        var sessions = new List<ChargeSessionSummary>
        {
            Session(charger: "Tesla Supercharger", energyWh: 50000),
            Session(charger: null, peak: 5000, energyWh: 20000),
        };
        var display = Project(SuccessModel(Health(cycles: 342), sessions: sessions));

        Assert.True(display.AcDc.HasData);
        Assert.Equal(2, display.AcDc.PieData.Count);
        var ac = display.AcDc.PieData.Single(p => p.Label == "AC");
        var dc = display.AcDc.PieData.Single(p => p.Label == "DC");
        Assert.Equal(20, ac.Y);
        Assert.Equal(50, dc.Y);

        Assert.Equal(5, display.AcDc.Stats.Count);
        Assert.Equal("2", display.AcDc.Stats[0].Value); // total sessions
        Assert.Equal("1", display.AcDc.Stats[1].Value); // AC sessions
        Assert.Equal("1", display.AcDc.Stats[2].Value); // DC sessions
        Assert.Equal("70.0 kWh", display.AcDc.Stats[3].Value);
        Assert.Equal("342", display.AcDc.Stats[4].Value);
    }

    [Fact]
    public void Ac_dc_high_peak_power_counts_as_dc()
    {
        var sessions = new List<ChargeSessionSummary> { Session(charger: null, peak: 25000, energyWh: 40000) };
        var display = Project(SuccessModel(sessions: sessions));

        Assert.Equal("0", display.AcDc.Stats[1].Value); // AC
        Assert.Equal("1", display.AcDc.Stats[2].Value); // DC
    }

    [Fact]
    public void Ac_dc_is_empty_without_sessions()
    {
        var display = Project(SuccessModel(sessions: []));
        Assert.False(display.AcDc.HasData);
        Assert.Empty(display.AcDc.PieData);
        Assert.Empty(display.AcDc.Stats);
    }

    // ---- Quick links & recommendations ---------------------------------------------

    [Fact]
    public void Quick_links_expose_six_routes()
    {
        var display = Project(SuccessModel());

        Assert.Equal(6, display.QuickLinks.Count);
        Assert.Equal("/battery-cells", display.QuickLinks[0].Route);
        Assert.Equal("/battery-degradation", display.QuickLinks[1].Route);
        Assert.Equal("/energy-flow", display.QuickLinks[2].Route);
        Assert.Equal("/projected-range", display.QuickLinks[3].Route);
        Assert.Equal("/vampire-drain", display.QuickLinks[4].Route);
        Assert.Equal("/sleep-efficiency", display.QuickLinks[5].Route);
    }

    [Fact]
    public void Recommendations_default_to_the_positive_tip()
    {
        var display = Project(SuccessModel(Health(fast: 10, full: 10, dod: 40, rateYr: 1)));
        Assert.Equal("Your battery health looks great \u2014 keep up the good habits!", Assert.Single(display.Recommendations));
    }

    [Fact]
    public void Recommendations_accumulate_for_stressed_usage()
    {
        var display = Project(SuccessModel(Health(fast: 40, full: 50, dod: 80, rateYr: 4)));

        Assert.Equal(4, display.Recommendations.Count);
        Assert.Contains("Reduce fast charging frequency to slow degradation.", display.Recommendations);
        Assert.Contains("Try to avoid deep discharges below 20%.", display.Recommendations);
    }

    // ---- Section error-boundary titles ---------------------------------------------

    [Fact]
    public void Section_titles_resolve_all_ten_fallbacks()
    {
        var titles = Project(SuccessModel()).SectionTitles;

        Assert.Equal("Health score panel failed to load", titles.Hero);
        Assert.Equal("Metric bars failed to load", titles.MetricBars);
        Assert.Equal("Summary metrics failed to load", titles.SummaryCards);
        Assert.Equal("Thermal monitoring failed to load", titles.Thermal);
        Assert.Equal("Smart insights failed to load", titles.Insights);
        Assert.Equal("Charge level distribution failed to load", titles.ChargeDist);
        Assert.Equal("Capacity & range comparison failed to load", titles.CapacityRange);
        Assert.Equal("AC/DC energy breakdown failed to load", titles.AcDc);
        Assert.Equal("Quick links failed to load", titles.QuickLinks);
        Assert.Equal("Recommendations failed to load", titles.Recommendations);
    }

    // ---- Tolerant JSON parsers -----------------------------------------------------

    [Fact]
    public void Analytics_from_json_returns_null_for_a_non_object()
    {
        Assert.Null(BatteryHealthAnalytics.FromJson(Json("[]")));
        Assert.Null(BatteryHealthAnalytics.FromJson(Json("null")));
    }

    [Fact]
    public void Analytics_from_json_reads_scores_and_history()
    {
        var report = BatteryHealthAnalytics.FromJson(Json(
            "{\"current_soh\":91,\"estimated_capacity\":71.2,\"original_capacity\":78,\"degradation_rate_yr\":2.1," +
            "\"battery_age_months\":24,\"total_cycles\":300,\"fast_charge_pct\":15,\"full_charge_pct\":10," +
            "\"history\":[{\"date\":\"2026-01-01\",\"soh_pct\":91,\"range_km\":470,\"capacity_wh\":71200}]}"));

        Assert.NotNull(report);
        Assert.Equal(91, report!.CurrentSoh);
        Assert.Equal(71.2, report.EstimatedCapacity);
        Assert.Single(report.History);
        Assert.Equal(470, report.History[0].RangeKm);
    }

    [Fact]
    public void Forecast_from_json_reads_prediction_projection_points()
    {
        var forecast = BatteryHealthForecast.FromJson(Json(
            "{\"prediction\":{\"has_enough_data\":true,\"slope_per_year\":-1.2,\"years_to_80_pct\":6.5," +
            "\"predicted_date\":\"2032-01-01\",\"projection_points\":[{\"month\":\"2031-06\",\"health\":82}]}}"));

        Assert.NotNull(forecast.Prediction);
        Assert.True(forecast.Prediction!.HasEnoughData);
        Assert.Equal(6.5, forecast.Prediction.YearsTo80Pct);
        Assert.Equal(82, forecast.Prediction.ProjectionPoints.Single().Health);
    }

    [Fact]
    public void Forecast_from_json_tolerates_a_missing_prediction()
    {
        Assert.Null(BatteryHealthForecast.FromJson(Json("{}")).Prediction);
        Assert.Null(BatteryHealthForecast.FromJson(Json("[]")).Prediction);
    }

    [Fact]
    public void Thermal_from_json_reads_nullable_flags_and_temps()
    {
        var thermal = ChargeThermalLatest.FromJson(Json(
            "{\"bms_fullcharge_complete\":true,\"module_temp_max\":31.5,\"module_temp_min\":19.0," +
            "\"num_module_temp_max\":2,\"battery_heater_on\":false}"));

        Assert.NotNull(thermal);
        Assert.True(thermal!.BmsFullChargeComplete);
        Assert.Equal(31.5, thermal.ModuleTempMax);
        Assert.Equal(2, thermal.NumModuleTempMax);
        Assert.False(thermal.BatteryHeaterOn);
        Assert.Null(thermal.NumModuleTempMin);
    }

    [Fact]
    public void Thermal_from_json_is_null_for_a_non_object()
    {
        Assert.Null(ChargeThermalLatest.FromJson(Json("null")));
    }

    [Fact]
    public void Session_from_json_reads_charger_and_energy()
    {
        var session = ChargeSessionSummary.FromJson(Json(
            "{\"start_soc_pct\":18,\"end_soc_pct\":82,\"charger_type\":\"Tesla\",\"peak_power_w\":120000,\"total_energy_added_wh\":45000}"));

        Assert.Equal(18, session.StartSocPct);
        Assert.Equal(82, session.EndSocPct);
        Assert.Equal("Tesla", session.ChargerType);
        Assert.Equal(45000, session.TotalEnergyAddedWh);
    }

    // ---- View-model lifecycle ------------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_success_from_the_feed()
    {
        var feed = new FakeBatteryHealthFeed(BatteryHealthPageSnapshot.Compose(Health(), Forecast(), [Session()], Thermal()));
        using var vm = new BatteryHealthPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BatteryHealthState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_surfaces_error_when_feed_throws()
    {
        using var vm = new BatteryHealthPageViewModel(new ThrowingBatteryHealthFeed(), Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BatteryHealthState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeBatteryHealthFeed(BatteryHealthPageSnapshot.Compose(Health(), Forecast(), [Session()], Thermal()));
        using var vm = new BatteryHealthPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_reprojects_when_units_change()
    {
        var history = new List<BatteryHealthHistoryPoint> { HistoryPoint(rangeKm: 500), HistoryPoint(rangeKm: 480) };
        var feed = new FakeBatteryHealthFeed(BatteryHealthPageSnapshot.Compose(Health(history: history), Forecast(), [Session()], Thermal()));
        using var vm = new BatteryHealthPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        vm.Units = UnitPref.Imperial;

        Assert.Contains("mi", vm.Display.RangeTrend.Series.Single().Name, StringComparison.Ordinal);
    }

    // ---- Generated-client feed -----------------------------------------------------

    [Fact]
    public async Task ClientFeed_sends_all_four_operations_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"current_soh\":90}"));
        api.ReturnsValue(Json("{\"prediction\":{\"has_enough_data\":true}}"));
        api.ReturnsValue(Json("[{\"start_soc_pct\":20,\"total_energy_added_wh\":1000}]"));
        api.ReturnsValue(Json("{\"module_temp_max\":30}"));
        var feed = new BatteryHealthClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(90, snapshot.Health.CurrentSoh);
        Assert.Single(snapshot.Sessions);
        Assert.NotNull(snapshot.Thermal);
        Assert.Equal(4, api.Requests.Count);
        Assert.Equal("get_api_v1_analytics_battery_health", api.Requests[0].OperationId);
        Assert.Equal("get_api_v1_analytics_battery_degradation", api.Requests[1].OperationId);
        Assert.Equal("get_api_v1_charging_sessions", api.Requests[2].OperationId);
        Assert.Equal("get_api_v1_charging_telemetry_latest", api.Requests[3].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("100", api.Requests[2].Query!["limit"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_health_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new BatteryHealthClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_gracefully_when_supplementary_reads_fail()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"current_soh\":88}"));
        api.Throws(new ApiException("degradation down", 503));
        api.Throws(new ApiException("sessions down", 503));
        api.Throws(new ApiException("telemetry down", 503));
        var feed = new BatteryHealthClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(88, snapshot.Health.CurrentSoh);
        Assert.Null(snapshot.Forecast.Prediction);
        Assert.Empty(snapshot.Sessions);
        Assert.Null(snapshot.Thermal);
    }

    [Fact]
    public async Task ClientFeed_extracts_sessions_from_a_wrapped_object()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"current_soh\":80}"));
        api.ReturnsValue(Json("{}"));
        api.ReturnsValue(Json("{\"sessions\":[{\"start_soc_pct\":12},{\"start_soc_pct\":34}]}"));
        api.ReturnsValue(Json("null"));
        var feed = new BatteryHealthClientFeed(api, vehicleId: 9);

        var snapshot = await feed.FetchAsync(default);

        Assert.Equal(2, snapshot.Sessions.Count);
        Assert.Null(snapshot.Thermal);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryHealthDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryHealthPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("BatteryHealth", BatteryHealthRegistration.RouteName);
        Assert.Equal("get_api_v1_analytics_battery_health", BatteryHealthRegistration.HealthOperation);
        Assert.Equal("get_api_v1_analytics_battery_degradation", BatteryHealthRegistration.DegradationOperation);
        Assert.Equal("get_api_v1_charging_sessions", BatteryHealthRegistration.SessionsOperation);
        Assert.Equal("get_api_v1_charging_telemetry_latest", BatteryHealthRegistration.TelemetryLatestOperation);
        Assert.Equal("Battery Health", BatteryHealthRegistration.Title(Localizer));
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

    private sealed class FakeBatteryHealthFeed(BatteryHealthPageSnapshot snapshot) : IBatteryHealthFeed
    {
        public int FetchCount { get; private set; }

        public Task<BatteryHealthPageSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingBatteryHealthFeed : IBatteryHealthFeed
    {
        public Task<BatteryHealthPageSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
