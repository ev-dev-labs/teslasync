using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// One battery-health snapshot row from <c>GET /analytics/battery-health</c> (web <c>BatteryHealthSnapshot</c>
/// in web/src/types/energy.ts) — the degradation-history table source. <see cref="OdometerKm"/> and
/// <see cref="RangeKm"/> are derived SI in kilometres (the web converts them at the display boundary), and
/// <see cref="CapacityWh"/> is SI watt-hours. Parsing is null-tolerant so a partial row never throws.
/// </summary>
public sealed record BatteryHealthSnapshot(
    string Date,
    double OdometerKm,
    double SohPct,
    double CapacityWh,
    double RangeKm)
{
    /// <summary>Project a single history JSON object into a tolerant snapshot.</summary>
    public static BatteryHealthSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new BatteryHealthSnapshot(string.Empty, 0, 0, 0, 0);
        }

        return new BatteryHealthSnapshot(
            Date: BatteryJson.String(element, "date") ?? string.Empty,
            OdometerKm: BatteryJson.Double(element, "odometer") ?? 0,
            SohPct: BatteryJson.Double(element, "soh_pct") ?? 0,
            CapacityWh: BatteryJson.Double(element, "capacity_wh") ?? 0,
            RangeKm: BatteryJson.Double(element, "range_km") ?? 0);
    }
}

/// <summary>
/// The battery-health analytics slice the page reads from <c>GET /analytics/battery-health</c> — the native
/// mirror of the web <c>BatteryHealthAnalytics</c> (web/src/types/energy.ts) including the overview scores and
/// the degradation-history series. Every score / percentage is already dimensionless; the history odometer /
/// range are SI km converted at the render boundary and the capacity is SI Wh. A <see langword="null"/> parse
/// result models the web query returning no object (<c>data</c> undefined → the empty surface).
/// </summary>
public sealed record BatteryHealthReport(
    double CurrentSoh,
    double EstimatedCapacity,
    double OriginalCapacity,
    double DegradationRateYr,
    double BatteryAgeMonths,
    double TotalCycles,
    double AvgDepthOfDischarge,
    double FastChargePct,
    double FullChargePct,
    double ChargeHabitsScore,
    double TempExposureScore,
    IReadOnlyList<BatteryHealthSnapshot> History)
{
    /// <summary>An all-zero report with no history — the projection seed before any data resolves.</summary>
    public static BatteryHealthReport Empty { get; } =
        new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Array.Empty<BatteryHealthSnapshot>());

    /// <summary>
    /// Project a <c>GET /analytics/battery-health</c> response into the report. Mirrors the web
    /// <c>hasData = !!data</c> gate: only a non-object body returns <see langword="null"/> (the empty surface);
    /// any object yields a report with missing fields defaulting to 0 (the web <c>?? 0</c> reads).
    /// </summary>
    public static BatteryHealthReport? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new BatteryHealthReport(
            CurrentSoh: BatteryJson.Double(root, "current_soh") ?? 0,
            EstimatedCapacity: BatteryJson.Double(root, "estimated_capacity") ?? 0,
            OriginalCapacity: BatteryJson.Double(root, "original_capacity") ?? 0,
            DegradationRateYr: BatteryJson.Double(root, "degradation_rate_yr") ?? 0,
            BatteryAgeMonths: BatteryJson.Double(root, "battery_age_months") ?? 0,
            TotalCycles: BatteryJson.Double(root, "total_cycles") ?? 0,
            AvgDepthOfDischarge: BatteryJson.Double(root, "avg_depth_of_discharge") ?? 0,
            FastChargePct: BatteryJson.Double(root, "fast_charge_pct") ?? 0,
            FullChargePct: BatteryJson.Double(root, "full_charge_pct") ?? 0,
            ChargeHabitsScore: BatteryJson.Double(root, "charge_habits_score") ?? 0,
            TempExposureScore: BatteryJson.Double(root, "temp_exposure_score") ?? 0,
            History: BatteryJson.Array(root, "history", BatteryHealthSnapshot.FromJson));
    }
}

/// <summary>One predictive projection point (web <c>PredictiveProjection</c>): future health with a band.</summary>
public sealed record DegradationProjection(string Date, double HealthPct, double ConfidenceLow, double ConfidenceHigh)
{
    /// <summary>Project a single projection JSON object into a tolerant point.</summary>
    public static DegradationProjection FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new DegradationProjection(string.Empty, 0, 0, 0);
        }

        return new DegradationProjection(
            Date: BatteryJson.String(element, "date") ?? string.Empty,
            HealthPct: BatteryJson.Double(element, "health_pct") ?? 0,
            ConfidenceLow: BatteryJson.Double(element, "confidence_low") ?? 0,
            ConfidenceHigh: BatteryJson.Double(element, "confidence_high") ?? 0);
    }
}

/// <summary>One scored degradation risk factor (web <c>RiskFactorData</c>): name, severity, label, detail.</summary>
public sealed record DegradationRiskFactor(string Name, double Score, string? Label, string? Detail)
{
    /// <summary>Project a single risk-factor JSON object into a tolerant record.</summary>
    public static DegradationRiskFactor FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new DegradationRiskFactor(string.Empty, 0, null, null);
        }

        return new DegradationRiskFactor(
            Name: BatteryJson.String(element, "name") ?? string.Empty,
            Score: BatteryJson.Double(element, "score") ?? 0,
            Label: BatteryJson.String(element, "label"),
            Detail: BatteryJson.String(element, "detail"));
    }
}

/// <summary>The linear-fit prediction block (web <c>DegradationPrediction</c>).</summary>
public sealed record DegradationPrediction(
    bool HasEnoughData,
    double SlopePerYear,
    double YearsTo80Pct,
    string? PredictedDate)
{
    /// <summary>Project the <c>prediction</c> object, or <see langword="null"/> when absent / non-object.</summary>
    public static DegradationPrediction? FromJson(JsonElement root)
    {
        if (!root.TryGetProperty("prediction", out var p) || p.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new DegradationPrediction(
            HasEnoughData: BatteryJson.Bool(p, "has_enough_data"),
            SlopePerYear: BatteryJson.Double(p, "slope_per_year") ?? 0,
            YearsTo80Pct: BatteryJson.Double(p, "years_to_80_pct") ?? 0,
            PredictedDate: BatteryJson.String(p, "predicted_date"));
    }
}

/// <summary>The charging-habit counters (web <c>ChargingHabits</c>) used by the impact banner.</summary>
public sealed record ChargingHabits(long FastChargeCount, long SlowChargeCount, long DeepDischargeCount)
{
    /// <summary>Project the <c>charging_habits</c> object, or <see langword="null"/> when absent.</summary>
    public static ChargingHabits? FromJson(JsonElement root)
    {
        if (!root.TryGetProperty("charging_habits", out var h) || h.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ChargingHabits(
            FastChargeCount: (long)(BatteryJson.Double(h, "fast_charge_count") ?? 0),
            SlowChargeCount: (long)(BatteryJson.Double(h, "slow_charge_count") ?? 0),
            DeepDischargeCount: (long)(BatteryJson.Double(h, "deep_discharge_count") ?? 0));
    }
}

/// <summary>
/// The battery-degradation slice the page reads from <c>GET /analytics/battery-degradation</c> — the native
/// mirror of the web <c>DegradationData</c> fields the page consumes: the stress level, the lifetime cycle
/// count, the linear-fit prediction, the predictive projections (with confidence band), the scored risk
/// factors, the textual recommendations and the charging-habit counters. Best-effort supplementary data; a
/// non-object body yields <see cref="Empty"/> rather than throwing.
/// </summary>
public sealed record BatteryDegradationReport(
    string? StressLevel,
    double CurrentCycles,
    DegradationPrediction? Prediction,
    ChargingHabits? ChargingHabits,
    IReadOnlyList<DegradationProjection> Projections,
    IReadOnlyList<DegradationRiskFactor> RiskFactors,
    IReadOnlyList<string> Recommendations)
{
    /// <summary>A data-free report — the parse fallback for an absent / non-object body.</summary>
    public static BatteryDegradationReport Empty { get; } = new(
        null, 0, null, null,
        Array.Empty<DegradationProjection>(),
        Array.Empty<DegradationRiskFactor>(),
        Array.Empty<string>());

    /// <summary>Project a <c>GET /analytics/battery-degradation</c> JSON body into a tolerant report.</summary>
    public static BatteryDegradationReport FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new BatteryDegradationReport(
            StressLevel: BatteryJson.String(root, "stress_level"),
            CurrentCycles: BatteryJson.Double(root, "current_cycles") ?? 0,
            Prediction: DegradationPrediction.FromJson(root),
            ChargingHabits: ChargingHabits.FromJson(root),
            Projections: BatteryJson.Array(root, "projections", DegradationProjection.FromJson),
            RiskFactors: BatteryJson.Array(root, "risk_factors", DegradationRiskFactor.FromJson),
            Recommendations: BatteryJson.StringArray(root, "recommendations"));
    }
}

/// <summary>
/// The combined two-source read backing the page — the native analogue of the web page's
/// <c>useBatteryHealthAnalytics</c> (primary; drives the page loading / error / empty state) plus the
/// best-effort <c>useBatteryDegradation</c> (the prediction / risk / projection sections). <see cref="HasData"/>
/// mirrors the web <c>!!data</c> gate on the health query — false collapses the page to the empty surface.
/// </summary>
public sealed record BatteryDegradationSnapshot(
    bool HasData,
    BatteryHealthReport Health,
    BatteryDegradationReport Degradation)
{
    /// <summary>The empty snapshot (no health object) — the page-level empty surface.</summary>
    public static BatteryDegradationSnapshot Empty { get; } =
        new(false, BatteryHealthReport.Empty, BatteryDegradationReport.Empty);

    /// <summary>Compose a snapshot from the parsed health report (may be null) and the degradation report.</summary>
    public static BatteryDegradationSnapshot Compose(BatteryHealthReport? health, BatteryDegradationReport degradation) =>
        health is { } h
            ? new BatteryDegradationSnapshot(true, h, degradation)
            : new BatteryDegradationSnapshot(false, BatteryHealthReport.Empty, degradation);
}

/// <summary>The two-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IBatteryDegradationFeed
{
    /// <summary>Fetch the battery-health analytics + degradation reports for the active vehicle.</summary>
    Task<BatteryDegradationSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyBatteryDegradationFeed : IBatteryDegradationFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyBatteryDegradationFeed Instance { get; } = new();

    private EmptyBatteryDegradationFeed()
    {
    }

    /// <inheritdoc />
    public Task<BatteryDegradationSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(BatteryDegradationSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum BatteryDegradationState
{
    /// <summary>The primary health query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no battery-health object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The primary health query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The health report resolved — every section renders (each with its own empty fallback).</summary>
    Success,
}

/// <summary>One projected summary / prediction metric tile (web <c>MetricCard</c>): label + value + accent.</summary>
public sealed record BatteryMetricDisplay(
    string Label,
    string Value,
    string Glyph,
    string AccentBrushKey,
    string AutomationName);

/// <summary>One projected scored risk factor (web risk-factor card): icon, label, score bar, badge, detail.</summary>
public sealed record RiskFactorDisplay(
    string Id,
    string Glyph,
    string Label,
    string ScoreText,
    double ScoreFraction,
    StatusKind BarStatus,
    string BadgeText,
    StatusKind BadgeStatus,
    string Detail,
    string AutomationName);

/// <summary>One label/value row inside a battery-health-factor sub-card.</summary>
public sealed record BatteryFactorRow(string Label, string Value);

/// <summary>One battery-health-factor sub-card (Charge Habits / Temperature Exposure / Cycle Depth).</summary>
public sealed record BatteryFactorCard(
    string Title,
    string ScoreText,
    StatusKind ScoreStatus,
    string? FooterText,
    IReadOnlyList<BatteryFactorRow> Rows);

/// <summary>A degradation-history table column descriptor.</summary>
public sealed record HistoryColumnDisplay(string Key, string Header, bool IsNumeric);

/// <summary>One projected degradation-history table row (every cell pre-formatted at the render boundary).</summary>
public sealed record HistoryRowDisplay(
    string Id,
    string Date,
    string Odometer,
    string Soh,
    StatusKind SohStatus,
    string Capacity,
    string Range);

/// <summary>The draw kind for a projected trend / range chart series.</summary>
public enum BatterySeriesKind
{
    /// <summary>A connected line series.</summary>
    Line,

    /// <summary>A filled area series.</summary>
    Area,
}

/// <summary>One projected chart series (UI-free points + a draw kind + palette index).</summary>
public sealed record BatterySeriesDisplay(
    string Name,
    BatterySeriesKind Kind,
    int ColorIndex,
    IReadOnlyList<ChartPoint> Points);

/// <summary>
/// The projected Health-Trend &amp; Projection composed chart (web <c>ComposedChart</c>): the confidence band,
/// the actual-health line and the projected line, plus the two reference thresholds (80% warranty, 70% EOL).
/// </summary>
public sealed record TrendChartDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    IReadOnlyList<BatterySeriesDisplay> Series,
    double WarrantyValue,
    string WarrantyLabel,
    double EndOfLifeValue);

/// <summary>The projected Range-Loss area chart (web <c>AreaChart</c>): original vs current range over time.</summary>
public sealed record RangeChartDisplay(
    bool HasData,
    string Title,
    IReadOnlyList<BatterySeriesDisplay> Series,
    string EmptyMessage);

/// <summary>
/// The fully projected, render-ready view of the page for one snapshot — the native analogue of everything the
/// web <c>BatteryDegradationPage</c> computes before returning JSX. Pure data so every branch is asserted
/// headlessly; the view binds to it and selects exactly one top-level body via the <c>Show*</c> flags.
/// </summary>
public sealed record BatteryDegradationDisplay(
    BatteryDegradationState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyTitle,
    string EmptyMessage,
    IReadOnlyList<BatteryMetricDisplay> SummaryMetrics,
    double GaugeValue,
    double GaugeMax,
    string GaugeLabel,
    string GaugeUnit,
    int GaugeColorIndex,
    string HealthBadgeText,
    StatusKind HealthBadgeStatus,
    string PredictionTitle,
    bool HasEnoughData,
    string PredictionLeadText,
    string PredictionThresholdText,
    string PredictionInApproxText,
    string PredictionYearsText,
    string PredictionDateText,
    string NeedMoreMessage,
    IReadOnlyList<BatteryMetricDisplay> PredictionMetrics,
    TrendChartDisplay Trend,
    RangeChartDisplay Range,
    string RiskTitle,
    IReadOnlyList<RiskFactorDisplay> RiskFactors,
    string RiskEmptyMessage,
    string RecommendationsTitle,
    IReadOnlyList<string> Recommendations,
    string RecommendationsEmptyMessage,
    string ChargingImpactTitle,
    CalloutVariantKind ImpactVariant,
    string ImpactBannerTitle,
    string ImpactBannerBody,
    string FactorsTitle,
    IReadOnlyList<BatteryFactorCard> FactorCards,
    string HistoryTitle,
    IReadOnlyList<HistoryColumnDisplay> HistoryColumns,
    IReadOnlyList<HistoryRowDisplay> HistoryRows,
    string HistoryEmptyMessage,
    string AutomationName);

/// <summary>The semantic banner variant for the charging-habits impact callout (web AlertBanner variant).</summary>
public enum CalloutVariantKind
{
    /// <summary>Low stress — success styling.</summary>
    Success,

    /// <summary>Medium stress — warning styling.</summary>
    Warning,

    /// <summary>High / unknown stress — danger styling.</summary>
    Danger,
}

/// <summary>
/// The render-time input the projection consumes — the parsed two-source <see cref="Snapshot"/> plus the
/// page lifecycle (the primary health query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The
/// view-model fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record BatteryDegradationModel(BatteryDegradationSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary health query is in flight with no data yet.</summary>
    public static BatteryDegradationModel Initial { get; } = new(BatteryDegradationSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web
/// <c>BatteryDegradationPage</c> feeds into <c>t(...)</c>, resolved once through the i18n facade so the
/// projection stays readable and the string-coverage test can assert all of them in one pass.
/// </summary>
public sealed record BatteryStrings
{
    public required string Title { get; init; }
    public required string TitleKey { get; init; }
    public required string Subtitle { get; init; }
    public required string CurrentSoh { get; init; }
    public required string EstimatedCapacity { get; init; }
    public required string DegradationRate { get; init; }
    public required string BatteryAge { get; init; }
    public required string BatteryHealth { get; init; }
    public required string Excellent { get; init; }
    public required string Good { get; init; }
    public required string Degraded { get; init; }
    public required string Prediction { get; init; }
    public required string PredictionDesc { get; init; }
    public required string InApprox { get; init; }
    public required string Years { get; init; }
    public required string Rate { get; init; }
    public required string Stress { get; init; }
    public required string TotalCycles { get; init; }
    public required string AvgDoD { get; init; }
    public required string AvgDoDShort { get; init; }
    public required string NeedMore { get; init; }
    public required string TrendTitle { get; init; }
    public required string TrendAria { get; init; }
    public required string Warranty { get; init; }
    public required string Confidence { get; init; }
    public required string ActualHealth { get; init; }
    public required string Projected { get; init; }
    public required string RangeLoss { get; init; }
    public required string OriginalRange { get; init; }
    public required string CurrentRange { get; init; }
    public required string NoRange { get; init; }
    public required string RiskFactors { get; init; }
    public required string NoRiskData { get; init; }
    public required string Recommendations { get; init; }
    public required string NoRecommendations { get; init; }
    public required string ChargingImpact { get; init; }
    public required string FastCharges { get; init; }
    public required string DeepDischarges { get; init; }
    public required string StressLabel { get; init; }
    public required string StressLow { get; init; }
    public required string StressMedium { get; init; }
    public required string StressHigh { get; init; }
    public required string FactorsTitle { get; init; }
    public required string ChargeHabits { get; init; }
    public required string FastCharge { get; init; }
    public required string FullCharge { get; init; }
    public required string TemperatureExposure { get; init; }
    public required string LowerIsBetter { get; init; }
    public required string CycleDepth { get; init; }
    public required string HistoryTitle { get; init; }
    public required string Date { get; init; }
    public required string Odometer { get; init; }
    public required string SohHeader { get; init; }
    public required string Capacity { get; init; }
    public required string Range { get; init; }
    public required string NoRecordsFound { get; init; }
    public required string NoHistory { get; init; }
    public required string CountMonths { get; init; }
    public required string YearsTemplate { get; init; }
    public required string YearsMonths { get; init; }
    public required string Unknown { get; init; }
    public required string EmptyMessage { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every label through <paramref name="localizer"/> using the same keys the web page uses.</summary>
    public static BatteryStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new BatteryStrings
        {
            Title = localizer.GetString("Battery Degradation", "Battery Degradation"),
            TitleKey = localizer.GetString("battery.degradation.title", "Battery Degradation"),
            Subtitle = localizer.GetString(
                "Health trends, degradation predictions, and charging habit impact",
                "Health trends, degradation predictions, and charging habit impact"),
            CurrentSoh = localizer.GetString("Current SOH", "Current SOH"),
            EstimatedCapacity = localizer.GetString("Estimated Capacity", "Estimated Capacity"),
            DegradationRate = localizer.GetString("Degradation Rate", "Degradation Rate"),
            BatteryAge = localizer.GetString("Battery Age", "Battery Age"),
            BatteryHealth = localizer.GetString("Battery Health", "Battery Health"),
            Excellent = localizer.GetString("Excellent", "Excellent"),
            Good = localizer.GetString("Good", "Good"),
            Degraded = localizer.GetString("Degraded", "Degraded"),
            Prediction = localizer.GetString("battery.degradation.prediction", "Prediction"),
            PredictionDesc = localizer.GetString("battery.degradation.predictionDesc", "At current rate, battery reaches"),
            InApprox = localizer.GetString("battery.degradation.inApprox", "in approximately"),
            Years = localizer.GetString("battery.degradation.years", "years"),
            Rate = localizer.GetString("battery.degradation.rate", "Degradation Rate"),
            Stress = localizer.GetString("battery.degradation.stress", "Stress Level"),
            TotalCycles = localizer.GetString("battery.degradation.totalCycles", "Total Cycles"),
            AvgDoD = localizer.GetString("battery.degradation.avgDoD", "Avg Depth of Discharge"),
            AvgDoDShort = localizer.GetString("Avg DoD", "Avg DoD"),
            NeedMore = localizer.GetString(
                "battery.degradation.needMore",
                "Need more data points to generate prediction (minimum 3 snapshots required)"),
            TrendTitle = localizer.GetString("battery.degradation.trendTitle", "Health Trend & Projection"),
            TrendAria = localizer.GetString(
                "battery.degradation.trendTitle.aria",
                "Battery health trend and 95% confidence projection chart"),
            Warranty = localizer.GetString("battery.degradation.warranty", "80% Warranty"),
            Confidence = localizer.GetString("battery.degradation.confidence", "95% Confidence"),
            ActualHealth = localizer.GetString("battery.degradation.actualHealth", "Actual Health %"),
            Projected = localizer.GetString("battery.degradation.projected", "Projected %"),
            RangeLoss = localizer.GetString("battery.degradation.rangeLoss", "Range Loss Over Time"),
            OriginalRange = localizer.GetString("Original Range", "Original Range"),
            CurrentRange = localizer.GetString("Current Range", "Current Range"),
            NoRange = localizer.GetString("battery.degradation.noRange", "Range data will appear once history is available."),
            RiskFactors = localizer.GetString("battery.degradation.riskFactors", "Risk Factors"),
            NoRiskData = localizer.GetString(
                "battery.degradation.noRiskData", "Risk data will appear once charging history is available."),
            Recommendations = localizer.GetString("battery.degradation.recommendations", "Recommendations"),
            NoRecommendations = localizer.GetString(
                "battery.degradation.noRecommendations", "Recommendations will appear based on your usage patterns."),
            ChargingImpact = localizer.GetString("battery.degradation.chargingImpact", "Charging Habits Impact"),
            FastCharges = localizer.GetString("battery.degradation.fastCharges", "fast charges"),
            DeepDischarges = localizer.GetString("battery.degradation.deepDischarges", "deep discharges"),
            StressLabel = localizer.GetString("battery.degradation.stressLabel", "stress"),
            StressLow = localizer.GetString(
                "battery.degradation.stressLow", "Your charging habits are optimal for battery longevity."),
            StressMedium = localizer.GetString(
                "battery.degradation.stressMedium",
                "Consider reducing fast charging frequency and avoiding full charges when possible."),
            StressHigh = localizer.GetString(
                "battery.degradation.stressHigh",
                "High stress detected. Reducing fast charges and deep discharges can improve battery lifespan."),
            FactorsTitle = localizer.GetString("Battery Health Factors", "Battery Health Factors"),
            ChargeHabits = localizer.GetString("Charge Habits", "Charge Habits"),
            FastCharge = localizer.GetString("Fast Charge", "Fast Charge"),
            FullCharge = localizer.GetString("Full Charge", "Full Charge"),
            TemperatureExposure = localizer.GetString("Temperature Exposure", "Temperature Exposure"),
            LowerIsBetter = localizer.GetString("Lower is better for longevity", "Lower is better for longevity"),
            CycleDepth = localizer.GetString("Cycle Depth", "Cycle Depth"),
            HistoryTitle = localizer.GetString("Degradation History", "Degradation History"),
            Date = localizer.GetString("Date", "Date"),
            Odometer = localizer.GetString("Odometer", "Odometer"),
            SohHeader = localizer.GetString("SOH %", "SOH %"),
            Capacity = localizer.GetString("Capacity", "Capacity"),
            Range = localizer.GetString("Range", "Range"),
            NoRecordsFound = localizer.GetString("No degradation records found.", "No degradation records found."),
            NoHistory = localizer.GetString("battery.degradation.noHistory", "No degradation records found."),
            CountMonths = localizer.GetString("{{count}} months", "{{count}} months"),
            YearsTemplate = localizer.GetString("{{y}} years", "{{y}} years"),
            YearsMonths = localizer.GetString("{{y}}y {{m}}m", "{{y}}y {{m}}m"),
            Unknown = localizer.GetString("Unknown", "Unknown"),
            EmptyMessage = localizer.GetString(
                "battery.degradation.empty", "Battery health data will appear once snapshots are recorded."),
            ErrorTitle = localizer.GetString("error.loadFailed", "Failed to load data"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="BatteryDegradationModel"/> to its <see cref="BatteryDegradationDisplay"/>
/// — the native port of web/src/features/battery/pages/BatteryDegradationPage.tsx. It selects the top-level
/// data state, resolves every label through the i18n facade, formats every value (dimensionless scores via
/// <see cref="ScalarFormatters"/>; SI distance / energy via <see cref="UnitFormatters"/> at the display
/// boundary), and assembles every section — summary metrics, the health gauge, the prediction block, the
/// trend / range charts, the scored risk factors, the recommendations, the charging-impact banner, the
/// battery-health-factor cards and the degradation-history table — each with its own empty fallback so a
/// region is never blank. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class BatteryDegradationProjection
{
    /// <summary>Segoe Fluent — Battery (web <c>Battery</c> icon + the page empty surface).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c>).</summary>
    public const string LightningGlyph = "\uE945";

    /// <summary>Segoe Fluent — MarketDown (web <c>TrendingDown</c>).</summary>
    public const string TrendingDownGlyph = "\uEB0F";

    /// <summary>Segoe Fluent — Calendar (web <c>Calendar</c>).</summary>
    public const string CalendarGlyph = "\uE787";

    /// <summary>Segoe Fluent — shield (web <c>Shield</c>).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent — Warning (web <c>AlertTriangle</c>).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent — Temperature (web <c>Thermometer</c>).</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Segoe Fluent — activity (web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>The state-of-health gauge maximum (web <c>max={100}</c>).</summary>
    public const double GaugeMax = 100;

    /// <summary>The 80% warranty reference threshold (web <c>ReferenceLine y=80</c>).</summary>
    public const double WarrantyThreshold = 80;

    /// <summary>The 70% end-of-life reference threshold (web <c>ReferenceLine y=70</c>).</summary>
    public const double EndOfLifeThreshold = 70;

    private const string EmDash = "\u2014";
    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string DangerBrush = "TsColorDangerBrush";
    private const string InfoBrush = "TsColorInfoBrush";
    private const string NeutralBrush = "TsColorTextSecondaryBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed two-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static BatteryDegradationDisplay Project(
        BatteryDegradationModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = BatteryStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var h = snapshot.Health;
        var d = snapshot.Degradation;

        BatteryDegradationState state =
            model.Loading && !snapshot.HasData ? BatteryDegradationState.Loading
            : model.ErrorDetail is not null ? BatteryDegradationState.Error
            : !snapshot.HasData ? BatteryDegradationState.Empty
            : BatteryDegradationState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        var prediction = d.Prediction;
        bool hasEnough = prediction?.HasEnoughData ?? false;

        var summary = BuildSummaryMetrics(h, s);
        var predictionMetrics = hasEnough ? BuildPredictionMetrics(h, d, prediction!, s) : Array.Empty<BatteryMetricDisplay>();
        var trend = BuildTrend(h, d, s, now);
        var range = BuildRange(h, units, s, now);
        var risks = BuildRiskFactors(d, localizer);
        var factorCards = BuildFactorCards(h, s);
        var (historyColumns, historyRows) = BuildHistory(h, units, s, now);

        (CalloutVariantKind impactVariant, string impactBody) = ImpactFor(d.StressLevel, s);
        string impactTitle = BuildImpactTitle(d, s);

        double soh = h.CurrentSoh;
        (string badgeText, StatusKind badgeStatus) = HealthBadge(soh, s);

        string predictedDate = string.IsNullOrWhiteSpace(prediction?.PredictedDate)
            ? string.Empty
            : $"({prediction!.PredictedDate})";

        var display = new BatteryDegradationDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == BatteryDegradationState.Loading,
            ShowError: state == BatteryDegradationState.Error,
            ShowEmpty: state == BatteryDegradationState.Empty,
            ShowContent: state == BatteryDegradationState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyTitle: s.Title,
            EmptyMessage: s.EmptyMessage,
            SummaryMetrics: summary,
            GaugeValue: Math.Clamp(Safe(soh), 0, GaugeMax),
            GaugeMax: GaugeMax,
            GaugeLabel: s.BatteryHealth,
            GaugeUnit: "%",
            GaugeColorIndex: GaugeColorIndex(soh),
            HealthBadgeText: badgeText,
            HealthBadgeStatus: badgeStatus,
            PredictionTitle: s.Prediction,
            HasEnoughData: hasEnough,
            PredictionLeadText: s.PredictionDesc,
            PredictionThresholdText: "80%",
            PredictionInApproxText: s.InApprox,
            PredictionYearsText: hasEnough ? $"~{Num(prediction!.YearsTo80Pct)} {s.Years}" : string.Empty,
            PredictionDateText: predictedDate,
            NeedMoreMessage: s.NeedMore,
            PredictionMetrics: predictionMetrics,
            Trend: trend,
            Range: range,
            RiskTitle: s.RiskFactors,
            RiskFactors: risks,
            RiskEmptyMessage: s.NoRiskData,
            RecommendationsTitle: s.Recommendations,
            Recommendations: d.Recommendations,
            RecommendationsEmptyMessage: s.NoRecommendations,
            ChargingImpactTitle: s.ChargingImpact,
            ImpactVariant: impactVariant,
            ImpactBannerTitle: impactTitle,
            ImpactBannerBody: impactBody,
            FactorsTitle: s.FactorsTitle,
            FactorCards: factorCards,
            HistoryTitle: s.HistoryTitle,
            HistoryColumns: historyColumns,
            HistoryRows: historyRows,
            HistoryEmptyMessage: s.NoHistory,
            AutomationName: $"{s.Title}. {s.Subtitle}");

        return display;
    }

    /// <summary>Format a state-of-health score's longevity badge (web Excellent / Good / Degraded thresholds).</summary>
    public static (string Text, StatusKind Status) HealthBadge(double soh, BatteryStrings s)
    {
        ArgumentNullException.ThrowIfNull(s);
        if (soh > 90)
        {
            return (s.Excellent, StatusKind.Success);
        }

        return soh >= 80 ? (s.Good, StatusKind.Warning) : (s.Degraded, StatusKind.Danger);
    }

    /// <summary>Map a 0..100 score to its quality badge (web <c>scoreVariant</c>: ≥80 / ≥50 / else).</summary>
    public static StatusKind ScoreVariant(double score) =>
        score >= 80 ? StatusKind.Success : score >= 50 ? StatusKind.Warning : StatusKind.Danger;

    /// <summary>Map a 0..100 risk score to its impact badge (web <c>riskBadgeVariant</c>: ≤25 / ≤50 / else).</summary>
    public static StatusKind RiskVariant(double score) =>
        score <= 25 ? StatusKind.Success : score <= 50 ? StatusKind.Warning : StatusKind.Danger;

    /// <summary>Compute the cycle-depth score (web <c>max(0, round(100 - avgDoD))</c>).</summary>
    public static double CycleDepthScore(double avgDepthOfDischarge) =>
        Math.Max(0, Math.Round(100 - Safe(avgDepthOfDischarge), MidpointRounding.AwayFromZero));

    /// <summary>Render the battery-age label (web <c>ageLabel</c>: months / years / years+months).</summary>
    public static string AgeLabel(double ageMonths, BatteryStrings s)
    {
        ArgumentNullException.ThrowIfNull(s);
        int months = (int)Math.Round(Math.Max(0, Safe(ageMonths)), MidpointRounding.AwayFromZero);
        if (months < 12)
        {
            return s.CountMonths.Replace("{{count}}", months.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
        }

        int years = months / 12;
        int rem = months % 12;
        if (rem > 0)
        {
            return s.YearsMonths
                .Replace("{{y}}", years.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal)
                .Replace("{{m}}", rem.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
        }

        return s.YearsTemplate.Replace("{{y}}", years.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
    }

    private static IReadOnlyList<BatteryMetricDisplay> BuildSummaryMetrics(BatteryHealthReport h, BatteryStrings s) =>
    [
        Metric(s.CurrentSoh, Pct(h.CurrentSoh), BatteryGlyph, SuccessBrush),
        Metric(s.EstimatedCapacity, $"{Num(h.EstimatedCapacity)} kWh", LightningGlyph, InfoBrush),
        Metric(s.DegradationRate, $"{Num(h.DegradationRateYr)}%/yr", TrendingDownGlyph, InfoBrush),
        Metric(s.BatteryAge, AgeLabel(h.BatteryAgeMonths, s), CalendarGlyph, NeutralBrush),
    ];

    private static IReadOnlyList<BatteryMetricDisplay> BuildPredictionMetrics(
        BatteryHealthReport h,
        BatteryDegradationReport d,
        DegradationPrediction prediction,
        BatteryStrings s)
    {
        string stressValue = string.IsNullOrWhiteSpace(d.StressLevel) ? EmDash : d.StressLevel!;
        string stressBrush = d.StressLevel switch
        {
            "Low" => SuccessBrush,
            "Medium" => WarningBrush,
            _ => DangerBrush,
        };

        return
        [
            Metric(s.Rate, $"{Num(Math.Abs(prediction.SlopePerYear))}%/yr", string.Empty, DangerBrush),
            Metric(s.Stress, stressValue, string.Empty, stressBrush),
            Metric(s.TotalCycles, Num(h.TotalCycles), string.Empty, InfoBrush),
            Metric(s.AvgDoD, Pct(h.AvgDepthOfDischarge), string.Empty, InfoBrush),
        ];
    }

    private static BatteryMetricDisplay Metric(string label, string value, string glyph, string accentBrushKey) =>
        new(label, value, glyph, accentBrushKey, $"{label}, {value}");

    private static TrendChartDisplay BuildTrend(
        BatteryHealthReport h,
        BatteryDegradationReport d,
        BatteryStrings s,
        DateTimeOffset now)
    {
        var rows = new List<TrendRow>(h.History.Count + d.Projections.Count);
        foreach (var snapshot in h.History)
        {
            rows.Add(new TrendRow { Label = FormatDate(snapshot.Date, now), Health = snapshot.SohPct });
        }

        int firstProjection = rows.Count;
        foreach (var projection in d.Projections)
        {
            rows.Add(new TrendRow
            {
                Label = string.IsNullOrEmpty(projection.Date) ? EmDash : projection.Date,
                Projected = projection.HealthPct,
                ConfidenceHigh = Math.Max(0, projection.ConfidenceHigh),
            });
        }

        // Web parity: the projected line picks up where the actual line ends so the two segments join.
        if (firstProjection > 0 && firstProjection < rows.Count)
        {
            rows[firstProjection].Health = rows[firstProjection - 1].Health;
        }

        var actual = new List<ChartPoint>();
        var projected = new List<ChartPoint>();
        var confidence = new List<ChartPoint>();
        for (int i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            if (row.Health is { } health)
            {
                actual.Add(new ChartPoint(i, health, row.Label));
            }

            if (row.Projected is { } projectedValue)
            {
                projected.Add(new ChartPoint(i, projectedValue, row.Label));
            }

            if (row.ConfidenceHigh is { } confidenceValue)
            {
                confidence.Add(new ChartPoint(i, confidenceValue, row.Label));
            }
        }

        var series = new List<BatterySeriesDisplay>(3);
        if (confidence.Count > 0)
        {
            series.Add(new BatterySeriesDisplay(s.Confidence, BatterySeriesKind.Area, 4, confidence));
        }

        if (actual.Count > 0)
        {
            series.Add(new BatterySeriesDisplay(s.ActualHealth, BatterySeriesKind.Line, 1, actual));
        }

        if (projected.Count > 0)
        {
            series.Add(new BatterySeriesDisplay(s.Projected, BatterySeriesKind.Line, 4, projected));
        }

        return new TrendChartDisplay(
            HasData: rows.Count > 0,
            Title: s.TrendTitle,
            AriaLabel: s.TrendAria,
            Series: series,
            WarrantyValue: WarrantyThreshold,
            WarrantyLabel: s.Warranty,
            EndOfLifeValue: EndOfLifeThreshold);
    }

    private static RangeChartDisplay BuildRange(
        BatteryHealthReport h,
        UnitPref units,
        BatteryStrings s,
        DateTimeOffset now)
    {
        if (h.History.Count == 0)
        {
            return new RangeChartDisplay(false, s.RangeLoss, Array.Empty<BatterySeriesDisplay>(), s.NoRange);
        }

        double originalRange = ToDisplayDistance(h.History[0].RangeKm, units);
        var original = new List<ChartPoint>(h.History.Count);
        var current = new List<ChartPoint>(h.History.Count);
        for (int i = 0; i < h.History.Count; i++)
        {
            string label = FormatDate(h.History[i].Date, now);
            original.Add(new ChartPoint(i, originalRange, label));
            current.Add(new ChartPoint(i, ToDisplayDistance(h.History[i].RangeKm, units), label));
        }

        var series = new List<BatterySeriesDisplay>
        {
            new(s.OriginalRange, BatterySeriesKind.Area, 0, original),
            new(s.CurrentRange, BatterySeriesKind.Area, 2, current),
        };

        return new RangeChartDisplay(true, s.RangeLoss, series, s.NoRange);
    }

    private static List<RiskFactorDisplay> BuildRiskFactors(BatteryDegradationReport d, ILocalizer localizer)
    {
        if (d.RiskFactors.Count == 0)
        {
            return [];
        }

        var list = new List<RiskFactorDisplay>(d.RiskFactors.Count);
        foreach (var rf in d.RiskFactors)
        {
            string humanized = rf.Name.Replace('_', ' ');
            string label = localizer.GetString($"battery.degradation.risk.{rf.Name}", humanized);
            string scoreText = Int(rf.Score);
            string badgeText = string.IsNullOrWhiteSpace(rf.Label) ? humanized : rf.Label!;
            StatusKind variant = RiskVariant(rf.Score);

            list.Add(new RiskFactorDisplay(
                Id: rf.Name,
                Glyph: RiskGlyph(rf.Name),
                Label: label,
                ScoreText: scoreText,
                ScoreFraction: Math.Clamp(Safe(rf.Score) / 100.0, 0, 1),
                BarStatus: variant,
                BadgeText: badgeText,
                BadgeStatus: variant,
                Detail: rf.Detail ?? EmDash,
                AutomationName: $"{label}, {scoreText}"));
        }

        return list;
    }

    private static IReadOnlyList<BatteryFactorCard> BuildFactorCards(BatteryHealthReport h, BatteryStrings s)
    {
        var chargeHabits = new BatteryFactorCard(
            Title: s.ChargeHabits,
            ScoreText: $"{Num(h.ChargeHabitsScore)}/100",
            ScoreStatus: ScoreVariant(h.ChargeHabitsScore),
            FooterText: null,
            Rows:
            [
                new BatteryFactorRow(s.FastCharge, Pct(h.FastChargePct)),
                new BatteryFactorRow(s.FullCharge, Pct(h.FullChargePct)),
            ]);

        var temperature = new BatteryFactorCard(
            Title: s.TemperatureExposure,
            ScoreText: $"{Num(h.TempExposureScore)}/100",
            ScoreStatus: ScoreVariant(h.TempExposureScore),
            FooterText: s.LowerIsBetter,
            Rows: Array.Empty<BatteryFactorRow>());

        double cycleDepth = CycleDepthScore(h.AvgDepthOfDischarge);
        var cycle = new BatteryFactorCard(
            Title: s.CycleDepth,
            ScoreText: $"{Num(cycleDepth)}/100",
            ScoreStatus: ScoreVariant(cycleDepth),
            FooterText: null,
            Rows: [new BatteryFactorRow(s.AvgDoDShort, Pct(h.AvgDepthOfDischarge))]);

        return [chargeHabits, temperature, cycle];
    }

    private static (List<HistoryColumnDisplay> Columns, List<HistoryRowDisplay> Rows) BuildHistory(
        BatteryHealthReport h,
        UnitPref units,
        BatteryStrings s,
        DateTimeOffset now)
    {
        var columns = new List<HistoryColumnDisplay>
        {
            new("date", s.Date, false),
            new("odometer", s.Odometer, true),
            new("soh", s.SohHeader, true),
            new("capacity", s.Capacity, true),
            new("range", s.Range, true),
        };

        var rows = new List<HistoryRowDisplay>(h.History.Count);
        foreach (var snapshot in h.History)
        {
            rows.Add(new HistoryRowDisplay(
                Id: string.Create(CultureInfo.InvariantCulture, $"{snapshot.Date}-{snapshot.OdometerKm}"),
                Date: FormatDate(snapshot.Date, now),
                Odometer: UnitFormatters.FormatDistance(snapshot.OdometerKm * 1000.0, units, 2),
                Soh: Pct(snapshot.SohPct),
                SohStatus: snapshot.SohPct > 90 ? StatusKind.Success : snapshot.SohPct >= 80 ? StatusKind.Warning : StatusKind.Danger,
                Capacity: UnitFormatters.FormatEnergy(snapshot.CapacityWh, units, 1),
                Range: UnitFormatters.FormatDistance(snapshot.RangeKm * 1000.0, units, 2)));
        }

        return (columns, rows);
    }

    private static (CalloutVariantKind Variant, string Body) ImpactFor(string? stressLevel, BatteryStrings s) =>
        stressLevel switch
        {
            "Low" => (CalloutVariantKind.Success, s.StressLow),
            "Medium" => (CalloutVariantKind.Warning, s.StressMedium),
            _ => (CalloutVariantKind.Danger, s.StressHigh),
        };

    private static string BuildImpactTitle(BatteryDegradationReport d, BatteryStrings s)
    {
        var habits = d.ChargingHabits;
        long fast = habits?.FastChargeCount ?? 0;
        long slow = habits?.SlowChargeCount ?? 0;
        long total = fast + slow;
        string fastPct = Int(total > 0 ? (double)fast / total * 100.0 : 0);
        long deep = habits?.DeepDischargeCount ?? 0;
        string stress = string.IsNullOrWhiteSpace(d.StressLevel) ? s.Unknown : d.StressLevel!;
        return $"{fastPct}% {s.FastCharges}, {deep} {s.DeepDischarges} \u2014 {stress} {s.StressLabel}";
    }

    private static double ToDisplayDistance(double km, UnitPref units) =>
        UnitConverters.DistanceFromSi(Safe(km) * 1000.0, units.Distance);

    private static string RiskGlyph(string name) => name switch
    {
        "fast_charge_ratio" => LightningGlyph,
        "high_soc_charging" => BatteryGlyph,
        "temperature_exposure" => ThermometerGlyph,
        "cycle_count_rate" => ActivityGlyph,
        "deep_discharge_frequency" => TrendingDownGlyph,
        _ => ShieldGlyph,
    };

    private static int GaugeColorIndex(double soh) => soh > 90 ? 1 : soh >= 80 ? 3 : 5;

    private static string FormatDate(string raw, DateTimeOffset now)
    {
        if (DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed))
        {
            return DateTimeFormatting.Format(parsed, DateTimeVariant.Date, now);
        }

        return string.IsNullOrEmpty(raw) ? EmDash : raw;
    }

    private static double Safe(double value) => double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;

    private static string Num(double value) => ScalarFormatters.FormatNumber(Safe(value), 2);

    private static string Int(double value) => ScalarFormatters.FormatNumber(Safe(value), 0);

    private static string Pct(double value) => $"{Num(value)}%";

    // Mutable scratch row used while assembling the index-aligned trend series.
    private sealed class TrendRow
    {
        public string Label { get; init; } = string.Empty;

        public double? Health { get; set; }

        public double? Projected { get; init; }

        public double? ConfidenceHigh { get; init; }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>BatteryDegradationPage</c> surface (P1/S11 diagnostics contract). Records
/// only the operational <c>view.opened</c> event with the surface slug — never a state-of-health value, cycle
/// count, range or risk score — so a diagnostics line can never leak a user's battery condition. Thread-safe.
/// </summary>
public sealed class BatteryDegradationDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryDegradationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryDegradationPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryDegradationRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>BatteryDegradationPage</c> feature surface — the native mirror of the web page
/// at <c>web/src/features/battery/pages/BatteryDegradationPage.tsx</c> (route <c>/battery-degradation</c>, nav
/// name <c>BatteryDegradation</c>). Holds the route name, the two generated operation ids it binds to, the
/// diagnostics slug, the empty-surface glyph and the localized title.
/// </summary>
public static class BatteryDegradationRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryDegradationPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "BatteryDegradation";

    /// <summary>The generated operation id for the battery-health analytics read (web <c>useBatteryHealthAnalytics</c>).</summary>
    public const string HealthOperation = Operations.Analytics.BatteryHealth;

    /// <summary>The generated operation id for the battery-degradation read (web <c>useBatteryDegradation</c>).</summary>
    public const string DegradationOperation = Operations.Analytics.BatteryDegradation;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface.</summary>
    public const string EmptyGlyph = BatteryDegradationProjection.BatteryGlyph;

    /// <summary>The localized page title (web <c>t('Battery Degradation')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Battery Degradation", "Battery Degradation");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case battery-analytics JSON wire shape (no camelCaseKeys transform on
/// native): numbers (or numeric strings), strings, booleans and arrays of objects / strings. Kept internal to
/// this surface so the page's parsers stay self-contained and never throw on a partial body.
/// </summary>
internal static class BatteryJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? s = v.GetString();
            return string.IsNullOrEmpty(s) ? null : s;
        }

        return null;
    }

    /// <summary>Reads a boolean property (true only for a JSON <c>true</c>); false otherwise.</summary>
    public static bool Bool(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    /// <summary>Projects each element of an array property through <paramref name="map"/> (empty when absent).</summary>
    public static IReadOnlyList<T> Array<T>(JsonElement obj, string name, Func<JsonElement, T> map)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return System.Array.Empty<T>();
        }

        var list = new List<T>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            list.Add(map(item));
        }

        return list;
    }

    /// <summary>Reads an array of non-null strings (empty when absent / non-array).</summary>
    public static IReadOnlyList<string> StringArray(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return System.Array.Empty<string>();
        }

        var list = new List<string>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { } s)
            {
                list.Add(s);
            }
        }

        return list;
    }
}
