using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="OptimizerSectionViewModel"/> can be in — the native
/// union of the branches the web charging Optimizer section renders
/// (web/src/features/charging/components/charging-list/OptimizerSection.tsx). The web component is a pure
/// child that receives a resolved <c>optimizer</c> prop; the native surface binds its own cache-then-network
/// read of <c>GET /analytics/charging-optimizer</c>, so it owns the full loading / loaded / empty / error /
/// stale / offline matrix the P2 state contract requires. Every value maps onto a visible surface (never a
/// blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render the savings
/// banner + habits + battery-score + cost-analysis + heatmap + recommendations composition (with the stale /
/// offline chip for the latter two), <see cref="Empty"/> renders the friendly empty state (web parity: the
/// parent never mounts the section when there is no optimizer body), <see cref="Loading"/> shows the skeleton
/// chrome and <see cref="Error"/> the retry affordance.
/// </summary>
public enum OptimizerSectionState
{
    /// <summary>Initial fetch with no cached optimizer body — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh optimizer body from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The query resolved with no optimizer body — render the friendly empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached body exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached body older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached body remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The colour tone a projected <see cref="OptimizerStatRow"/> value renders with — the native union of the
/// per-value Tailwind classes the web habits / cost-analysis rows use. Kept WinUI-free so the projection's
/// tone decisions are unit-tested headlessly; the view maps each tone onto a themed brush at render time
/// (<see cref="Primary"/> → primary text, <see cref="Muted"/> → secondary text, <see cref="Danger"/> /
/// <see cref="Success"/> → the danger / success status tokens).
/// </summary>
public enum OptimizerValueTone
{
    /// <summary>Primary text (web <c>text-white</c>) — the habit-metric values.</summary>
    Primary,

    /// <summary>Secondary / muted text (web <c>text-[var(--text-secondary)]</c>) — the peak/off-peak hour lists.</summary>
    Muted,

    /// <summary>Danger status (web <c>text-red-400</c>) — the peak rate and an over-threshold peak share.</summary>
    Danger,

    /// <summary>Success status (web <c>text-emerald-300</c>) — the off-peak rate and an in-threshold peak share.</summary>
    Success,
}

/// <summary>
/// The current-schedule slice of <c>GET /analytics/charging-optimizer</c> the web habits panel reads — the
/// native mirror of <c>OptimizerSchedule</c> (web/src/types/charging.ts). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial body never throws. WinUI-free so the parse is
/// unit-tested without a UI host.
/// </summary>
public sealed record OptimizerSectionSchedule(
    double AvgSessionsPerWeek,
    double HomeChargingPct,
    double AvgChargeToPct,
    int MostCommonStartHour,
    string MostCommonDay)
{
    /// <summary>The no-data schedule — the parse fallback for an absent / non-object <c>current_schedule</c>.</summary>
    public static OptimizerSectionSchedule Empty { get; } = new(0, 0, 0, 0, string.Empty);

    /// <summary>Project a <c>current_schedule</c> JSON object into a tolerant schedule slice.</summary>
    public static OptimizerSectionSchedule FromJson(JsonElement obj) => new(
        AvgSessionsPerWeek: OptimizerSectionJson.GetDouble(obj, "avg_sessions_per_week") ?? 0,
        HomeChargingPct: OptimizerSectionJson.GetDouble(obj, "home_charging_pct") ?? 0,
        AvgChargeToPct: OptimizerSectionJson.GetDouble(obj, "avg_charge_to_pct") ?? 0,
        MostCommonStartHour: OptimizerSectionJson.GetHour(obj, "most_common_start_hour"),
        MostCommonDay: OptimizerSectionJson.GetString(obj, "most_common_day") ?? string.Empty);
}

/// <summary>
/// The cost-analysis slice of <c>GET /analytics/charging-optimizer</c> the web cost panel + savings banner
/// read — the native mirror of <c>OptimizerCostAnalysis</c> (web/src/types/charging.ts). Field names mirror
/// the Go API's snake_case JSON tags; parsing is null-tolerant so a partial body never throws. WinUI-free so
/// the parse is unit-tested without a UI host.
/// </summary>
public sealed record OptimizerSectionCost(
    double PeakCostPerKwh,
    double OffpeakCostPerKwh,
    double SessionsDuringPeakPct,
    double PotentialMonthlySavings,
    IReadOnlyList<int> PeakHours,
    IReadOnlyList<int> OffpeakHours)
{
    /// <summary>The no-data cost slice — the parse fallback for an absent / non-object <c>cost_analysis</c>.</summary>
    public static OptimizerSectionCost Empty { get; } =
        new(0, 0, 0, 0, Array.Empty<int>(), Array.Empty<int>());

    /// <summary>Project a <c>cost_analysis</c> JSON object into a tolerant cost slice.</summary>
    public static OptimizerSectionCost FromJson(JsonElement obj) => new(
        PeakCostPerKwh: OptimizerSectionJson.GetDouble(obj, "peak_cost_per_kwh") ?? 0,
        OffpeakCostPerKwh: OptimizerSectionJson.GetDouble(obj, "offpeak_cost_per_kwh") ?? 0,
        SessionsDuringPeakPct: OptimizerSectionJson.GetDouble(obj, "sessions_during_peak_pct") ?? 0,
        PotentialMonthlySavings: OptimizerSectionJson.GetDouble(obj, "potential_monthly_savings") ?? 0,
        PeakHours: OptimizerSectionJson.GetHourArray(obj, "peak_hours"),
        OffpeakHours: OptimizerSectionJson.GetHourArray(obj, "offpeak_hours"));
}

/// <summary>
/// One smart-charging recommendation from <c>GET /analytics/charging-optimizer</c> — the native mirror of the
/// web <c>OptimizerRecommendation</c> (web/src/types/charging.ts). Field names mirror the Go API's snake_case
/// JSON tags (<c>priority</c>, <c>detail</c>, <c>estimated_savings</c>); parsing is null-tolerant so a partial
/// row never throws, and <see cref="Title"/>/<see cref="Detail"/> fall back to the em-dash.
/// </summary>
public sealed record OptimizerSectionRecommendation(
    string Type,
    string Priority,
    string Title,
    string Detail,
    double? EstimatedSavings)
{
    private const string EmDash = "\u2014";

    /// <summary>Project a single <c>recommendations[]</c> JSON object into a tolerant row.</summary>
    public static OptimizerSectionRecommendation FromJson(JsonElement obj) => new(
        Type: OptimizerSectionJson.GetString(obj, "type") ?? string.Empty,
        Priority: OptimizerSectionJson.GetString(obj, "priority") ?? string.Empty,
        Title: OptimizerSectionJson.GetString(obj, "title") ?? EmDash,
        Detail: OptimizerSectionJson.GetString(obj, "detail") ?? EmDash,
        EstimatedSavings: OptimizerSectionJson.GetDouble(obj, "estimated_savings"));
}

/// <summary>
/// The optimizer read-model the section consumes — the full <c>GET /analytics/charging-optimizer</c> object
/// body the web section reads (the <c>current_schedule</c> habits, the <c>cost_analysis</c> rates / savings,
/// the <c>battery_health_score</c>, the <c>recommendations</c> list and the <c>weekly_heatmap</c>). The
/// heatmap slice reuses the sibling <see cref="CostHeatmapReport"/> so the dense-grid colour maths stays in
/// one place. Parsing is tolerant so a partial or non-object body yields <see cref="Empty"/> rather than
/// throwing. <see cref="HasData"/> mirrors the web truthiness gate on the resolved <c>optimizer</c> prop.
/// </summary>
public sealed record OptimizerSectionReport(
    bool HasData,
    OptimizerSectionSchedule Schedule,
    OptimizerSectionCost Cost,
    double BatteryHealthScore,
    IReadOnlyList<OptimizerSectionRecommendation> Recommendations,
    CostHeatmapReport Heatmap)
{
    /// <summary>The no-data report — the parse fallback for an absent / non-object / empty body.</summary>
    public static OptimizerSectionReport Empty { get; } = new(
        HasData: false,
        Schedule: OptimizerSectionSchedule.Empty,
        Cost: OptimizerSectionCost.Empty,
        BatteryHealthScore: 0,
        Recommendations: Array.Empty<OptimizerSectionRecommendation>(),
        Heatmap: CostHeatmapReport.Empty);

    /// <summary>Project a <c>GET /analytics/charging-optimizer</c> JSON body into a tolerant report.</summary>
    public static OptimizerSectionReport FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.EnumerateObject().MoveNext())
        {
            // Web parity: the parent mounts the section only when the optimizer query resolved with a body.
            return Empty;
        }

        var schedule = OptimizerSectionJson.GetObject(element, "current_schedule");
        var cost = OptimizerSectionJson.GetObject(element, "cost_analysis");

        return new OptimizerSectionReport(
            HasData: true,
            Schedule: OptimizerSectionSchedule.FromJson(schedule),
            Cost: OptimizerSectionCost.FromJson(cost),
            BatteryHealthScore: OptimizerSectionJson.GetDouble(element, "battery_health_score") ?? 0,
            Recommendations: ParseRecommendations(element),
            Heatmap: CostHeatmapReport.FromJson(element));
    }

    private static IReadOnlyList<OptimizerSectionRecommendation> ParseRecommendations(JsonElement element)
    {
        if (!element.TryGetProperty("recommendations", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<OptimizerSectionRecommendation>();
        }

        var list = new List<OptimizerSectionRecommendation>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(OptimizerSectionRecommendation.FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>Null-tolerant JSON readers shared by the optimizer-section parse adapter (snake_case wire shape).</summary>
internal static class OptimizerSectionJson
{
    /// <summary>Read a nested object property, or a default (Undefined) element when absent.</summary>
    public static JsonElement GetObject(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.Object
            ? v
            : default;

    /// <summary>Read a tolerant string property (null when absent or not a string).</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object &&
        obj.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    /// <summary>Read a tolerant finite double property (null when absent / NaN / unparseable).</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Read a clock hour (clamped 0-24) from a tolerant number, defaulting to 0 (web <c>?? 0</c>).</summary>
    public static int GetHour(JsonElement obj, string name)
    {
        double? raw = GetDouble(obj, name);
        if (raw is not { } d)
        {
            return 0;
        }

        return Math.Clamp((int)Math.Round(d, MidpointRounding.AwayFromZero), 0, 24);
    }

    /// <summary>Read a tolerant array of clock hours (0-23), skipping non-numeric / out-of-range entries.</summary>
    public static IReadOnlyList<int> GetHourArray(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object ||
            !obj.TryGetProperty(name, out var arr) ||
            arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<int>();
        }

        var list = new List<int>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Number &&
                item.TryGetDouble(out var n) &&
                !double.IsNaN(n) && !double.IsInfinity(n))
            {
                int hour = (int)Math.Round(n, MidpointRounding.AwayFromZero);
                if (hour is >= 0 and <= 23)
                {
                    list.Add(hour);
                }
            }
        }

        return list;
    }
}

/// <summary>
/// One projected label/value row for the habits or cost-analysis panel — the native analogue of a single web
/// <c>flex items-center justify-between</c> row. Holds the localized label, the formatted value and the value
/// <see cref="Tone"/> (the web per-value text colour). Pure data so the projection is asserted headlessly.
/// </summary>
public sealed record OptimizerStatRow(string Label, string Value, OptimizerValueTone Tone);

/// <summary>
/// One projected, render-ready recommendation card — the native analogue of a single web recommendation
/// <c>div</c>. Holds the title (<c>rec.title</c>), the detail (<c>rec.detail</c>), the raw priority chip text
/// (web renders <c>rec.priority</c> verbatim), the priority <see cref="Status"/> (the web colour map), the
/// optional estimated-savings chip and a Narrator name. Pure data so the projection is asserted headlessly.
/// </summary>
public sealed record OptimizerRecommendationView(
    string Title,
    string Detail,
    string PriorityLabel,
    StatusKind Status,
    bool ShowSavings,
    string SavingsLabel,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Optimizer section — everything the web component computes
/// before returning JSX: the conditional savings banner, the habits rows, the battery-friendly score (value +
/// localized caption + status), the cost-analysis rows, the (reused) heatmap display and the recommendation
/// cards (or the friendly empty message). Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record OptimizerSectionDisplay(
    bool HasData,
    bool ShowSavingsBanner,
    string SavingsBannerTitle,
    string SavingsBannerMessage,
    string HabitsTitle,
    IReadOnlyList<OptimizerStatRow> HabitRows,
    string BatteryScoreTitle,
    double BatteryHealthScore,
    string BatteryScoreCaption,
    StatusKind BatteryScoreStatus,
    string CostAnalysisTitle,
    IReadOnlyList<OptimizerStatRow> CostRows,
    bool ShowHeatmap,
    CostHeatmapDisplay Heatmap,
    string RecommendationsTitle,
    bool HasRecommendations,
    IReadOnlyList<OptimizerRecommendationView> Recommendations,
    string NoRecommendationsMessage,
    string EmptyMessage,
    string AriaLabel)
{
    /// <summary>An all-empty display (the friendly empty state) for the loading / empty fallback.</summary>
    public static OptimizerSectionDisplay Empty(ILocalizer localizer) =>
        OptimizerSectionProjection.Project(OptimizerSectionReport.Empty, localizer);
}

/// <summary>
/// Pure projection from a parsed <see cref="OptimizerSectionReport"/> to an <see cref="OptimizerSectionDisplay"/>
/// — the native port of the render logic in
/// web/src/features/charging/components/charging-list/OptimizerSection.tsx. It gates the savings banner on the
/// web <c>potential_monthly_savings &gt; 5</c>, formats the habit + cost rows (with the web per-value colour
/// tones), derives the battery-friendly score band + caption (web <c>&gt;= 75</c> / <c>&gt;= 50</c>
/// thresholds), reuses <see cref="CostHeatmapProjection"/> for the weekly heatmap and projects every
/// recommendation card. Every label resolves through the i18n facade. WinUI-free — unit-tested without a UI
/// host.
/// </summary>
public static class OptimizerSectionProjection
{
    /// <summary>The minimum monthly savings that surfaces the banner (web <c>&gt; 5</c>).</summary>
    public const double SavingsBannerThreshold = 5;

    /// <summary>At/above this battery-friendly score the habits are "battery-friendly" (web <c>&gt;= 75</c>).</summary>
    public const double ScoreGoodThreshold = 75;

    /// <summary>At/above this score there is "room for improvement" (web <c>&gt;= 50</c>); below is "poor".</summary>
    public const double ScoreFairThreshold = 50;

    /// <summary>The peak-share above which the cost row turns danger-coloured (web <c>&gt; 30</c>).</summary>
    public const double PeakShareDangerThreshold = 30;

    private const string EmDash = "\u2014";
    private const string CurrencySymbol = "$";
    private const int RateDecimals = 3;

    /// <summary>Project <paramref name="report"/> using <paramref name="localizer"/> for every label.</summary>
    /// <param name="report">The parsed optimizer read-model.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static OptimizerSectionDisplay Project(OptimizerSectionReport report, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(localizer);

        double savings = report.Cost.PotentialMonthlySavings;
        bool showBanner = savings > SavingsBannerThreshold;
        string bannerTitle = Fill(
            localizer.GetString("charging.optimizer.savingsBanner", "Save ~${0}/month by adjusting your charging schedule"),
            ScalarFormatters.FormatNumber(savings, 0));
        string bannerMessage = localizer.GetString(
            "charging.optimizer.savingsDetail",
            "Based on your charging patterns, shifting to off-peak hours could reduce your monthly costs.");

        var habitRows = BuildHabitRows(report.Schedule, localizer);
        var costRows = BuildCostRows(report.Cost, localizer);

        double score = report.BatteryHealthScore;
        var (captionKey, captionFallback, scoreStatus) = score >= ScoreGoodThreshold
            ? ("charging.optimizer.scoreGood", "Your habits are battery-friendly", StatusKind.Success)
            : score >= ScoreFairThreshold
                ? ("charging.optimizer.scoreFair", "Room for improvement", StatusKind.Warning)
                : ("charging.optimizer.scorePoor", "Consider adjusting your habits", StatusKind.Danger);

        var heatmap = CostHeatmapProjection.Project(report.Heatmap, localizer);
        var recommendations = BuildRecommendations(report.Recommendations, localizer);

        return new OptimizerSectionDisplay(
            HasData: report.HasData,
            ShowSavingsBanner: showBanner,
            SavingsBannerTitle: bannerTitle,
            SavingsBannerMessage: bannerMessage,
            HabitsTitle: localizer.GetString("charging.optimizer.habits", "Charging Habits"),
            HabitRows: habitRows,
            BatteryScoreTitle: localizer.GetString("charging.optimizer.batteryScore", "Battery-Friendly Score"),
            BatteryHealthScore: score,
            BatteryScoreCaption: localizer.GetString(captionKey, captionFallback),
            BatteryScoreStatus: scoreStatus,
            CostAnalysisTitle: localizer.GetString("charging.optimizer.costAnalysis", "Cost Analysis"),
            CostRows: costRows,
            ShowHeatmap: report.Heatmap.HasData,
            Heatmap: heatmap,
            RecommendationsTitle: localizer.GetString("charging.optimizer.recommendations", "Optimization Recommendations"),
            HasRecommendations: recommendations.Count > 0,
            Recommendations: recommendations,
            NoRecommendationsMessage: localizer.GetString("charging.optimizer.noRecs", "Recommendations will appear after more charging sessions."),
            EmptyMessage: localizer.GetString("common.noData", "No data available"),
            AriaLabel: localizer.GetString("widget.chargingOptimizer.title", "Charging Optimizer"));
    }

    private static OptimizerStatRow[] BuildHabitRows(
        OptimizerSectionSchedule schedule,
        ILocalizer localizer)
    {
        string day = string.IsNullOrEmpty(schedule.MostCommonDay) ? EmDash : schedule.MostCommonDay;
        return new[]
        {
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.sessionsWeek", "Sessions/week"),
                ScalarFormatters.FormatNumber(schedule.AvgSessionsPerWeek, 1),
                OptimizerValueTone.Primary),
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.homePct", "Home charging"),
                ScalarFormatters.FormatPercentage(schedule.HomeChargingPct, 0),
                OptimizerValueTone.Primary),
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.avgTarget", "Avg charge target"),
                ScalarFormatters.FormatPercentage(schedule.AvgChargeToPct, 0),
                OptimizerValueTone.Primary),
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.commonHour", "Common start hour"),
                FormatHour(schedule.MostCommonStartHour),
                OptimizerValueTone.Primary),
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.commonDay", "Most common"),
                day,
                OptimizerValueTone.Primary),
        };
    }

    private static OptimizerStatRow[] BuildCostRows(OptimizerSectionCost cost, ILocalizer localizer)
    {
        var peakShareTone = cost.SessionsDuringPeakPct > PeakShareDangerThreshold
            ? OptimizerValueTone.Danger
            : OptimizerValueTone.Success;

        return new[]
        {
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.peakRate", "Peak rate"),
                RatePerKwh(cost.PeakCostPerKwh),
                OptimizerValueTone.Danger),
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.offpeakRate", "Off-peak rate"),
                RatePerKwh(cost.OffpeakCostPerKwh),
                OptimizerValueTone.Success),
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.peakSessions", "Sessions during peak"),
                ScalarFormatters.FormatPercentage(cost.SessionsDuringPeakPct, 0),
                peakShareTone),
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.peakHours", "Peak hours"),
                FormatHours(cost.PeakHours),
                OptimizerValueTone.Muted),
            new OptimizerStatRow(
                localizer.GetString("charging.optimizer.offpeakHours", "Off-peak hours"),
                FormatHours(cost.OffpeakHours),
                OptimizerValueTone.Muted),
        };
    }

    private static IReadOnlyList<OptimizerRecommendationView> BuildRecommendations(
        IReadOnlyList<OptimizerSectionRecommendation> recommendations,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        if (recommendations.Count == 0)
        {
            return Array.Empty<OptimizerRecommendationView>();
        }

        var list = new List<OptimizerRecommendationView>(recommendations.Count);
        foreach (var rec in recommendations)
        {
            bool showSavings = rec.EstimatedSavings is { } s && s > 0;
            string savingsLabel = showSavings
                ? string.Create(
                    CultureInfo.CurrentCulture,
                    $"~{ScalarFormatters.FormatCurrency(rec.EstimatedSavings, CurrencySymbol, 0)}/mo")
                : string.Empty;

            string automation = string.IsNullOrEmpty(rec.Priority)
                ? string.Format(CultureInfo.CurrentCulture, "{0}. {1}", rec.Title, rec.Detail)
                : string.Format(CultureInfo.CurrentCulture, "{0}: {1}. {2}", rec.Priority, rec.Title, rec.Detail);
            if (showSavings)
            {
                automation = string.Format(CultureInfo.CurrentCulture, "{0} {1}", automation, savingsLabel);
            }

            list.Add(new OptimizerRecommendationView(
                Title: rec.Title,
                Detail: rec.Detail,
                PriorityLabel: rec.Priority,
                Status: RecommendationStatus(rec.Priority),
                ShowSavings: showSavings,
                SavingsLabel: savingsLabel,
                AutomationName: automation));
        }

        return list;
    }

    /// <summary>
    /// The web recommendation colour map applied to a priority: high → danger (red), medium → warning (amber),
    /// low (and anything else) → success (green). Drives the card border / icon / chip tint.
    /// </summary>
    public static StatusKind RecommendationStatus(string priority) => priority switch
    {
        "high" => StatusKind.Danger,
        "medium" => StatusKind.Warning,
        _ => StatusKind.Success,
    };

    /// <summary>The web habit clock readout: <c>{hour}:00</c>.</summary>
    public static string FormatHour(int hour) =>
        string.Create(CultureInfo.InvariantCulture, $"{hour}:00");

    /// <summary>The web hour-list readout: <c>h:00</c> joined by ", ", or the em-dash when empty.</summary>
    public static string FormatHours(IReadOnlyList<int> hours)
    {
        if (hours.Count == 0)
        {
            return EmDash;
        }

        return string.Join(", ", hours.Select(h => string.Create(CultureInfo.InvariantCulture, $"{h}:00")));
    }

    private static string RatePerKwh(double value) => string.Create(
        CultureInfo.CurrentCulture,
        $"{ScalarFormatters.FormatCurrency(value, CurrencySymbol, RateDecimals)}/kWh");

    /// <summary>Substitute the single token slot of a localized template (resw <c>{0}</c> or web <c>{{amount}}</c>).</summary>
    private static string Fill(string template, string value) => template
        .Replace("{{amount}}", value, StringComparison.Ordinal)
        .Replace("{0}", value, StringComparison.Ordinal);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;OptimizerSectionReport&gt;</c>, preserving every freshness flag (cached / refreshing
/// / stale / offline) so the view-model can render the full state matrix. A resolved body with no optimizer
/// data collapses to <see cref="RepositoryResult{T}.Empty"/> so the view shows the friendly empty state (web
/// parity — the parent never mounts the section). Pure so the parse-and-preserve contract is unit-tested
/// without a network or cache.
/// </summary>
public static class OptimizerSectionResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<OptimizerSectionReport> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        OptimizerSectionReport Parse() =>
            raw.HasValue ? OptimizerSectionReport.FromJson(raw.Value) : OptimizerSectionReport.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<OptimizerSectionReport>.Loading(),
            LoadStatus.Cached => RepositoryResult<OptimizerSectionReport>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<OptimizerSectionReport>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<OptimizerSectionReport>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<OptimizerSectionReport>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<OptimizerSectionReport>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<OptimizerSectionReport> ToLoadedOrEmpty(
        OptimizerSectionReport report,
        DateTimeOffset? fetchedAt)
        => report.HasData
            ? RepositoryResult<OptimizerSectionReport>.Loaded(report, fetchedAt ?? DateTimeOffset.UtcNow)
            : RepositoryResult<OptimizerSectionReport>.Empty(fetchedAt);
}

/// <summary>
/// Canonical metadata for the Optimizer-section feature surface — the native mirror of the web component at
/// web/src/features/charging/components/charging-list/OptimizerSection.tsx. The surface reads the same
/// <c>GET /analytics/charging-optimizer</c> payload the web charging-list optimizer section consumes.
/// </summary>
public static class OptimizerSectionRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "optimizer-section";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (per the P2 prompt).</summary>
    public const string Slug = "OptimizerSection";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.chargingOptimizer.title", "Charging Optimizer");
    }
}

/// <summary>
/// PII-safe diagnostics for the Optimizer-section surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a savings figure, charge target, score
/// or vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class OptimizerSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public OptimizerSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=OptimizerSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={OptimizerSectionRegistration.Slug}");
    }
}
