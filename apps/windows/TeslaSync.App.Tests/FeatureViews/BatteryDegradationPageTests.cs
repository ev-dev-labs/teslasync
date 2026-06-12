using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Battery;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>BatteryDegradationPage</c> surface's Microsoft.UI-free logic — the
/// projection (web/src/features/battery/pages/BatteryDegradationPage.tsx), the tolerant two-source parsers,
/// the four-state matrix (loading / empty / error / success), the SI distance / energy formatting at the
/// display boundary, and the generated-client feed's request shaping (web <c>useBatteryHealthAnalytics</c> +
/// <c>useBatteryDegradation</c>). The WinUI view is exercised by the app build; its per-region visibility is
/// driven entirely by the <see cref="BatteryDegradationDisplay"/> flags asserted here.
/// </summary>
public sealed class BatteryDegradationPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The 60 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "Avg DoD", "Battery Age", "Battery Degradation", "Battery Health", "Battery Health Factors",
        "Capacity", "Charge Habits", "Current Range", "Current SOH", "Cycle Depth", "Date",
        "Degradation History", "Degradation Rate", "Degraded", "Estimated Capacity", "Excellent",
        "Fast Charge", "Full Charge", "Good",
        "Health trends, degradation predictions, and charging habit impact",
        "Lower is better for longevity", "No degradation records found.", "Odometer", "Original Range",
        "Range", "SOH %", "Temperature Exposure",
        "battery.degradation.actualHealth", "battery.degradation.avgDoD", "battery.degradation.chargingImpact",
        "battery.degradation.confidence", "battery.degradation.deepDischarges", "battery.degradation.fastCharges",
        "battery.degradation.inApprox", "battery.degradation.needMore", "battery.degradation.noHistory",
        "battery.degradation.noRange", "battery.degradation.noRecommendations", "battery.degradation.noRiskData",
        "battery.degradation.prediction", "battery.degradation.predictionDesc", "battery.degradation.projected",
        "battery.degradation.rangeLoss", "battery.degradation.rate", "battery.degradation.recommendations",
        "battery.degradation.riskFactors", "battery.degradation.stress", "battery.degradation.stressHigh",
        "battery.degradation.stressLabel", "battery.degradation.stressLow", "battery.degradation.stressMedium",
        "battery.degradation.title", "battery.degradation.totalCycles", "battery.degradation.trendTitle",
        "battery.degradation.trendTitle.aria", "battery.degradation.warranty", "battery.degradation.years",
        "{{count}} months", "{{y}} years", "{{y}}y {{m}}m",
    ];

    private static BatteryHealthSnapshot Snapshot(
        string date = "2026-01-01", double odometerKm = 15000, double soh = 92, double capacityWh = 72000, double rangeKm = 480) =>
        new(date, odometerKm, soh, capacityWh, rangeKm);

    private static BatteryHealthReport SampleHealth(IReadOnlyList<BatteryHealthSnapshot>? history = null) => new(
        CurrentSoh: 92,
        EstimatedCapacity: 72.5,
        OriginalCapacity: 78,
        DegradationRateYr: 2.3,
        BatteryAgeMonths: 30,
        TotalCycles: 342,
        AvgDepthOfDischarge: 45,
        FastChargePct: 18,
        FullChargePct: 12,
        ChargeHabitsScore: 84,
        TempExposureScore: 70,
        History: history ?? [Snapshot()]);

    private static BatteryDegradationReport SampleDegradation(
        string? stress = "Low",
        bool enoughData = true,
        IReadOnlyList<DegradationProjection>? projections = null,
        IReadOnlyList<DegradationRiskFactor>? risks = null,
        IReadOnlyList<string>? recommendations = null,
        ChargingHabits? habits = null) => new(
        StressLevel: stress,
        CurrentCycles: 340,
        Prediction: new DegradationPrediction(enoughData, -1.5, 5.2, "2031-06-01"),
        ChargingHabits: habits ?? new ChargingHabits(20, 80, 4),
        Projections: projections ?? [new DegradationProjection("2031", 80, 75, 85)],
        RiskFactors: risks ?? [new DegradationRiskFactor("fast_charge_ratio", 30, "Moderate", "Frequent DC fast charging")],
        Recommendations: recommendations ?? ["Charge to 80% for daily use."]);

    private static BatteryDegradationModel SuccessModel(
        BatteryHealthReport? health = null, BatteryDegradationReport? degradation = null) =>
        new(BatteryDegradationSnapshot.Compose(health ?? SampleHealth(), degradation ?? SampleDegradation()), false, null);

    private static BatteryDegradationDisplay Project(BatteryDegradationModel model, UnitPref? units = null) =>
        BatteryDegradationProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 60 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = BatteryDegradationProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = BatteryDegradationProjection.Project(BatteryDegradationModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_sixty_unique_keys() =>
        Assert.Equal(60, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(BatteryDegradationModel.Initial);

        Assert.Equal(BatteryDegradationState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_health_object()
    {
        var model = new BatteryDegradationModel(BatteryDegradationSnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(BatteryDegradationState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
    }

    [Fact]
    public void State_error_when_health_query_failed()
    {
        var model = new BatteryDegradationModel(BatteryDegradationSnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(BatteryDegradationState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_health_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(BatteryDegradationState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Summary metrics (Current SOH / Estimated Capacity / Degradation Rate / Battery Age) ----

    [Fact]
    public void Summary_metrics_project_four_cards_with_labels_and_values()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.SummaryMetrics.Count);
        Assert.Equal("Current SOH", display.SummaryMetrics[0].Label);
        Assert.Equal("92.00%", display.SummaryMetrics[0].Value);
        Assert.Equal("Estimated Capacity", display.SummaryMetrics[1].Label);
        Assert.Equal("72.50 kWh", display.SummaryMetrics[1].Value);
        Assert.Equal("Degradation Rate", display.SummaryMetrics[2].Label);
        Assert.Equal("2.30%/yr", display.SummaryMetrics[2].Value);
        Assert.Equal("Battery Age", display.SummaryMetrics[3].Label);
        Assert.Equal("2y 6m", display.SummaryMetrics[3].Value);
    }

    [Theory]
    [InlineData(6, "{{count}} months", "6 months")]
    [InlineData(18, "{{y}}y {{m}}m", "1y 6m")]
    [InlineData(24, "{{y}} years", "2 years")]
    public void Age_label_matches_web_tiers(double months, string _, string expected)
    {
        var s = BatteryStrings.Resolve(Localizer);
        Assert.Equal(expected, BatteryDegradationProjection.AgeLabel(months, s));
    }

    // ---- Health gauge + badge ------------------------------------------------------

    [Theory]
    [InlineData(95, "Excellent", StatusKind.Success)]
    [InlineData(85, "Good", StatusKind.Warning)]
    [InlineData(70, "Degraded", StatusKind.Danger)]
    public void Health_badge_follows_thresholds(double soh, string expectedText, StatusKind expectedStatus)
    {
        var display = Project(SuccessModel(SampleHealth() with { CurrentSoh = soh }));

        Assert.Equal(expectedText, display.HealthBadgeText);
        Assert.Equal(expectedStatus, display.HealthBadgeStatus);
        Assert.Equal(soh, display.GaugeValue);
        Assert.Equal(100, display.GaugeMax);
        Assert.Equal("Battery Health", display.GaugeLabel);
    }

    [Fact]
    public void Gauge_clamps_to_zero_hundred()
    {
        var display = Project(SuccessModel(SampleHealth() with { CurrentSoh = 140 }));
        Assert.Equal(100, display.GaugeValue);
    }

    // ---- Prediction ----------------------------------------------------------------

    [Fact]
    public void Prediction_with_enough_data_projects_text_and_four_metrics()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasEnoughData);
        Assert.Equal("At current rate, battery reaches", display.PredictionLeadText);
        Assert.Equal("80%", display.PredictionThresholdText);
        Assert.Equal("~5.20 years", display.PredictionYearsText);
        Assert.Equal("(2031-06-01)", display.PredictionDateText);

        Assert.Equal(4, display.PredictionMetrics.Count);
        Assert.Equal("Degradation Rate", display.PredictionMetrics[0].Label);
        Assert.Equal("1.50%/yr", display.PredictionMetrics[0].Value);   // abs(slope_per_year)
        Assert.Equal("Stress Level", display.PredictionMetrics[1].Label);
        Assert.Equal("Low", display.PredictionMetrics[1].Value);
        Assert.Equal("Total Cycles", display.PredictionMetrics[2].Label);
        Assert.Equal("342.00", display.PredictionMetrics[2].Value);
        Assert.Equal("Avg Depth of Discharge", display.PredictionMetrics[3].Label);
        Assert.Equal("45.00%", display.PredictionMetrics[3].Value);
    }

    [Fact]
    public void Prediction_without_enough_data_shows_need_more_and_no_metrics()
    {
        var degradation = SampleDegradation(enoughData: false);
        var display = Project(SuccessModel(degradation: degradation));

        Assert.False(display.HasEnoughData);
        Assert.Empty(display.PredictionMetrics);
        Assert.Equal(
            "Need more data points to generate prediction (minimum 3 snapshots required)",
            display.NeedMoreMessage);
    }

    // ---- Health Trend & Projection chart -------------------------------------------

    [Fact]
    public void Trend_chart_builds_confidence_actual_and_projected_series()
    {
        var history = new List<BatteryHealthSnapshot> { Snapshot(date: "2026-01-01", soh: 100) };
        var projections = new List<DegradationProjection> { new("2031", 80, 75, 85) };
        var display = Project(SuccessModel(SampleHealth(history), SampleDegradation(projections: projections)));

        Assert.True(display.Trend.HasData);
        Assert.Equal(80, display.Trend.WarrantyValue);
        Assert.Equal(70, display.Trend.EndOfLifeValue);
        Assert.Equal("Health Trend & Projection", display.Trend.Title);

        var confidence = display.Trend.Series.Single(x => x.Name == "95% Confidence");
        Assert.Equal(BatterySeriesKind.Area, confidence.Kind);
        Assert.Equal(85, confidence.Points.Single().Y);

        var actual = display.Trend.Series.Single(x => x.Name == "Actual Health %");
        // The projected point picks up the last actual value so the segments join.
        Assert.Equal(2, actual.Points.Count);
        Assert.Equal(100, actual.Points[^1].Y);

        var projected = display.Trend.Series.Single(x => x.Name == "Projected %");
        Assert.Equal(80, projected.Points.Single().Y);
    }

    [Fact]
    public void Trend_chart_has_no_data_when_no_history_or_projections()
    {
        var health = SampleHealth(history: []);
        var degradation = SampleDegradation(projections: []);
        var display = Project(SuccessModel(health, degradation));

        Assert.False(display.Trend.HasData);
    }

    // ---- Range Loss chart ----------------------------------------------------------

    [Fact]
    public void Range_chart_builds_original_and_current_series_in_user_units()
    {
        var history = new List<BatteryHealthSnapshot>
        {
            Snapshot(date: "2026-01-01", rangeKm: 500),
            Snapshot(date: "2026-02-01", rangeKm: 470),
        };
        var display = Project(SuccessModel(SampleHealth(history)), UnitPref.Imperial);

        Assert.True(display.Range.HasData);
        var original = display.Range.Series.Single(x => x.Name == "Original Range");
        var current = display.Range.Series.Single(x => x.Name == "Current Range");

        // Original range is the first snapshot's range, converted to the user's unit (miles here).
        double expectedOriginal = UnitConverters.DistanceFromSi(500 * 1000.0, DistanceUnit.Mi);
        double expectedCurrentSecond = UnitConverters.DistanceFromSi(470 * 1000.0, DistanceUnit.Mi);
        Assert.Equal(expectedOriginal, original.Points[0].Y, 3);
        Assert.Equal(expectedOriginal, original.Points[1].Y, 3);
        Assert.Equal(expectedCurrentSecond, current.Points[1].Y, 3);
    }

    [Fact]
    public void Range_chart_is_empty_with_message_when_no_history()
    {
        var display = Project(SuccessModel(SampleHealth(history: [])));

        Assert.False(display.Range.HasData);
        Assert.Equal("Range data will appear once history is available.", display.Range.EmptyMessage);
    }

    // ---- Risk factors --------------------------------------------------------------

    [Fact]
    public void Risk_factors_project_scored_cards()
    {
        var risks = new List<DegradationRiskFactor>
        {
            new("temperature_exposure", 60, "High", "Sustained heat exposure"),
        };
        var display = Project(SuccessModel(degradation: SampleDegradation(risks: risks)));

        var risk = Assert.Single(display.RiskFactors);
        Assert.Equal("temperature_exposure", risk.Id);
        Assert.Equal("60", risk.ScoreText);
        Assert.Equal(0.6, risk.ScoreFraction, 3);
        Assert.Equal(StatusKind.Danger, risk.BarStatus);   // score 60 > 50
        Assert.Equal("High", risk.BadgeText);
        Assert.Equal("Sustained heat exposure", risk.Detail);
    }

    [Fact]
    public void Risk_factors_empty_message_when_none()
    {
        var display = Project(SuccessModel(degradation: SampleDegradation(risks: [])));

        Assert.Empty(display.RiskFactors);
        Assert.Equal("Risk data will appear once charging history is available.", display.RiskEmptyMessage);
    }

    // ---- Recommendations -----------------------------------------------------------

    [Fact]
    public void Recommendations_project_the_list()
    {
        var display = Project(SuccessModel(degradation: SampleDegradation(recommendations: ["A", "B"])));
        Assert.Equal(["A", "B"], display.Recommendations);
    }

    [Fact]
    public void Recommendations_empty_message_when_none()
    {
        var display = Project(SuccessModel(degradation: SampleDegradation(recommendations: [])));

        Assert.Empty(display.Recommendations);
        Assert.Equal("Recommendations will appear based on your usage patterns.", display.RecommendationsEmptyMessage);
    }

    // ---- Charging habits impact ----------------------------------------------------

    [Theory]
    [InlineData("Low", CalloutVariantKind.Success)]
    [InlineData("Medium", CalloutVariantKind.Warning)]
    [InlineData("High", CalloutVariantKind.Danger)]
    public void Charging_impact_variant_follows_stress(string stress, CalloutVariantKind expected)
    {
        var display = Project(SuccessModel(degradation: SampleDegradation(stress: stress)));
        Assert.Equal(expected, display.ImpactVariant);
    }

    [Fact]
    public void Charging_impact_title_summarizes_habits()
    {
        var habits = new ChargingHabits(FastChargeCount: 30, SlowChargeCount: 70, DeepDischargeCount: 5);
        var display = Project(SuccessModel(degradation: SampleDegradation(stress: "Medium", habits: habits)));

        // 30 / (30+70) = 30% fast charges; 5 deep discharges; Medium stress.
        Assert.Equal("30% fast charges, 5 deep discharges \u2014 Medium stress", display.ImpactBannerTitle);
        Assert.Equal(
            "Consider reducing fast charging frequency and avoiding full charges when possible.",
            display.ImpactBannerBody);
    }

    // ---- Battery health factors ----------------------------------------------------

    [Fact]
    public void Factor_cards_project_three_scored_cards()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.FactorCards.Count);
        Assert.Equal("Charge Habits", display.FactorCards[0].Title);
        Assert.Equal("84.00/100", display.FactorCards[0].ScoreText);
        Assert.Equal(StatusKind.Success, display.FactorCards[0].ScoreStatus);
        Assert.Collection(
            display.FactorCards[0].Rows,
            r => Assert.Equal(("Fast Charge", "18.00%"), (r.Label, r.Value)),
            r => Assert.Equal(("Full Charge", "12.00%"), (r.Label, r.Value)));

        Assert.Equal("Temperature Exposure", display.FactorCards[1].Title);
        Assert.Equal("Lower is better for longevity", display.FactorCards[1].FooterText);

        Assert.Equal("Cycle Depth", display.FactorCards[2].Title);
        // cycleDepthScore = max(0, round(100 - 45)) = 55 -> warning.
        Assert.Equal("55.00/100", display.FactorCards[2].ScoreText);
        Assert.Equal(StatusKind.Warning, display.FactorCards[2].ScoreStatus);
    }

    // ---- Degradation history table -------------------------------------------------

    [Fact]
    public void History_table_has_five_columns()
    {
        var display = Project(SuccessModel());

        Assert.Collection(
            display.HistoryColumns,
            c => AssertColumn(c, "date", "Date", numeric: false),
            c => AssertColumn(c, "odometer", "Odometer", numeric: true),
            c => AssertColumn(c, "soh", "SOH %", numeric: true),
            c => AssertColumn(c, "capacity", "Capacity", numeric: true),
            c => AssertColumn(c, "range", "Range", numeric: true));
    }

    [Fact]
    public void History_rows_format_distance_and_energy_at_the_display_boundary()
    {
        var history = new List<BatteryHealthSnapshot> { Snapshot(date: "2026-03-15", odometerKm: 15000, soh: 92, capacityWh: 72000, rangeKm: 480) };
        var display = Project(SuccessModel(SampleHealth(history)), UnitPref.Imperial);

        var row = Assert.Single(display.HistoryRows);
        Assert.Equal(UnitFormatters.FormatDistance(15000 * 1000.0, UnitPref.Imperial, 2), row.Odometer);
        Assert.Equal(UnitFormatters.FormatEnergy(72000, UnitPref.Imperial, 1), row.Capacity);
        Assert.Equal(UnitFormatters.FormatDistance(480 * 1000.0, UnitPref.Imperial, 2), row.Range);
        Assert.Equal("92.00%", row.Soh);
        Assert.Equal(StatusKind.Success, row.SohStatus);
        Assert.Equal(DateTimeFormatting.Format(
            DateTimeOffset.Parse("2026-03-15", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            DateTimeVariant.Date,
            Now), row.Date);
    }

    [Fact]
    public void History_empty_message_when_no_records()
    {
        var display = Project(SuccessModel(SampleHealth(history: [])));

        Assert.Empty(display.HistoryRows);
        Assert.Equal("No degradation records found.", display.HistoryEmptyMessage);
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Health_report_parses_scores_and_history()
    {
        using var doc = JsonDocument.Parse(
            "{\"current_soh\":91.5,\"estimated_capacity\":72,\"degradation_rate_yr\":2.1,\"battery_age_months\":30," +
            "\"total_cycles\":300,\"avg_depth_of_discharge\":40,\"fast_charge_pct\":15,\"full_charge_pct\":10," +
            "\"charge_habits_score\":80,\"temp_exposure_score\":65," +
            "\"history\":[{\"date\":\"2026-01-01\",\"odometer\":12000,\"soh_pct\":91.5,\"capacity_wh\":72000,\"range_km\":470}]}");

        var report = BatteryHealthReport.FromJson(doc.RootElement);

        Assert.NotNull(report);
        Assert.Equal(91.5, report!.CurrentSoh);
        var snapshot = Assert.Single(report.History);
        Assert.Equal("2026-01-01", snapshot.Date);
        Assert.Equal(12000, snapshot.OdometerKm);
        Assert.Equal(470, snapshot.RangeKm);
    }

    [Fact]
    public void Health_report_is_null_for_a_non_object_body() =>
        Assert.Null(BatteryHealthReport.FromJson(JsonDocument.Parse("null").RootElement));

    [Fact]
    public void Degradation_report_parses_prediction_risks_recommendations_and_habits()
    {
        using var doc = JsonDocument.Parse(
            "{\"stress_level\":\"High\",\"current_cycles\":350," +
            "\"prediction\":{\"has_enough_data\":true,\"slope_per_year\":-2.0,\"years_to_80_pct\":4.5,\"predicted_date\":\"2030-01-01\"}," +
            "\"charging_habits\":{\"fast_charge_count\":40,\"slow_charge_count\":60,\"deep_discharge_count\":7}," +
            "\"projections\":[{\"date\":\"2030\",\"health_pct\":80,\"confidence_low\":76,\"confidence_high\":84}]," +
            "\"risk_factors\":[{\"name\":\"cycle_count_rate\",\"score\":55,\"label\":\"Elevated\",\"detail\":\"High cycling\"}]," +
            "\"recommendations\":[\"Avoid deep discharges.\"]}");

        var report = BatteryDegradationReport.FromJson(doc.RootElement);

        Assert.Equal("High", report.StressLevel);
        Assert.True(report.Prediction!.HasEnoughData);
        Assert.Equal(4.5, report.Prediction.YearsTo80Pct);
        Assert.Equal(40, report.ChargingHabits!.FastChargeCount);
        Assert.Equal(7, report.ChargingHabits.DeepDischargeCount);
        Assert.Equal(80, Assert.Single(report.Projections).HealthPct);
        Assert.Equal("Elevated", Assert.Single(report.RiskFactors).Label);
        Assert.Equal("Avoid deep discharges.", Assert.Single(report.Recommendations));
    }

    [Fact]
    public void Degradation_report_is_tolerant_of_a_non_object_body() =>
        Assert.Equal(BatteryDegradationReport.Empty, BatteryDegradationReport.FromJson(JsonDocument.Parse("42").RootElement));

    [Fact]
    public void Snapshot_compose_treats_null_health_as_no_data()
    {
        var snapshot = BatteryDegradationSnapshot.Compose(null, SampleDegradation());
        Assert.False(snapshot.HasData);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_health_into_the_success_state()
    {
        var feed = new FakeBatteryFeed(BatteryDegradationSnapshot.Compose(SampleHealth(), SampleDegradation()));
        using var vm = new BatteryDegradationPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new BatteryDegradationPageViewModel(EmptyBatteryDegradationFeed.Instance, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new BatteryDegradationPageViewModel(new ThrowingBatteryFeed(), Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BatteryDegradationState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeBatteryFeed(BatteryDegradationSnapshot.Compose(SampleHealth(), SampleDegradation()));
        using var vm = new BatteryDegradationPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useBatteryHealthAnalytics + useBatteryDegradation) ----

    [Fact]
    public async Task ClientFeed_sends_both_operations_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"current_soh\":90}"));
        api.ReturnsValue(Json("{\"stress_level\":\"Low\"}"));
        var feed = new BatteryDegradationClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(90, snapshot.Health.CurrentSoh);
        Assert.Equal("Low", snapshot.Degradation.StressLevel);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_analytics_battery_health", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("get_api_v1_analytics_battery_degradation", api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_health_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new BatteryDegradationClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_gracefully_when_only_degradation_fails()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"current_soh\":88}"));
        api.Throws(new ApiException("degradation subsystem down", 503));
        var feed = new BatteryDegradationClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(88, snapshot.Health.CurrentSoh);
        Assert.Equal(BatteryDegradationReport.Empty, snapshot.Degradation);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryDegradationDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryDegradationPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("BatteryDegradation", BatteryDegradationRegistration.RouteName);
        Assert.Equal("get_api_v1_analytics_battery_health", BatteryDegradationRegistration.HealthOperation);
        Assert.Equal("get_api_v1_analytics_battery_degradation", BatteryDegradationRegistration.DegradationOperation);
        Assert.Equal("Battery Degradation", BatteryDegradationRegistration.Title(Localizer));
    }

    private static void AssertColumn(HistoryColumnDisplay column, string key, string header, bool numeric)
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

    private sealed class FakeBatteryFeed(BatteryDegradationSnapshot snapshot) : IBatteryDegradationFeed
    {
        public int FetchCount { get; private set; }

        public Task<BatteryDegradationSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingBatteryFeed : IBatteryDegradationFeed
    {
        public Task<BatteryDegradationSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
