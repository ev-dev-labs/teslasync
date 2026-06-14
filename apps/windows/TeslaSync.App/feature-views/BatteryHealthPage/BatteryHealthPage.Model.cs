using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// One battery-health history row from <c>GET /analytics/battery-health</c> (web
/// <c>BatteryHealthSnapshot</c> in web/src/types/energy.ts) — the source for the range-trend area
/// chart, the capacity-trend "actual" line and the New-vs-Now range cards. <see cref="OdometerKm"/>
/// and <see cref="RangeKm"/> are derived SI kilometres (converted at the display boundary) and
/// <see cref="CapacityWh"/> is SI watt-hours. Parsing is null-tolerant so a partial row never throws.
/// </summary>
public sealed record BatteryHealthHistoryPoint(
    string Date,
    double OdometerKm,
    double SohPct,
    double CapacityWh,
    double RangeKm)
{
    /// <summary>Project a single history JSON object into a tolerant point.</summary>
    public static BatteryHealthHistoryPoint FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new BatteryHealthHistoryPoint(string.Empty, 0, 0, 0, 0);
        }

        return new BatteryHealthHistoryPoint(
            Date: BatteryHealthJson.String(element, "date") ?? string.Empty,
            OdometerKm: BatteryHealthJson.Double(element, "odometer") ?? 0,
            SohPct: BatteryHealthJson.Double(element, "soh_pct") ?? 0,
            CapacityWh: BatteryHealthJson.Double(element, "capacity_wh") ?? 0,
            RangeKm: BatteryHealthJson.Double(element, "range_km") ?? 0);
    }
}

/// <summary>
/// The battery-health analytics the page reads from <c>GET /analytics/battery-health</c> — the native
/// mirror of the web <c>BatteryHealthAnalytics</c> (web/src/types/energy.ts). Every score / percentage
/// is dimensionless; <see cref="EstimatedCapacity"/> / <see cref="OriginalCapacity"/> are already in kWh
/// (rendered verbatim, exactly as the web reads them) and the history range / odometer are SI km. A
/// <see langword="null"/> parse result models the web <c>!!data</c> gate returning false (empty surface).
/// </summary>
public sealed record BatteryHealthAnalytics(
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
    IReadOnlyList<BatteryHealthHistoryPoint> History)
{
    /// <summary>An all-zero analytics with no history — the projection seed before any data resolves.</summary>
    public static BatteryHealthAnalytics Empty { get; } =
        new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Array.Empty<BatteryHealthHistoryPoint>());

    /// <summary>
    /// Project a <c>GET /analytics/battery-health</c> response into the analytics. Mirrors the web
    /// <c>hasData = !!data</c> gate: only a non-object body returns <see langword="null"/> (empty surface);
    /// any object yields an analytics with missing fields defaulting to 0 (the web <c>?? 0</c> reads).
    /// </summary>
    public static BatteryHealthAnalytics? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new BatteryHealthAnalytics(
            CurrentSoh: BatteryHealthJson.Double(root, "current_soh") ?? 0,
            EstimatedCapacity: BatteryHealthJson.Double(root, "estimated_capacity") ?? 0,
            OriginalCapacity: BatteryHealthJson.Double(root, "original_capacity") ?? 0,
            DegradationRateYr: BatteryHealthJson.Double(root, "degradation_rate_yr") ?? 0,
            BatteryAgeMonths: BatteryHealthJson.Double(root, "battery_age_months") ?? 0,
            TotalCycles: BatteryHealthJson.Double(root, "total_cycles") ?? 0,
            AvgDepthOfDischarge: BatteryHealthJson.Double(root, "avg_depth_of_discharge") ?? 0,
            FastChargePct: BatteryHealthJson.Double(root, "fast_charge_pct") ?? 0,
            FullChargePct: BatteryHealthJson.Double(root, "full_charge_pct") ?? 0,
            ChargeHabitsScore: BatteryHealthJson.Double(root, "charge_habits_score") ?? 0,
            TempExposureScore: BatteryHealthJson.Double(root, "temp_exposure_score") ?? 0,
            History: BatteryHealthJson.Array(root, "history", BatteryHealthHistoryPoint.FromJson));
    }
}

/// <summary>One predictive projection point inside the prediction (web <c>{ month, health }</c>).</summary>
public sealed record ForecastProjectionPoint(string Month, double Health)
{
    /// <summary>Project a single projection-point JSON object into a tolerant point.</summary>
    public static ForecastProjectionPoint FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new ForecastProjectionPoint(string.Empty, 0);
        }

        return new ForecastProjectionPoint(
            Month: BatteryHealthJson.String(element, "month") ?? string.Empty,
            Health: BatteryHealthJson.Double(element, "health") ?? 0);
    }
}

/// <summary>The linear-fit prediction block (web <c>DegradationPrediction</c>) with its projection points.</summary>
public sealed record ForecastPrediction(
    bool HasEnoughData,
    double SlopePerYear,
    double YearsTo80Pct,
    string? PredictedDate,
    IReadOnlyList<ForecastProjectionPoint> ProjectionPoints)
{
    /// <summary>Project the <c>prediction</c> object, or <see langword="null"/> when absent / non-object.</summary>
    public static ForecastPrediction? FromJson(JsonElement root)
    {
        if (!root.TryGetProperty("prediction", out var p) || p.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ForecastPrediction(
            HasEnoughData: BatteryHealthJson.Bool(p, "has_enough_data") ?? false,
            SlopePerYear: BatteryHealthJson.Double(p, "slope_per_year") ?? 0,
            YearsTo80Pct: BatteryHealthJson.Double(p, "years_to_80_pct") ?? 0,
            PredictedDate: BatteryHealthJson.String(p, "predicted_date"),
            ProjectionPoints: BatteryHealthJson.Array(p, "projection_points", ForecastProjectionPoint.FromJson));
    }
}

/// <summary>
/// The battery-degradation forecast the page reads from <c>GET /analytics/battery-degradation</c> — the
/// supplementary read powering the capacity-trend projection (web <c>useBatteryDegradation</c>). Only the
/// prediction (with its projection points) is consumed by this page. Best-effort: a non-object body or a
/// failed read degrades to <see cref="Empty"/> rather than throwing or sinking the page.
/// </summary>
public sealed record BatteryHealthForecast(ForecastPrediction? Prediction)
{
    /// <summary>A data-free forecast — the parse fallback for an absent / non-object body.</summary>
    public static BatteryHealthForecast Empty { get; } = new((ForecastPrediction?)null);

    /// <summary>Project a <c>GET /analytics/battery-degradation</c> JSON body into a tolerant forecast.</summary>
    public static BatteryHealthForecast FromJson(JsonElement root) =>
        root.ValueKind != JsonValueKind.Object
            ? Empty
            : new BatteryHealthForecast(ForecastPrediction.FromJson(root));
}

/// <summary>
/// One charging-session summary from <c>GET /charging</c> (web <c>ChargingSession</c>) — the page reads
/// the start/end state-of-charge, the charger type and the SI energy / peak-power to derive the charge-level
/// distribution, the charging habits, the insights and the AC/DC energy breakdown. Null-tolerant.
/// </summary>
public sealed record ChargeSessionSummary(
    double StartSocPct,
    double? EndSocPct,
    string? ChargerType,
    double? PeakPowerW,
    double TotalEnergyAddedWh)
{
    /// <summary>Project a single charging-session JSON object into a tolerant summary.</summary>
    public static ChargeSessionSummary FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new ChargeSessionSummary(0, null, null, null, 0);
        }

        return new ChargeSessionSummary(
            StartSocPct: BatteryHealthJson.Double(element, "start_soc_pct") ?? 0,
            EndSocPct: BatteryHealthJson.Double(element, "end_soc_pct"),
            ChargerType: BatteryHealthJson.String(element, "charger_type"),
            PeakPowerW: BatteryHealthJson.Double(element, "peak_power_w"),
            TotalEnergyAddedWh: BatteryHealthJson.Double(element, "total_energy_added_wh") ?? 0);
    }
}

/// <summary>
/// The latest charging-telemetry snapshot from <c>GET /charging-telemetry/latest</c> (web
/// <c>ChargingTelemetry</c>) — the live thermal-monitoring source. SI Celsius module temperatures plus the
/// nullable full-charge-complete / battery-heater flags. A <see langword="null"/> snapshot models the web
/// query returning <c>null</c> (every thermal card falls back to its em-dash reading).
/// </summary>
public sealed record ChargeThermalLatest(
    bool? BmsFullChargeComplete,
    double? ModuleTempMax,
    double? ModuleTempMin,
    long? NumModuleTempMax,
    long? NumModuleTempMin,
    bool? BatteryHeaterOn)
{
    /// <summary>Project a <c>GET /charging-telemetry/latest</c> body into a snapshot, or null when absent.</summary>
    public static ChargeThermalLatest? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ChargeThermalLatest(
            BmsFullChargeComplete: BatteryHealthJson.Bool(root, "bms_fullcharge_complete"),
            ModuleTempMax: BatteryHealthJson.Double(root, "module_temp_max"),
            ModuleTempMin: BatteryHealthJson.Double(root, "module_temp_min"),
            NumModuleTempMax: BatteryHealthJson.Long(root, "num_module_temp_max"),
            NumModuleTempMin: BatteryHealthJson.Long(root, "num_module_temp_min"),
            BatteryHeaterOn: BatteryHealthJson.Bool(root, "battery_heater_on"));
    }
}

/// <summary>
/// The combined four-source read backing the page — the native analogue of the web page's
/// <c>useBatteryHealthAnalytics</c> (primary; drives the page loading / error / empty state),
/// <c>useBatteryDegradation</c> (capacity-trend projection), <c>useChargingSessionsPaginated</c>
/// (distribution / habits / breakdown / insights) and <c>useChargingTelemetryLatest</c> (thermal).
/// <see cref="HasData"/> mirrors the web <c>!!data</c> gate on the health query.
/// </summary>
public sealed record BatteryHealthPageSnapshot(
    bool HasData,
    BatteryHealthAnalytics Health,
    BatteryHealthForecast Forecast,
    IReadOnlyList<ChargeSessionSummary> Sessions,
    ChargeThermalLatest? Thermal)
{
    /// <summary>The empty snapshot (no health object) — the page-level empty surface.</summary>
    public static BatteryHealthPageSnapshot Empty { get; } = new(
        false,
        BatteryHealthAnalytics.Empty,
        BatteryHealthForecast.Empty,
        Array.Empty<ChargeSessionSummary>(),
        null);

    /// <summary>Compose a snapshot from the parsed health analytics (may be null) and the supplementary reads.</summary>
    public static BatteryHealthPageSnapshot Compose(
        BatteryHealthAnalytics? health,
        BatteryHealthForecast forecast,
        IReadOnlyList<ChargeSessionSummary> sessions,
        ChargeThermalLatest? thermal) =>
        health is { } h
            ? new BatteryHealthPageSnapshot(true, h, forecast, sessions, thermal)
            : new BatteryHealthPageSnapshot(false, BatteryHealthAnalytics.Empty, forecast, sessions, thermal);
}

/// <summary>The four-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IBatteryHealthFeed
{
    /// <summary>Fetch the battery-health analytics + forecast + charging sessions + thermal for the active vehicle.</summary>
    Task<BatteryHealthPageSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyBatteryHealthFeed : IBatteryHealthFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyBatteryHealthFeed Instance { get; } = new();

    private EmptyBatteryHealthFeed()
    {
    }

    /// <inheritdoc />
    public Task<BatteryHealthPageSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(BatteryHealthPageSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum BatteryHealthState
{
    /// <summary>The primary health query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no battery-health object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The primary health query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The health analytics resolved — every section renders (each with its own empty fallback).</summary>
    Success,
}

/// <summary>One projected radial gauge (web <c>RadialGauge</c>): value, scale, label, unit and palette index.</summary>
public sealed record HealthGaugeDisplay(
    string Label,
    double Value,
    double Max,
    string Unit,
    int ColorIndex,
    int Decimals,
    string AutomationName);

/// <summary>One projected metric card (web <c>MetricCard</c>): label, formatted value, glyph, accent, sub-line.</summary>
public sealed record HealthMetricCard(
    string Label,
    string Value,
    string Glyph,
    string AccentBrushKey,
    string? Sublabel,
    string AutomationName);

/// <summary>One projected metric bar (web <c>MetricBar</c>): label, fraction, accent and a caption line.</summary>
public sealed record HealthMetricBar(
    string Label,
    double Value,
    double Max,
    string AccentBrushKey,
    string Caption,
    string AutomationName);

/// <summary>One projected smart-insight card (web insight): glyph, title, description and semantic status.</summary>
public sealed record HealthInsight(
    string Glyph,
    string Title,
    string Description,
    StatusKind Status,
    string AutomationName);

/// <summary>One projected charging-habit mini-stat (web habit tile): label, value and accent.</summary>
public sealed record HealthHabitStat(string Label, string Value, string AccentBrushKey, string AutomationName);

/// <summary>One projected New-vs-Now comparison card: label, value, unit and an optional delta line.</summary>
public sealed record HealthNewVsNowCard(
    string Label,
    string Value,
    string Unit,
    string? Delta,
    string AccentBrushKey,
    string AutomationName);

/// <summary>One projected charging-statistics row (label / value).</summary>
public sealed record HealthStatRow(string Label, string Value);

/// <summary>One projected quick-link navigation tile (route + localized label).</summary>
public sealed record HealthQuickLink(string Route, string Label, string AutomationName);

/// <summary>
/// The projected Capacity-Trend &amp; Prediction composed chart (web <c>ComposedChart</c>): the actual-health
/// area/line plus the dashed projected line, with the 80% warranty + 70% end-of-life reference thresholds.
/// </summary>
public sealed record CapacityTrendChart(
    bool HasData,
    string Title,
    string Subtitle,
    string AriaLabel,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<ChartAnnotation> Annotations,
    string EmptyMessage);

/// <summary>The projected Estimated-Range-Over-Time area chart (web <c>AreaChart</c>): per-snapshot range.</summary>
public sealed record RangeTrendChart(
    bool HasData,
    string Title,
    string AriaLabel,
    IReadOnlyList<ChartSeries> Series,
    string EmptyMessage);

/// <summary>
/// The projected Charge-Level-Distribution bar chart (web <c>BarChart</c>): per-decile started / ended counts,
/// plus the four charging-habit mini-stats rendered beneath it.
/// </summary>
public sealed record ChargeDistChart(
    bool HasData,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<HealthHabitStat> Habits,
    string EmptyMessage);

/// <summary>
/// The projected AC/DC energy breakdown (web pie chart + charging-statistics panel): the AC vs DC kWh share
/// and the five summary stat rows. Both halves share the web's single <c>energyBreakdown</c> memo.
/// </summary>
public sealed record AcDcChart(
    bool HasData,
    string ChartTitle,
    string ChartAriaLabel,
    IReadOnlyList<ChartPoint> PieData,
    string ChartEmptyMessage,
    string StatsTitle,
    IReadOnlyList<HealthStatRow> Stats,
    string StatsEmptyMessage);

/// <summary>The localized fallback titles for every web <c>SectionErrorBoundary</c> on the page.</summary>
public sealed record BatteryHealthSectionTitles(
    string Hero,
    string MetricBars,
    string SummaryCards,
    string Thermal,
    string Insights,
    string ChargeDist,
    string CapacityRange,
    string AcDc,
    string QuickLinks,
    string Recommendations);

/// <summary>
/// The fully projected, render-ready view of the page for one snapshot — the native analogue of everything the
/// web <c>BatteryHealthPage</c> computes before returning JSX. Pure data so every branch is asserted headlessly;
/// the view binds to it and selects exactly one top-level body via the <c>Show*</c> flags.
/// </summary>
public sealed record BatteryHealthDisplay(
    BatteryHealthState State,
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
    IReadOnlyList<HealthGaugeDisplay> Gauges,
    string HealthBadgeText,
    StatusKind HealthBadgeStatus,
    string YearsTo80Value,
    string YearsTo80Label,
    string WarrantyNote,
    IReadOnlyList<HealthMetricBar> MetricBars,
    IReadOnlyList<HealthMetricCard> SummaryCards,
    string ThermalTitle,
    IReadOnlyList<HealthMetricCard> ThermalCards,
    string InsightsTitle,
    IReadOnlyList<HealthInsight> Insights,
    string InsightsEmptyMessage,
    CapacityTrendChart CapacityTrend,
    RangeTrendChart RangeTrend,
    string ChargeDistTitle,
    string ChargeDistSubtitle,
    ChargeDistChart ChargeDist,
    string NewVsNowTitle,
    IReadOnlyList<HealthNewVsNowCard> NewVsNowCards,
    AcDcChart AcDc,
    IReadOnlyList<HealthQuickLink> QuickLinks,
    string RecommendationsTitle,
    IReadOnlyList<string> Recommendations,
    BatteryHealthSectionTitles SectionTitles,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed four-source <see cref="Snapshot"/> plus the page
/// lifecycle (the primary health query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model
/// fills this in; tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record BatteryHealthPageModel(BatteryHealthPageSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary health query is in flight with no data yet.</summary>
    public static BatteryHealthPageModel Initial { get; } = new(BatteryHealthPageSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>BatteryHealthPage</c>
/// feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test can assert all of them in one pass. Web key names are preserved verbatim.
/// </summary>
public sealed record BatteryHealthStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string Empty { get; init; }
    public required string GaugeHealth { get; init; }
    public required string GaugeCapacity { get; init; }
    public required string GaugeDegradation { get; init; }
    public required string GaugeCycles { get; init; }
    public required string HealthExcellent { get; init; }
    public required string HealthGood { get; init; }
    public required string HealthDegraded { get; init; }
    public required string YearsTo80 { get; init; }
    public required string WarrantyNote { get; init; }
    public required string WarrantyLimit { get; init; }
    public required string BarCapacity { get; init; }
    public required string BarDegradation { get; init; }
    public required string BarCycles { get; init; }
    public required string PerYear { get; init; }
    public required string MetricSoh { get; init; }
    public required string MetricCurrentCap { get; init; }
    public required string MetricOriginalCap { get; init; }
    public required string MetricDegradation { get; init; }
    public required string MetricCycles { get; init; }
    public required string MetricAge { get; init; }
    public required string MetricFullChargeComplete { get; init; }
    public required string Months { get; init; }
    public required string Yr { get; init; }
    public required string ThermalTitle { get; init; }
    public required string ThermalModuleTempMax { get; init; }
    public required string ThermalModuleTempMin { get; init; }
    public required string ThermalHeater { get; init; }
    public required string ThermalTempSpread { get; init; }
    public required string ThermalModuleNumber { get; init; }
    public required string InsightsTitle { get; init; }
    public required string InsightsEmpty { get; init; }
    public required string InsightExcellentTitle { get; init; }
    public required string InsightExcellentDesc { get; init; }
    public required string InsightGoodTitle { get; init; }
    public required string InsightGoodDesc { get; init; }
    public required string InsightConcernTitle { get; init; }
    public required string InsightConcernDesc { get; init; }
    public required string InsightHighFastChargeTitle { get; init; }
    public required string InsightHighFastChargeDesc { get; init; }
    public required string InsightGoodHabitsTitle { get; init; }
    public required string InsightGoodHabitsDesc { get; init; }
    public required string InsightDeepDischargeTitle { get; init; }
    public required string InsightDeepDischargeDesc { get; init; }
    public required string InsightHighSuperchargerTitle { get; init; }
    public required string InsightHighSuperchargerDesc { get; init; }
    public required string InsightLowDegTitle { get; init; }
    public required string InsightLowDegDesc { get; init; }
    public required string ChartCapacityTrend { get; init; }
    public required string ChartCapacityTrendAria { get; init; }
    public required string ChartDashedProjected { get; init; }
    public required string ChartActual { get; init; }
    public required string ChartPredicted { get; init; }
    public required string ChartNoTrend { get; init; }
    public required string ChartRangeTrend { get; init; }
    public required string ChartRangeTrendAria { get; init; }
    public required string ChartRange { get; init; }
    public required string ChartNoRange { get; init; }
    public required string ChartChargeDist { get; init; }
    public required string ChartChargeDistSub { get; init; }
    public required string ChartChargeStarted { get; init; }
    public required string ChartChargeEnded { get; init; }
    public required string ChartNoSessions { get; init; }
    public required string HabitAvgStart { get; init; }
    public required string HabitAvgEnd { get; init; }
    public required string HabitSupercharger { get; init; }
    public required string HabitHome { get; init; }
    public required string NewVsNowTitle { get; init; }
    public required string NewVsNowCapNew { get; init; }
    public required string NewVsNowCapNow { get; init; }
    public required string NewVsNowRangeNew { get; init; }
    public required string NewVsNowRangeNow { get; init; }
    public required string NewVsNowLost { get; init; }
    public required string ChartAcdc { get; init; }
    public required string ChartAcdcAria { get; init; }
    public required string ChartNoBreakdown { get; init; }
    public required string StatsTitle { get; init; }
    public required string StatsTotalSessions { get; init; }
    public required string StatsAcSessions { get; init; }
    public required string StatsDcSessions { get; init; }
    public required string StatsTotalEnergy { get; init; }
    public required string StatsCycles { get; init; }
    public required string StatsEmpty { get; init; }
    public required string RecommendationsTitle { get; init; }
    public required string TipReduceFast { get; init; }
    public required string TipAvoid100 { get; init; }
    public required string TipAvoidDeep { get; init; }
    public required string TipAboveAvg { get; init; }
    public required string TipGreat { get; init; }
    public required string LinkCells { get; init; }
    public required string LinkDegradation { get; init; }
    public required string LinkEnergyFlow { get; init; }
    public required string LinkProjectedRange { get; init; }
    public required string LinkVampireDrain { get; init; }
    public required string LinkSleepEfficiency { get; init; }
    public required string SectionHeroFailed { get; init; }
    public required string SectionMetricBarsFailed { get; init; }
    public required string SectionSummaryCardsFailed { get; init; }
    public required string SectionThermalFailed { get; init; }
    public required string SectionInsightsFailed { get; init; }
    public required string SectionChargeDistFailed { get; init; }
    public required string SectionCapacityRangeFailed { get; init; }
    public required string SectionAcdcFailed { get; init; }
    public required string SectionQuickLinksFailed { get; init; }
    public required string SectionRecommendationsFailed { get; init; }
    public required string CommonYes { get; init; }
    public required string CommonNo { get; init; }
    public required string CommonOn { get; init; }
    public required string CommonOff { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every label through <paramref name="localizer"/> using the same keys the web page uses.</summary>
    public static BatteryHealthStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new BatteryHealthStrings
        {
            Title = localizer.GetString("battery.title", "Battery Health"),
            Subtitle = localizer.GetString(
                "battery.subtitle",
                "Degradation tracking, prediction, charging habits & longevity insights"),
            Empty = localizer.GetString("battery.empty", "No battery health data available yet."),
            GaugeHealth = localizer.GetString("battery.gauge.health", "Health Score"),
            GaugeCapacity = localizer.GetString("battery.gauge.capacity", "Capacity"),
            GaugeDegradation = localizer.GetString("battery.gauge.degradation", "Degradation"),
            GaugeCycles = localizer.GetString("battery.gauge.cycles", "Cycles"),
            HealthExcellent = localizer.GetString("battery.health.excellent", "Excellent"),
            HealthGood = localizer.GetString("battery.health.good", "Good"),
            HealthDegraded = localizer.GetString("battery.health.degraded", "Degraded"),
            YearsTo80 = localizer.GetString("battery.yearsTo80", "Years to 80%"),
            WarrantyNote = localizer.GetString("battery.warrantyNote", "warranty threshold"),
            WarrantyLimit = localizer.GetString("battery.warrantyLimit", "Tesla warranty: 1,500 cycles / 70%"),
            BarCapacity = localizer.GetString("battery.bar.capacity", "Current Capacity"),
            BarDegradation = localizer.GetString("battery.bar.degradation", "Degradation"),
            BarCycles = localizer.GetString("battery.bar.cycles", "Charge Cycles"),
            PerYear = localizer.GetString("battery.perYear", "per year"),
            MetricSoh = localizer.GetString("battery.metric.soh", "State of Health"),
            MetricCurrentCap = localizer.GetString("battery.metric.currentCap", "Current Capacity"),
            MetricOriginalCap = localizer.GetString("battery.metric.originalCap", "Original Capacity"),
            MetricDegradation = localizer.GetString("battery.metric.degradation", "Degradation Rate"),
            MetricCycles = localizer.GetString("battery.metric.cycles", "Total Cycles"),
            MetricAge = localizer.GetString("battery.metric.age", "Battery Age"),
            MetricFullChargeComplete = localizer.GetString("battery.metric.fullChargeComplete", "Full Charge Complete"),
            Months = localizer.GetString("battery.months", "months"),
            Yr = localizer.GetString("battery.yr", "yr"),
            ThermalTitle = localizer.GetString("battery.thermal.title", "Thermal Monitoring"),
            ThermalModuleTempMax = localizer.GetString("battery.thermal.moduleTempMax", "Module Temp (Max)"),
            ThermalModuleTempMin = localizer.GetString("battery.thermal.moduleTempMin", "Module Temp (Min)"),
            ThermalHeater = localizer.GetString("battery.thermal.heater", "Battery Heater"),
            ThermalTempSpread = localizer.GetString("battery.thermal.tempSpread", "Temperature Spread"),
            ThermalModuleNumber = localizer.GetString("battery.thermal.moduleNumber", "Module #{{n}}"),
            InsightsTitle = localizer.GetString("battery.insights.title", "Smart Insights"),
            InsightsEmpty = localizer.GetString("battery.insights.empty", "Not enough data for insights yet"),
            InsightExcellentTitle = localizer.GetString("battery.insight.excellentTitle", "Excellent Health"),
            InsightExcellentDesc = localizer.GetString(
                "battery.insight.excellentDesc", "Battery health is {{soh}}/100 — performing above average."),
            InsightGoodTitle = localizer.GetString("battery.insight.goodTitle", "Good Health"),
            InsightGoodDesc = localizer.GetString(
                "battery.insight.goodDesc", "Battery health is {{soh}}/100 — normal degradation for age."),
            InsightConcernTitle = localizer.GetString("battery.insight.concernTitle", "Health Concern"),
            InsightConcernDesc = localizer.GetString(
                "battery.insight.concernDesc", "Battery health dropped to {{soh}}/100 — consider service check."),
            InsightHighFastChargeTitle = localizer.GetString(
                "battery.insight.highFastChargeTitle", "High Fast-Charge Usage"),
            InsightHighFastChargeDesc = localizer.GetString(
                "battery.insight.highFastChargeDesc",
                "{{pct}} of sessions are fast-charging. Mix in slow charging for longevity."),
            InsightGoodHabitsTitle = localizer.GetString("battery.insight.goodHabitsTitle", "Good Charging Habits"),
            InsightGoodHabitsDesc = localizer.GetString(
                "battery.insight.goodHabitsDesc", "Most charges are slow/AC — ideal for battery longevity."),
            InsightDeepDischargeTitle = localizer.GetString(
                "battery.insight.deepDischargeTitle", "Deep Discharges Detected"),
            InsightDeepDischargeDesc = localizer.GetString(
                "battery.insight.deepDischargeDesc",
                "{{count}} recent sessions started below 10%. Avoid deep discharges when possible."),
            InsightHighSuperchargerTitle = localizer.GetString(
                "battery.insight.highSuperchargerTitle", "High Supercharger Usage"),
            InsightHighSuperchargerDesc = localizer.GetString(
                "battery.insight.highSuperchargerDesc",
                "{{count}} Supercharger sessions. Occasional slow charging helps battery health."),
            InsightLowDegTitle = localizer.GetString("battery.insight.lowDegTitle", "Low Degradation Rate"),
            InsightLowDegDesc = localizer.GetString(
                "battery.insight.lowDegDesc", "{{rate}}% per year — well below industry average of 3–5%."),
            ChartCapacityTrend = localizer.GetString("battery.chart.capacityTrend", "Capacity Trend & Prediction"),
            ChartCapacityTrendAria = localizer.GetString(
                "battery.chart.capacityTrend.aria", "Battery capacity trend with dashed projection line over time"),
            ChartDashedProjected = localizer.GetString("battery.chart.dashedProjected", "Dashed = projected"),
            ChartActual = localizer.GetString("battery.chart.actual", "Actual %"),
            ChartPredicted = localizer.GetString("battery.chart.predicted", "Predicted %"),
            ChartNoTrend = localizer.GetString("battery.chart.noTrend", "Not enough snapshots for trend analysis"),
            ChartRangeTrend = localizer.GetString("battery.chart.rangeTrend", "Estimated Range Over Time"),
            ChartRangeTrendAria = localizer.GetString(
                "battery.chart.rangeTrend.aria", "Estimated battery range over time area chart"),
            ChartRange = localizer.GetString("battery.chart.range", "Range"),
            ChartNoRange = localizer.GetString("battery.chart.noRange", "No range data yet"),
            ChartChargeDist = localizer.GetString("battery.chart.chargeDist", "Charge Level Distribution"),
            ChartChargeDistSub = localizer.GetString("battery.chart.chargeDistSub", "Recent 100 sessions"),
            ChartChargeStarted = localizer.GetString("battery.chart.chargeStarted", "Charge Started"),
            ChartChargeEnded = localizer.GetString("battery.chart.chargeEnded", "Charge Ended"),
            ChartNoSessions = localizer.GetString("battery.chart.noSessions", "No charging session data yet"),
            HabitAvgStart = localizer.GetString("battery.habit.avgStart", "Avg Start Level"),
            HabitAvgEnd = localizer.GetString("battery.habit.avgEnd", "Avg End Level"),
            HabitSupercharger = localizer.GetString("battery.habit.supercharger", "Supercharger Sessions"),
            HabitHome = localizer.GetString("battery.habit.home", "Home Charges"),
            NewVsNowTitle = localizer.GetString("battery.newVsNow.title", "Capacity & Range: New vs Now"),
            NewVsNowCapNew = localizer.GetString("battery.newVsNow.capNew", "Capacity When New"),
            NewVsNowCapNow = localizer.GetString("battery.newVsNow.capNow", "Capacity Now"),
            NewVsNowRangeNew = localizer.GetString("battery.newVsNow.rangeNew", "Range When New"),
            NewVsNowRangeNow = localizer.GetString("battery.newVsNow.rangeNow", "Range Now"),
            NewVsNowLost = localizer.GetString("battery.newVsNow.lost", "lost"),
            ChartAcdc = localizer.GetString("battery.chart.acdc", "AC / DC Energy Breakdown"),
            ChartAcdcAria = localizer.GetString("battery.chart.acdc.aria", "AC versus DC energy share pie chart"),
            ChartNoBreakdown = localizer.GetString("battery.chart.noBreakdown", "No charging data for breakdown"),
            StatsTitle = localizer.GetString("battery.stats.title", "Charging Statistics"),
            StatsTotalSessions = localizer.GetString("battery.stats.totalSessions", "Total Sessions"),
            StatsAcSessions = localizer.GetString("battery.stats.acSessions", "AC Sessions"),
            StatsDcSessions = localizer.GetString("battery.stats.dcSessions", "DC / Supercharger"),
            StatsTotalEnergy = localizer.GetString("battery.stats.totalEnergy", "Total Energy Added"),
            StatsCycles = localizer.GetString("battery.stats.cycles", "Charge Cycles"),
            StatsEmpty = localizer.GetString("battery.stats.empty", "No charging statistics yet"),
            RecommendationsTitle = localizer.GetString("battery.recommendations.title", "Recommendations"),
            TipReduceFast = localizer.GetString(
                "battery.tip.reduceFast", "Reduce fast charging frequency to slow degradation."),
            TipAvoid100 = localizer.GetString(
                "battery.tip.avoid100", "Avoid charging to 100% regularly — keep the limit at 80–90%."),
            TipAvoidDeep = localizer.GetString("battery.tip.avoidDeep", "Try to avoid deep discharges below 20%."),
            TipAboveAvg = localizer.GetString(
                "battery.tip.aboveAvg", "Your degradation rate is above average — review charging habits."),
            TipGreat = localizer.GetString(
                "battery.tip.great", "Your battery health looks great — keep up the good habits!"),
            LinkCells = localizer.GetString("battery.links.cells", "Battery Cells"),
            LinkDegradation = localizer.GetString("battery.links.degradation", "Degradation"),
            LinkEnergyFlow = localizer.GetString("battery.links.energyFlow", "Energy Flow"),
            LinkProjectedRange = localizer.GetString("battery.links.projectedRange", "Projected Range"),
            LinkVampireDrain = localizer.GetString("battery.links.vampireDrain", "Vampire Drain"),
            LinkSleepEfficiency = localizer.GetString("battery.links.sleepEfficiency", "Sleep Efficiency"),
            SectionHeroFailed = localizer.GetString("battery.section.heroFailed", "Health score panel failed to load"),
            SectionMetricBarsFailed = localizer.GetString(
                "battery.section.metricBarsFailed", "Metric bars failed to load"),
            SectionSummaryCardsFailed = localizer.GetString(
                "battery.section.summaryCardsFailed", "Summary metrics failed to load"),
            SectionThermalFailed = localizer.GetString(
                "battery.section.thermalFailed", "Thermal monitoring failed to load"),
            SectionInsightsFailed = localizer.GetString(
                "battery.section.insightsFailed", "Smart insights failed to load"),
            SectionChargeDistFailed = localizer.GetString(
                "battery.section.chargeDistFailed", "Charge level distribution failed to load"),
            SectionCapacityRangeFailed = localizer.GetString(
                "battery.section.capacityRangeFailed", "Capacity & range comparison failed to load"),
            SectionAcdcFailed = localizer.GetString(
                "battery.section.acdcFailed", "AC/DC energy breakdown failed to load"),
            SectionQuickLinksFailed = localizer.GetString(
                "battery.section.quickLinksFailed", "Quick links failed to load"),
            SectionRecommendationsFailed = localizer.GetString(
                "battery.section.recommendationsFailed", "Recommendations failed to load"),
            CommonYes = localizer.GetString("common.yes", "Yes"),
            CommonNo = localizer.GetString("common.no", "No"),
            CommonOn = localizer.GetString("common.on", "On"),
            CommonOff = localizer.GetString("common.off", "Off"),
            ErrorTitle = localizer.GetString("error.loadFailed", "Failed to load data"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="BatteryHealthPageModel"/> to its <see cref="BatteryHealthDisplay"/> — the
/// native port of web/src/features/battery/pages/BatteryHealthPage.tsx. It selects the top-level data state,
/// resolves every label through the i18n facade, formats every value (dimensionless scores via
/// <see cref="ScalarFormatters"/>; SI distance / temperature / energy via <see cref="UnitConverters"/> at the
/// display boundary), and assembles every section — the four health gauges, the three metric bars, the seven
/// summary cards, the four thermal cards, the smart insights, the capacity-trend and range-trend charts, the
/// charge-level distribution + habits, the New-vs-Now comparison, the AC/DC breakdown + statistics, the quick
/// links and the recommendations — each with its own empty fallback so a region is never blank. No WinUI types
/// — unit-tested without a UI host.
/// </summary>
public static class BatteryHealthProjection
{
    /// <summary>Segoe Fluent — HeartFill (web <c>Heart</c>).</summary>
    public const string HeartGlyph = "\uEB51";

    /// <summary>Segoe Fluent — Battery (web <c>Battery</c> / <c>BatteryFull</c>).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent — MarketDown (web <c>Gauge</c> degradation).</summary>
    public const string GaugeGlyph = "\uEB0F";

    /// <summary>Segoe Fluent — Refresh (web <c>RefreshCcw</c>).</summary>
    public const string RefreshGlyph = "\uE72C";

    /// <summary>Segoe Fluent — Calendar (web <c>Clock</c> age).</summary>
    public const string ClockGlyph = "\uE787";

    /// <summary>Segoe Fluent — Completed (web <c>CheckCircle</c>).</summary>
    public const string CheckGlyph = "\uE930";

    /// <summary>Segoe Fluent — Info (web <c>Info</c>).</summary>
    public const string InfoGlyph = "\uE946";

    /// <summary>Segoe Fluent — Warning (web <c>AlertTriangle</c>).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent — Trackers (web <c>Target</c>).</summary>
    public const string TargetGlyph = "\uE9D9";

    /// <summary>Segoe Fluent — Temperature (web <c>Thermometer*</c>).</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c> / <c>Flame</c>).</summary>
    public const string LightningGlyph = "\uE945";

    /// <summary>Segoe Fluent — activity (web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — Lightbulb (web <c>Lightbulb</c>).</summary>
    public const string LightbulbGlyph = "\uEA80";

    /// <summary>Segoe Fluent — Forward (web <c>ArrowRight</c>).</summary>
    public const string ArrowGlyph = "\uE72A";

    /// <summary>The state-of-health gauge maximum (web <c>max={100}</c>).</summary>
    public const double GaugeMax = 100;

    /// <summary>The cycles gauge maximum (web <c>max={1500}</c>).</summary>
    public const double CyclesMax = 1500;

    /// <summary>The degradation gauge maximum (web <c>max={10}</c>).</summary>
    public const double DegradationMax = 10;

    /// <summary>The 80% warranty reference threshold (web <c>ReferenceLine y=80</c>).</summary>
    public const double WarrantyThreshold = 80;

    /// <summary>The 70% end-of-life reference threshold (web <c>ReferenceLine y=70</c>).</summary>
    public const double EndOfLifeThreshold = 70;

    private const string EmDash = "\u2014";
    private const string EnDash = "\u2013";
    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string DangerBrush = "TsColorDangerBrush";
    private const string InfoBrush = "TsColorInfoBrush";
    private const string AccentBrush = "TsColorAccentBrush";
    private const string TextPrimaryBrush = "TsColorTextPrimaryBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed four-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static BatteryHealthDisplay Project(
        BatteryHealthPageModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = BatteryHealthStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var h = snapshot.Health;

        BatteryHealthState state =
            model.Loading && !snapshot.HasData ? BatteryHealthState.Loading
            : model.ErrorDetail is not null ? BatteryHealthState.Error
            : !snapshot.HasData ? BatteryHealthState.Empty
            : BatteryHealthState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        double soh = h.CurrentSoh;
        (string badgeText, StatusKind badgeStatus) = HealthBadge(soh, s);
        bool trustworthy = ProjectionTrustworthy(snapshot.Forecast);
        string yearsTo80 = trustworthy ? Num1(snapshot.Forecast.Prediction!.YearsTo80Pct) : EmDash;

        return new BatteryHealthDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == BatteryHealthState.Loading,
            ShowError: state == BatteryHealthState.Error,
            ShowEmpty: state == BatteryHealthState.Empty,
            ShowContent: state == BatteryHealthState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyTitle: s.Title,
            EmptyMessage: s.Empty,
            Gauges: BuildGauges(h, s),
            HealthBadgeText: badgeText,
            HealthBadgeStatus: badgeStatus,
            YearsTo80Value: yearsTo80,
            YearsTo80Label: s.YearsTo80,
            WarrantyNote: s.WarrantyNote,
            MetricBars: BuildMetricBars(h, s),
            SummaryCards: BuildSummaryCards(h, snapshot.Thermal, s),
            ThermalTitle: s.ThermalTitle,
            ThermalCards: BuildThermalCards(snapshot.Thermal, units, s),
            InsightsTitle: s.InsightsTitle,
            Insights: BuildInsights(h, snapshot.Sessions, s),
            InsightsEmptyMessage: s.InsightsEmpty,
            CapacityTrend: BuildCapacityTrend(h, snapshot.Forecast, trustworthy, s, now),
            RangeTrend: BuildRangeTrend(h, units, s, now),
            ChargeDistTitle: s.ChartChargeDist,
            ChargeDistSubtitle: s.ChartChargeDistSub,
            ChargeDist: BuildChargeDist(snapshot.Sessions, s),
            NewVsNowTitle: s.NewVsNowTitle,
            NewVsNowCards: BuildNewVsNow(h, units, s),
            AcDc: BuildAcDc(h, snapshot.Sessions, s),
            QuickLinks: BuildQuickLinks(s),
            RecommendationsTitle: s.RecommendationsTitle,
            Recommendations: BuildRecommendations(h, s),
            SectionTitles: BuildSectionTitles(s),
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    /// <summary>Map a state-of-health score to its longevity badge (web <c>healthVariant</c> / <c>healthLabel</c>).</summary>
    public static (string Text, StatusKind Status) HealthBadge(double soh, BatteryHealthStrings s)
    {
        ArgumentNullException.ThrowIfNull(s);
        if (soh >= 90)
        {
            return (s.HealthExcellent, StatusKind.Success);
        }

        return soh >= 70 ? (s.HealthGood, StatusKind.Warning) : (s.HealthDegraded, StatusKind.Danger);
    }

    /// <summary>Map a state-of-health score to its gauge palette index (web <c>gaugeColor</c>: ≥90 / ≥70 / else).</summary>
    public static int GaugeColorIndex(double soh) => soh >= 90 ? 1 : soh >= 70 ? 3 : 5;

    /// <summary>Map a degradation rate to its semantic status (web <c>degradationColor</c>: ≤5 / ≤15 / else).</summary>
    public static StatusKind DegradationStatus(double pct) =>
        pct <= 5 ? StatusKind.Success : pct <= 15 ? StatusKind.Warning : StatusKind.Danger;

    /// <summary>Whether the degradation projection is trustworthy (web <c>projectionTrustworthy</c>).</summary>
    public static bool ProjectionTrustworthy(BatteryHealthForecast forecast)
    {
        ArgumentNullException.ThrowIfNull(forecast);
        var pred = forecast.Prediction;
        if (pred is null || !pred.HasEnoughData)
        {
            return false;
        }

        double slope = Math.Abs(pred.SlopePerYear);
        if (!IsFinite(slope) || slope > 50)
        {
            return false;
        }

        double yrs = pred.YearsTo80Pct;
        return IsFinite(yrs) && yrs > 0;
    }

    private static IReadOnlyList<HealthGaugeDisplay> BuildGauges(BatteryHealthAnalytics h, BatteryHealthStrings s)
    {
        double capacityPct = h.OriginalCapacity > 0
            ? Math.Clamp(h.EstimatedCapacity / h.OriginalCapacity * 100.0, 0, 100)
            : 0;

        return
        [
            Gauge(s.GaugeHealth, Safe(h.CurrentSoh), GaugeMax, "/100", GaugeColorIndex(h.CurrentSoh), 0),
            Gauge(s.GaugeCapacity, Safe(capacityPct), GaugeMax, "%", 0, 0),
            Gauge(s.GaugeDegradation, Safe(h.DegradationRateYr), DegradationMax, "%/yr", GaugeColorIndex(h.CurrentSoh) == 1 ? 1 : DegradationColorIndex(h.DegradationRateYr), 1),
            Gauge(s.GaugeCycles, Safe(h.TotalCycles), CyclesMax, string.Empty, 6, 0),
        ];
    }

    private static int DegradationColorIndex(double pct) => pct <= 5 ? 1 : pct <= 15 ? 3 : 5;

    private static HealthGaugeDisplay Gauge(string label, double value, double max, string unit, int colorIndex, int decimals) =>
        new(label, value, max, unit, colorIndex, decimals, $"{label}, {ScalarFormatters.FormatNumber(value, decimals)}{unit}");

    private static IReadOnlyList<HealthMetricBar> BuildMetricBars(BatteryHealthAnalytics h, BatteryHealthStrings s)
    {
        double capValue = h.OriginalCapacity > 0
            ? Math.Round(h.EstimatedCapacity / h.OriginalCapacity * 100.0, MidpointRounding.AwayFromZero)
            : 0;

        return
        [
            Bar(s.BarCapacity, capValue, 100, InfoBrush, $"{Num1(h.EstimatedCapacity)} / {Num1(h.OriginalCapacity)} kWh"),
            Bar(s.BarDegradation, Safe(h.DegradationRateYr), DegradationMax, StatusResources.AccentBrushKey(DegradationStatus(h.DegradationRateYr)), $"{Num2(h.DegradationRateYr)}% {s.PerYear}"),
            Bar(s.BarCycles, Safe(h.TotalCycles), CyclesMax, AccentBrush, s.WarrantyLimit),
        ];
    }

    private static HealthMetricBar Bar(string label, double value, double max, string accentBrushKey, string caption) =>
        new(label, value, max, accentBrushKey, caption, $"{label}, {ScalarFormatters.FormatNumber(value, 0)}");

    private static IReadOnlyList<HealthMetricCard> BuildSummaryCards(
        BatteryHealthAnalytics h, ChargeThermalLatest? thermal, BatteryHealthStrings s)
    {
        (string fullText, string fullBrush) = thermal?.BmsFullChargeComplete switch
        {
            null => (EmDash, InfoBrush),
            true => (s.CommonYes, SuccessBrush),
            false => (s.CommonNo, InfoBrush),
        };

        string ageValue = h.BatteryAgeMonths > 0 ? $"{Int0(h.BatteryAgeMonths)} {s.Months}" : EmDash;

        return
        [
            Card(s.MetricSoh, Pct2(h.CurrentSoh), HeartGlyph, InfoBrush),
            Card(s.MetricCurrentCap, $"{Num1(h.EstimatedCapacity)} kWh", BatteryGlyph, SuccessBrush),
            Card(s.MetricOriginalCap, $"{Num1(h.OriginalCapacity)} kWh", BatteryGlyph, InfoBrush),
            Card(s.MetricDegradation, $"{Num2(h.DegradationRateYr)}%/{s.Yr}", GaugeGlyph, WarningBrush),
            Card(s.MetricCycles, Int0(h.TotalCycles), RefreshGlyph, AccentBrush),
            Card(s.MetricAge, ageValue, ClockGlyph, DangerBrush),
            Card(s.MetricFullChargeComplete, fullText, CheckGlyph, fullBrush),
        ];
    }

    private static IReadOnlyList<HealthMetricCard> BuildThermalCards(
        ChargeThermalLatest? thermal, UnitPref units, BatteryHealthStrings s)
    {
        string tempUnit = UnitLabels.Label(units.Temperature);

        string maxValue = thermal?.ModuleTempMax is { } max
            ? $"{Num1(UnitConverters.TemperatureFromSi(max, units.Temperature))} {tempUnit}"
            : EmDash;
        string? maxSub = thermal?.NumModuleTempMax is { } nMax ? ModuleNumber(s, nMax) : null;

        string minValue = thermal?.ModuleTempMin is { } min
            ? $"{Num1(UnitConverters.TemperatureFromSi(min, units.Temperature))} {tempUnit}"
            : EmDash;
        string? minSub = thermal?.NumModuleTempMin is { } nMin ? ModuleNumber(s, nMin) : null;

        (string heaterText, string heaterBrush) = thermal?.BatteryHeaterOn switch
        {
            null => (EmDash, InfoBrush),
            true => (s.CommonOn, DangerBrush),
            false => (s.CommonOff, SuccessBrush),
        };

        string spreadValue = thermal?.ModuleTempMax is { } sMax && thermal?.ModuleTempMin is { } sMin
            ? $"{Num1(UnitConverters.TemperatureFromSi(sMax, units.Temperature) - UnitConverters.TemperatureFromSi(sMin, units.Temperature))} {tempUnit}"
            : EmDash;

        return
        [
            Card(s.ThermalModuleTempMax, maxValue, ThermometerGlyph, WarningBrush, maxSub),
            Card(s.ThermalModuleTempMin, minValue, ThermometerGlyph, InfoBrush, minSub),
            Card(s.ThermalHeater, heaterText, LightningGlyph, heaterBrush),
            Card(s.ThermalTempSpread, spreadValue, ActivityGlyph, AccentBrush),
        ];
    }

    private static string ModuleNumber(BatteryHealthStrings s, long n) =>
        s.ThermalModuleNumber.Replace("{{n}}", n.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);

    private static HealthMetricCard Card(string label, string value, string glyph, string accentBrushKey, string? sublabel = null) =>
        new(label, value, glyph, accentBrushKey, sublabel, sublabel is null ? $"{label}, {value}" : $"{label}, {value}, {sublabel}");

    private static List<HealthInsight> BuildInsights(
        BatteryHealthAnalytics h, IReadOnlyList<ChargeSessionSummary> sessions, BatteryHealthStrings s)
    {
        var items = new List<HealthInsight>();
        double soh = h.CurrentSoh;

        if (soh >= 90)
        {
            items.Add(Insight(CheckGlyph, s.InsightExcellentTitle, Soh(s.InsightExcellentDesc, soh), StatusKind.Success));
        }
        else if (soh >= 70)
        {
            items.Add(Insight(InfoGlyph, s.InsightGoodTitle, Soh(s.InsightGoodDesc, soh), StatusKind.Warning));
        }
        else
        {
            items.Add(Insight(WarningGlyph, s.InsightConcernTitle, Soh(s.InsightConcernDesc, soh), StatusKind.Danger));
        }

        if (h.FastChargePct > 50)
        {
            string desc = s.InsightHighFastChargeDesc.Replace("{{pct}}", Pct2(h.FastChargePct), StringComparison.Ordinal);
            items.Add(Insight(WarningGlyph, s.InsightHighFastChargeTitle, desc, StatusKind.Warning));
        }
        else
        {
            items.Add(Insight(CheckGlyph, s.InsightGoodHabitsTitle, s.InsightGoodHabitsDesc, StatusKind.Success));
        }

        int deepDischarges = sessions.Count(x => x.StartSocPct < 10);
        if (deepDischarges > 3)
        {
            string desc = s.InsightDeepDischargeDesc.Replace(
                "{{count}}", deepDischarges.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
            items.Add(Insight(WarningGlyph, s.InsightDeepDischargeTitle, desc, StatusKind.Warning));
        }

        int superchargerCount = sessions.Count(IsSupercharger);
        if (superchargerCount > sessions.Count * 0.6 && sessions.Count > 0)
        {
            string desc = s.InsightHighSuperchargerDesc.Replace(
                "{{count}}", superchargerCount.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);
            items.Add(Insight(InfoGlyph, s.InsightHighSuperchargerTitle, desc, StatusKind.Warning));
        }

        if (h.DegradationRateYr < 3)
        {
            string desc = s.InsightLowDegDesc.Replace("{{rate}}", Num1(h.DegradationRateYr), StringComparison.Ordinal);
            items.Add(Insight(TargetGlyph, s.InsightLowDegTitle, desc, StatusKind.Success));
        }

        return items;
    }

    private static string Soh(string template, double soh) =>
        template.Replace("{{soh}}", Int0(soh), StringComparison.Ordinal);

    private static HealthInsight Insight(string glyph, string title, string description, StatusKind status) =>
        new(glyph, title, description, status, $"{title}. {description}");

    private static CapacityTrendChart BuildCapacityTrend(
        BatteryHealthAnalytics h, BatteryHealthForecast forecast, bool trustworthy, BatteryHealthStrings s, DateTimeOffset now)
    {
        var rows = new List<TrendRow>(h.History.Count + 8);
        foreach (var point in h.History)
        {
            rows.Add(new TrendRow { Label = FormatDate(point.Date, now), Actual = point.SohPct });
        }

        int firstProjection = rows.Count;
        if (trustworthy)
        {
            foreach (var p in forecast.Prediction!.ProjectionPoints)
            {
                rows.Add(new TrendRow { Label = MonthLabel(p.Month), Predicted = p.Health });
            }
        }

        // Web parity: the first projected point picks up the last actual value so the two segments join.
        if (firstProjection > 0 && firstProjection < rows.Count)
        {
            rows[firstProjection].Actual = rows[firstProjection - 1].Actual;
        }

        var actual = new List<ChartPoint>();
        var predicted = new List<ChartPoint>();
        for (int i = 0; i < rows.Count; i++)
        {
            if (rows[i].Actual is { } a)
            {
                actual.Add(new ChartPoint(i, a, rows[i].Label));
            }

            if (rows[i].Predicted is { } p)
            {
                predicted.Add(new ChartPoint(i, p, rows[i].Label));
            }
        }

        var series = new List<ChartSeries>(2);
        if (actual.Count > 0)
        {
            series.Add(new ChartSeries(s.ChartActual, actual) { Kind = ChartSeriesKind.Area, Role = ChartRole.Battery });
        }

        if (predicted.Count > 0)
        {
            series.Add(new ChartSeries(s.ChartPredicted, predicted) { Kind = ChartSeriesKind.Line, Role = ChartRole.Battery });
        }

        var annotations = new List<ChartAnnotation>
        {
            new("eol", ChartAnnotationKind.HorizontalLine, EndOfLifeThreshold) { Role = ChartRole.Temperature },
            new("warranty", ChartAnnotationKind.HorizontalLine, WarrantyThreshold),
        };

        return new CapacityTrendChart(
            HasData: rows.Count > 0,
            Title: s.ChartCapacityTrend,
            Subtitle: s.ChartDashedProjected,
            AriaLabel: s.ChartCapacityTrendAria,
            Series: series,
            Annotations: annotations,
            EmptyMessage: s.ChartNoTrend);
    }

    private static RangeTrendChart BuildRangeTrend(
        BatteryHealthAnalytics h, UnitPref units, BatteryHealthStrings s, DateTimeOffset now)
    {
        var points = new List<ChartPoint>(h.History.Count);
        for (int i = 0; i < h.History.Count; i++)
        {
            double range = Math.Round(FromKm(h.History[i].RangeKm, units), MidpointRounding.AwayFromZero);
            points.Add(new ChartPoint(i, range, FormatDate(h.History[i].Date, now)));
        }

        bool hasData = points.Count > 0 && points.Exists(p => p.Y > 0);
        var series = hasData
            ? new List<ChartSeries>
            {
                new($"{s.ChartRange} ({UnitLabels.Label(units.Distance)})", points)
                {
                    Kind = ChartSeriesKind.Area,
                    Role = ChartRole.Battery,
                },
            }
            : [];

        return new RangeTrendChart(hasData, s.ChartRangeTrend, s.ChartRangeTrendAria, series, s.ChartNoRange);
    }

    private static ChargeDistChart BuildChargeDist(IReadOnlyList<ChargeSessionSummary> sessions, BatteryHealthStrings s)
    {
        if (sessions.Count == 0)
        {
            return new ChargeDistChart(false, [], [], s.ChartNoSessions);
        }

        var startCounts = new int[10];
        var endCounts = new int[10];
        foreach (var session in sessions)
        {
            int si = Math.Min((int)Math.Floor(session.StartSocPct / 10), 9);
            startCounts[Math.Max(0, si)]++;
            if (session.EndSocPct is { } end)
            {
                int ei = Math.Min((int)Math.Floor(end / 10), 9);
                endCounts[Math.Max(0, ei)]++;
            }
        }

        var startPoints = new List<ChartPoint>(10);
        var endPoints = new List<ChartPoint>(10);
        for (int i = 0; i < 10; i++)
        {
            string label = $"{i * 10}{EnDash}{i * 10 + 10}%";
            startPoints.Add(new ChartPoint(i, startCounts[i], label));
            endPoints.Add(new ChartPoint(i, endCounts[i], label));
        }

        var series = new List<ChartSeries>
        {
            new(s.ChartChargeStarted, startPoints) { Kind = ChartSeriesKind.Bar, ColorIndex = 5 },
            new(s.ChartChargeEnded, endPoints) { Kind = ChartSeriesKind.Bar, ColorIndex = 1 },
        };

        return new ChargeDistChart(true, series, BuildHabits(sessions, s), s.ChartNoSessions);
    }

    private static IReadOnlyList<HealthHabitStat> BuildHabits(
        IReadOnlyList<ChargeSessionSummary> sessions, BatteryHealthStrings s)
    {
        double avgStart = sessions.Count > 0 ? sessions.Average(x => x.StartSocPct) : 0;
        var endLevels = sessions.Where(x => x.EndSocPct is not null).Select(x => x.EndSocPct!.Value).ToList();
        double avgEnd = endLevels.Count > 0 ? endLevels.Average() : 80;
        int superchargerCount = sessions.Count(IsSupercharger);
        int dcFastCount = sessions.Count(x => x.ChargerType is { Length: > 0 } && !IsSupercharger(x));
        long home = sessions.Count - superchargerCount - dcFastCount;

        return
        [
            Habit(s.HabitAvgStart, Pct2(avgStart), TextPrimaryBrush),
            Habit(s.HabitAvgEnd, Pct2(avgEnd), SuccessBrush),
            Habit(s.HabitSupercharger, superchargerCount.ToString(CultureInfo.InvariantCulture), WarningBrush),
            Habit(s.HabitHome, home.ToString(CultureInfo.InvariantCulture), InfoBrush),
        ];
    }

    private static HealthHabitStat Habit(string label, string value, string accentBrushKey) =>
        new(label, value, accentBrushKey, $"{label}, {value}");

    private static IReadOnlyList<HealthNewVsNowCard> BuildNewVsNow(
        BatteryHealthAnalytics h, UnitPref units, BatteryHealthStrings s)
    {
        string distance = UnitLabels.Label(units.Distance);
        var history = h.History;

        string capNowDelta = $"-{Num1(h.OriginalCapacity - h.EstimatedCapacity)} kWh";

        string rangeNewValue = history.Count > 0 ? Int0(FromKm(history[0].RangeKm, units)) : EmDash;
        string rangeNowValue = history.Count > 0 ? Int0(FromKm(history[^1].RangeKm, units)) : EmDash;
        string? rangeNowDelta = history.Count >= 2
            ? $"-{Int0(FromKm(history[0].RangeKm - history[^1].RangeKm, units))} {distance} {s.NewVsNowLost}"
            : null;

        return
        [
            NewVsNow(s.NewVsNowCapNew, Num1(h.OriginalCapacity), "kWh", null, TextPrimaryBrush),
            NewVsNow(s.NewVsNowCapNow, Num1(h.EstimatedCapacity), "kWh", capNowDelta, InfoBrush),
            NewVsNow(s.NewVsNowRangeNew, rangeNewValue, distance, null, TextPrimaryBrush),
            NewVsNow(s.NewVsNowRangeNow, rangeNowValue, distance, rangeNowDelta, SuccessBrush),
        ];
    }

    private static HealthNewVsNowCard NewVsNow(string label, string value, string unit, string? delta, string accentBrushKey) =>
        new(label, value, unit, delta, accentBrushKey, delta is null ? $"{label}, {value} {unit}" : $"{label}, {value} {unit}, {delta}");

    private static AcDcChart BuildAcDc(
        BatteryHealthAnalytics h, IReadOnlyList<ChargeSessionSummary> sessions, BatteryHealthStrings s)
    {
        if (sessions.Count == 0)
        {
            return new AcDcChart(false, s.ChartAcdc, s.ChartAcdcAria, [], s.ChartNoBreakdown, s.StatsTitle, [], s.StatsEmpty);
        }

        double acEnergy = 0, dcEnergy = 0;
        int acCount = 0, dcCount = 0;
        foreach (var session in sessions)
        {
            bool isDc = session.ChargerType is { Length: > 0 } || (session.PeakPowerW is { } p && p > 20_000);
            double energy = UnitConverters.EnergyFromSi(Safe(session.TotalEnergyAddedWh), EnergyUnit.Kwh);
            if (isDc)
            {
                dcEnergy += energy;
                dcCount++;
            }
            else
            {
                acEnergy += energy;
                acCount++;
            }
        }

        var pieData = new List<ChartPoint>
        {
            new(0, Math.Round(acEnergy, 1), "AC"),
            new(1, Math.Round(dcEnergy, 1), "DC"),
        };

        double totalEnergy = acEnergy + dcEnergy;
        var stats = new List<HealthStatRow>
        {
            new(s.StatsTotalSessions, sessions.Count.ToString(CultureInfo.InvariantCulture)),
            new(s.StatsAcSessions, acCount.ToString(CultureInfo.InvariantCulture)),
            new(s.StatsDcSessions, dcCount.ToString(CultureInfo.InvariantCulture)),
            new(s.StatsTotalEnergy, $"{Num1(totalEnergy)} kWh"),
            new(s.StatsCycles, RawNumber(h.TotalCycles)),
        };

        return new AcDcChart(true, s.ChartAcdc, s.ChartAcdcAria, pieData, s.ChartNoBreakdown, s.StatsTitle, stats, s.StatsEmpty);
    }

    private static IReadOnlyList<HealthQuickLink> BuildQuickLinks(BatteryHealthStrings s) =>
    [
        QuickLink("/battery-cells", s.LinkCells),
        QuickLink("/battery-degradation", s.LinkDegradation),
        QuickLink("/energy-flow", s.LinkEnergyFlow),
        QuickLink("/projected-range", s.LinkProjectedRange),
        QuickLink("/vampire-drain", s.LinkVampireDrain),
        QuickLink("/sleep-efficiency", s.LinkSleepEfficiency),
    ];

    private static HealthQuickLink QuickLink(string route, string label) => new(route, label, label);

    private static List<string> BuildRecommendations(BatteryHealthAnalytics h, BatteryHealthStrings s)
    {
        var tips = new List<string>();
        if (h.FastChargePct > 30)
        {
            tips.Add(s.TipReduceFast);
        }

        if (h.FullChargePct > 40)
        {
            tips.Add(s.TipAvoid100);
        }

        if (h.AvgDepthOfDischarge > 70)
        {
            tips.Add(s.TipAvoidDeep);
        }

        if (h.DegradationRateYr > 3)
        {
            tips.Add(s.TipAboveAvg);
        }

        if (tips.Count == 0)
        {
            tips.Add(s.TipGreat);
        }

        return tips;
    }

    private static BatteryHealthSectionTitles BuildSectionTitles(BatteryHealthStrings s) => new(
        Hero: s.SectionHeroFailed,
        MetricBars: s.SectionMetricBarsFailed,
        SummaryCards: s.SectionSummaryCardsFailed,
        Thermal: s.SectionThermalFailed,
        Insights: s.SectionInsightsFailed,
        ChargeDist: s.SectionChargeDistFailed,
        CapacityRange: s.SectionCapacityRangeFailed,
        AcDc: s.SectionAcdcFailed,
        QuickLinks: s.SectionQuickLinksFailed,
        Recommendations: s.SectionRecommendationsFailed);

    private static bool IsSupercharger(ChargeSessionSummary session) =>
        session.ChargerType is { } type && type.Contains("tesla", StringComparison.OrdinalIgnoreCase);

    private static double FromKm(double km, UnitPref units) =>
        UnitConverters.DistanceFromSi(Safe(km) * 1000.0, units.Distance);

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

    private static string MonthLabel(string month) =>
        month.Length >= 7 ? month[..7] : (string.IsNullOrEmpty(month) ? EmDash : month);

    private static bool IsFinite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);

    private static double Safe(double value) => double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;

    private static string Num1(double value) => ScalarFormatters.FormatNumber(Safe(value), 1);

    private static string Num2(double value) => ScalarFormatters.FormatNumber(Safe(value), 2);

    private static string Int0(double value) => ScalarFormatters.FormatNumber(Safe(value), 0);

    private static string Pct2(double value) => ScalarFormatters.FormatPercentage(Safe(value), 2);

    private static string RawNumber(double value) => Safe(value).ToString("0.######", CultureInfo.InvariantCulture);

    // Mutable scratch row used while assembling the index-aligned capacity-trend series.
    private sealed class TrendRow
    {
        public string Label { get; init; } = string.Empty;

        public double? Actual { get; set; }

        public double? Predicted { get; init; }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>BatteryHealthPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a state-of-health value, capacity, cycle
/// count, range, temperature or charging behaviour — so a diagnostics line can never leak a user's battery
/// condition. Thread-safe.
/// </summary>
public sealed class BatteryHealthDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryHealthDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryHealthPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryHealthRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>BatteryHealthPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/battery/pages/BatteryHealthPage.tsx</c> (route <c>/battery</c>, nav name
/// <c>BatteryHealth</c>). Holds the route name, the four generated operation ids it binds to, the diagnostics
/// slug, the empty-surface glyph and the localized title.
/// </summary>
public static class BatteryHealthRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryHealthPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "BatteryHealth";

    /// <summary>The generated operation id for the battery-health analytics read (web <c>useBatteryHealthAnalytics</c>).</summary>
    public const string HealthOperation = Operations.Analytics.BatteryHealth;

    /// <summary>The generated operation id for the battery-degradation read (web <c>useBatteryDegradation</c>).</summary>
    public const string DegradationOperation = Operations.Analytics.BatteryDegradation;

    /// <summary>The generated operation id for the charging-sessions read (web <c>useChargingSessionsPaginated</c>).</summary>
    public const string SessionsOperation = Operations.Charging.Sessions;

    /// <summary>The generated operation id for the latest charging-telemetry read (web <c>useChargingTelemetryLatest</c>).</summary>
    public const string TelemetryLatestOperation = Operations.Charging.TelemetryLatest;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface.</summary>
    public const string EmptyGlyph = BatteryHealthProjection.BatteryGlyph;

    /// <summary>The localized page title (web <c>t('battery.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("battery.title", "Battery Health");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case battery-analytics / charging JSON wire shape (no camelCaseKeys
/// transform on native): numbers (or numeric strings), strings, booleans, longs and arrays of objects. Kept
/// internal to this surface so the page's parsers stay self-contained and never throw on a partial body.
/// </summary>
internal static class BatteryHealthJson
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

    /// <summary>Reads an integer property (truncating a numeric value), or null when absent / non-numeric.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        double? value = Double(obj, name);
        return value is { } d && IsFinite(d) ? (long)d : null;
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

    /// <summary>Reads a boolean property (true / false), or null when absent / non-boolean.</summary>
    public static bool? Bool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

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

    private static bool IsFinite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);
}
