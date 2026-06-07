using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="ChargingOptimizerViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>ChargingOptimizerWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>!data</c> gate (the optimizer
/// query resolved with no body) rather than an absent HTTP response.
/// </summary>
public enum ChargingOptimizerState
{
    /// <summary>Initial fetch with no cached optimizer body — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh optimizer body from the network (or non-stale cache).</summary>
    Loaded,

    /// <summary>The query resolved with no optimizer body — render the friendly "No optimizer data" state.</summary>
    Empty,

    /// <summary>The request failed and no cached body exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached body older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached body remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One smart-charging recommendation from <c>GET /analytics/charging-optimizer</c> (the web
/// <c>OptimizerRecommendation</c>, web/src/types/charging.ts). Field names mirror the Go API's snake_case
/// JSON tags (<c>priority</c>, <c>detail</c>, <c>estimated_savings</c>); parsing is null-tolerant so a
/// partial row never throws. <see cref="Title"/>/<see cref="Detail"/> fall back to the em-dash exactly as
/// the web component does (<c>rec.title ?? '—'</c>).
/// </summary>
public sealed record OptimizerRecommendation(
    string Type,
    string Priority,
    string Title,
    string Detail,
    double? EstimatedSavings)
{
    private const string EmDash = "\u2014";

    /// <summary>Project a single <c>recommendations[]</c> JSON object into a tolerant row.</summary>
    public static OptimizerRecommendation FromJson(JsonElement obj) => new(
        Type: OptimizerJson.GetString(obj, "type") ?? string.Empty,
        Priority: OptimizerJson.GetString(obj, "priority") ?? string.Empty,
        Title: OptimizerJson.GetString(obj, "title") ?? EmDash,
        Detail: OptimizerJson.GetString(obj, "detail") ?? EmDash,
        EstimatedSavings: OptimizerJson.GetDouble(obj, "estimated_savings"));
}

/// <summary>
/// The optimizer read-model the widget consumes — the subset of the
/// <c>GET /analytics/charging-optimizer</c> object body the web component actually reads
/// (<c>current_schedule.most_common_start_hour</c> / <c>avg_charge_to_pct</c>,
/// <c>cost_analysis.potential_monthly_savings</c> / <c>sessions_during_peak_pct</c> / <c>peak_hours</c> /
/// <c>offpeak_hours</c>, and <c>recommendations</c>; the sibling <c>battery_health_score</c> /
/// <c>weekly_heatmap</c> fields are not surfaced by this widget). Parsing is tolerant so a partial or
/// non-object body yields <see cref="Empty"/> rather than throwing. <see cref="HasData"/> mirrors the web
/// <c>!data</c> truthiness gate.
/// </summary>
public sealed record ChargingOptimizerReport(
    bool HasData,
    int OptimalStartHour,
    double TargetSocPct,
    double MonthlySavings,
    double PeakPct,
    IReadOnlyList<int> PeakHours,
    IReadOnlyList<int> OffpeakHours,
    IReadOnlyList<OptimizerRecommendation> Recommendations)
{
    /// <summary>The no-data report — the parse fallback for an absent/non-object/empty body.</summary>
    public static ChargingOptimizerReport Empty { get; } = new(
        HasData: false,
        OptimalStartHour: 0,
        TargetSocPct: 0,
        MonthlySavings: 0,
        PeakPct: 0,
        PeakHours: Array.Empty<int>(),
        OffpeakHours: Array.Empty<int>(),
        Recommendations: Array.Empty<OptimizerRecommendation>());

    /// <summary>
    /// True when the optimizer schedule is already off-peak-aligned — the web
    /// <c>scheduleMatchesOptimal = peakPct &lt; 30</c> gate that drives the "Optimized" vs "Can improve"
    /// badge.
    /// </summary>
    public bool ScheduleMatchesOptimal => PeakPct < 30;

    /// <summary>Project a <c>GET /analytics/charging-optimizer</c> JSON body into a tolerant report.</summary>
    public static ChargingOptimizerReport FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.EnumerateObject().MoveNext())
        {
            // Web parity: `!data` — an absent or empty body renders the "No optimizer data" empty state.
            return Empty;
        }

        var schedule = OptimizerJson.GetObject(element, "current_schedule");
        var cost = OptimizerJson.GetObject(element, "cost_analysis");

        return new ChargingOptimizerReport(
            HasData: true,
            OptimalStartHour: OptimizerJson.GetHour(schedule, "most_common_start_hour"),
            TargetSocPct: OptimizerJson.GetDouble(schedule, "avg_charge_to_pct") ?? 0,
            MonthlySavings: OptimizerJson.GetDouble(cost, "potential_monthly_savings") ?? 0,
            PeakPct: OptimizerJson.GetDouble(cost, "sessions_during_peak_pct") ?? 0,
            PeakHours: OptimizerJson.GetHourArray(cost, "peak_hours"),
            OffpeakHours: OptimizerJson.GetHourArray(cost, "offpeak_hours"),
            Recommendations: ParseRecommendations(element));
    }

    private static IReadOnlyList<OptimizerRecommendation> ParseRecommendations(JsonElement element)
    {
        if (!element.TryGetProperty("recommendations", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<OptimizerRecommendation>();
        }

        var list = new List<OptimizerRecommendation>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(OptimizerRecommendation.FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>Null-tolerant JSON readers shared by the optimizer parse adapter (snake_case wire shape).</summary>
internal static class OptimizerJson
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

    /// <summary>Read a clock hour (0-23) from a tolerant number, defaulting to 0 (web <c>?? 0</c>).</summary>
    public static int GetHour(JsonElement obj, string name)
    {
        double? raw = GetDouble(obj, name);
        if (raw is not { } d)
        {
            return 0;
        }

        int hour = (int)Math.Round(d, MidpointRounding.AwayFromZero);
        return Math.Clamp(hour, 0, 24);
    }

    /// <summary>Read a tolerant array of clock hours, skipping non-numeric / out-of-range entries.</summary>
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> branches in
/// web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx.
/// </summary>
public readonly record struct ChargingOptimizerSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static ChargingOptimizerSize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): the big-number layout.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at four columns (web <c>isWide = size.cols &gt;= 4</c>): adds the 24h rate timeline.</summary>
    public bool IsWide => Cols >= 4;
}

/// <summary>The rate band a single hour of the 24h timeline falls into (web peak / off-peak / standard fill).</summary>
public enum OptimizerRateKind
{
    /// <summary>Neither peak nor off-peak (web <c>bg-white/[0.04]</c>).</summary>
    Standard,

    /// <summary>A peak-rate hour (web <c>bg-red-500/30</c>).</summary>
    Peak,

    /// <summary>An off-peak-rate hour (web <c>bg-emerald-500/30</c>).</summary>
    Offpeak,
}

/// <summary>
/// One projected metric tile for the standard layout — the native analogue of a web key-metric cell
/// (Optimal start / Target SOC / Savings/mo). Holds the resolved glyph + accent brush key (the icon
/// colour), the formatted value, the caption label and a Narrator automation name. Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record OptimizerMetric(
    string Glyph,
    string AccentBrushKey,
    string Value,
    string Label,
    string AutomationName);

/// <summary>
/// One projected, display-ready recommendation tip consumed by the WinUI view — the native analogue of a
/// web <c>TipItem</c> (the <c>tips</c> <c>useMemo</c> in the web component). Holds the Sparkles glyph +
/// secondary accent brush key, the title (<c>rec.title</c>), the description (<c>rec.detail</c>), and the
/// optional priority-coloured impact badge (the web <c>impactBadgeMap</c>) plus a Narrator name.
/// </summary>
public sealed record OptimizerTip(
    string Id,
    string Glyph,
    string IconBrushKey,
    string Title,
    string Description,
    bool HasImpact,
    string ImpactLabel,
    StatusKind ImpactStatus,
    string AutomationName);

/// <summary>
/// One hour-cell of the wide-layout 24h rate timeline — the native analogue of a single web timeline
/// <c>&lt;div&gt;</c> (web <c>Array.from({ length: 24 })</c>). Holds the hour, its rate band, whether the
/// optimal-start <c>Zap</c> marker overlays it, and the composed tooltip/Narrator label
/// (<c>{hour} — {Peak|Off-peak|Standard}</c>).
/// </summary>
public sealed record OptimizerHourSegment(
    int Hour,
    OptimizerRateKind Kind,
    bool IsCurrentStart,
    string Label);

/// <summary>
/// The fully projected, render-ready view of the optimizer body for one footprint — the native analogue
/// of everything the web component computes before returning JSX. Holds the compact big-number trio, the
/// three standard metric tiles, the schedule-match badge, the 24h timeline segments, and the
/// recommendation tips. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargingOptimizerDisplay(
    bool IsCompact,
    bool IsWide,
    bool HasData,
    string OptimalStartText,
    string TargetSocShortText,
    string SavingsShortText,
    bool ShowSavingsBadge,
    OptimizerMetric OptimalStartMetric,
    OptimizerMetric TargetSocMetric,
    OptimizerMetric SavingsMetric,
    string PeakUsageText,
    bool ScheduleMatchesOptimal,
    string ScheduleBadgeText,
    StatusKind ScheduleBadgeStatus,
    string RateTimelineLabel,
    IReadOnlyList<OptimizerHourSegment> Segments,
    IReadOnlyList<OptimizerTip> Tips,
    int MaxTips,
    string NoRecommendationsMessage,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ChargingOptimizerReport"/> to the display model — the native port
/// of the rendering logic in web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx. Formats the
/// optimal hour (the web <c>formatHour</c> 12-hour clock), the target SOC, the monthly savings, the
/// schedule-match badge, the 24h rate timeline and the recommendation tips; every label resolves through
/// the i18n facade. Kept UI-free so each branch is unit-tested without a XAML runtime.
/// </summary>
public static class ChargingOptimizerProjection
{
    /// <summary>Tips rendered in the standard (non-wide) layout, mirroring the web <c>maxTips={3}</c>.</summary>
    public const int MaxStandardTips = 3;

    /// <summary>Tips rendered in the wide layout, mirroring the web <c>maxTips={5}</c>.</summary>
    public const int MaxWideTips = 5;

    /// <summary>Segoe Fluent — Lightbulb (web Sparkles): the header, empty and tip icon.</summary>
    public const string SparklesGlyph = "\uEA80";

    /// <summary>Segoe Fluent — Recent / clock (web Clock): the optimal-start tile.</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent — Battery (web BatteryCharging): the target-SOC tile.</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent — money (web DollarSign): the savings tile.</summary>
    public const string DollarGlyph = "\uE1D3";

    /// <summary>Segoe Fluent — LightningBolt (web Zap): the optimal-start timeline marker.</summary>
    public const string ZapGlyph = "\uE945";

    private const string OptimalStartBrushKey = "TsColorSuccessBrush"; // web text-emerald-400
    private const string TargetSocBrushKey = "TsColorInfoBrush";       // web text-blue-400
    private const string SavingsBrushKey = "TsColorWarningBrush";      // web text-amber-400
    private const string TipBrushKey = "TsColorTextSecondaryBrush";    // web text-[var(--text-secondary)]

    /// <summary>Project <paramref name="report"/> for <paramref name="size"/> using <paramref name="localizer"/>.</summary>
    public static ChargingOptimizerDisplay Project(
        ChargingOptimizerReport report,
        ChargingOptimizerSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(localizer);

        string optimalStart = FormatHour(report.OptimalStartHour);
        string socInt = ScalarFormatters.FormatNumber(report.TargetSocPct, 0);
        string socPct = ScalarFormatters.FormatPercentage(report.TargetSocPct, 0);
        string savingsAmount = ScalarFormatters.FormatNumber(report.MonthlySavings, 0);
        string savingsValue = ScalarFormatters.FormatCurrency(report.MonthlySavings, "$", 0);
        string peakInt = ScalarFormatters.FormatNumber(report.PeakPct, 0);

        string optimalStartLabel = localizer.GetString("widget.chargingOptimizer.optimalStart", "Optimal start");
        string targetSocLabel = localizer.GetString("widget.chargingOptimizer.targetSoc", "Target SOC");
        string savingsLabel = localizer.GetString("widget.chargingOptimizer.savingsLabel", "Savings/mo");

        string targetSocShort = Fill(
            localizer.GetString("widget.chargingOptimizer.targetSocShort", "SOC {0}%"), socInt);
        string savingsShort = Fill(
            localizer.GetString("widget.chargingOptimizer.savingsShort", "${0}/mo"), savingsAmount);
        string peakUsage = Fill(
            localizer.GetString("widget.chargingOptimizer.peakUsage", "Peak charging: {0}%"), peakInt);

        bool optimized = report.ScheduleMatchesOptimal;
        string scheduleBadge = optimized
            ? localizer.GetString("widget.chargingOptimizer.optimized", "Optimized")
            : localizer.GetString("widget.chargingOptimizer.canImprove", "Can improve");

        var optimalStartMetric = new OptimizerMetric(
            Glyph: ClockGlyph,
            AccentBrushKey: OptimalStartBrushKey,
            Value: optimalStart,
            Label: optimalStartLabel,
            AutomationName: Compose(optimalStartLabel, optimalStart));

        var targetSocMetric = new OptimizerMetric(
            Glyph: BatteryGlyph,
            AccentBrushKey: TargetSocBrushKey,
            Value: socPct,
            Label: targetSocLabel,
            AutomationName: Compose(targetSocLabel, socPct));

        var savingsMetric = new OptimizerMetric(
            Glyph: DollarGlyph,
            AccentBrushKey: SavingsBrushKey,
            Value: savingsValue,
            Label: savingsLabel,
            AutomationName: Compose(savingsLabel, savingsValue));

        var tips = BuildTips(report.Recommendations, localizer);
        var segments = BuildTimeline(report, localizer);

        string compactName = string.Format(
            CultureInfo.CurrentCulture, "{0}, {1}", optimalStartMetric.AutomationName, targetSocShort);
        if (report.MonthlySavings > 0)
        {
            compactName = string.Format(CultureInfo.CurrentCulture, "{0}, {1}", compactName, savingsShort);
        }

        return new ChargingOptimizerDisplay(
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            HasData: report.HasData,
            OptimalStartText: optimalStart,
            TargetSocShortText: targetSocShort,
            SavingsShortText: savingsShort,
            ShowSavingsBadge: report.MonthlySavings > 0,
            OptimalStartMetric: optimalStartMetric,
            TargetSocMetric: targetSocMetric,
            SavingsMetric: savingsMetric,
            PeakUsageText: peakUsage,
            ScheduleMatchesOptimal: optimized,
            ScheduleBadgeText: scheduleBadge,
            ScheduleBadgeStatus: optimized ? StatusKind.Success : StatusKind.Warning,
            RateTimelineLabel: localizer.GetString("widget.chargingOptimizer.rateTimeline", "24h Rate Timeline"),
            Segments: segments,
            Tips: tips,
            MaxTips: size.IsWide ? MaxWideTips : MaxStandardTips,
            NoRecommendationsMessage: localizer.GetString("widget.chargingOptimizer.noRecommendations", "No recommendations"),
            CompactAutomationName: compactName);
    }

    /// <summary>
    /// The web component's local <c>formatHour</c>: hour 0/24 → "12 AM", 12 → "12 PM", &lt;12 → "{h} AM",
    /// otherwise "{h-12} PM". The AM/PM strings are not localized in the web source, so they are kept
    /// verbatim here for parity.
    /// </summary>
    public static string FormatHour(int hour)
    {
        if (hour is 0 or 24)
        {
            return "12 AM";
        }

        if (hour == 12)
        {
            return "12 PM";
        }

        return hour < 12
            ? string.Create(CultureInfo.InvariantCulture, $"{hour} AM")
            : string.Create(CultureInfo.InvariantCulture, $"{hour - 12} PM");
    }

    /// <summary>
    /// The web <c>impactBadgeMap</c> applied to a recommendation priority: high → success, medium →
    /// warning, low (and anything else recognised) → neutral. Drives the tip badge tint.
    /// </summary>
    public static StatusKind ImpactBadgeStatus(string priority) => priority switch
    {
        "high" => StatusKind.Success,
        "medium" => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>True when <paramref name="priority"/> is one of the recognised web impact levels.</summary>
    public static bool IsKnownPriority(string priority) =>
        priority is "high" or "medium" or "low";

    /// <summary>Build the off-peak/peak/standard 24h timeline with the optimal-start marker overlaid.</summary>
    public static IReadOnlyList<OptimizerHourSegment> BuildTimeline(
        ChargingOptimizerReport report,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(localizer);

        var peak = new HashSet<int>(report.PeakHours);
        var offpeak = new HashSet<int>(report.OffpeakHours);
        var segments = new OptimizerHourSegment[24];
        for (int h = 0; h < 24; h++)
        {
            // Web precedence: peak wins over off-peak when an hour is (erroneously) in both sets.
            var kind = peak.Contains(h)
                ? OptimizerRateKind.Peak
                : offpeak.Contains(h)
                    ? OptimizerRateKind.Offpeak
                    : OptimizerRateKind.Standard;

            segments[h] = new OptimizerHourSegment(
                Hour: h,
                Kind: kind,
                IsCurrentStart: h == report.OptimalStartHour,
                Label: string.Format(CultureInfo.CurrentCulture, "{0} \u2014 {1}", FormatHour(h), KindWord(kind, localizer)));
        }

        return segments;
    }

    /// <summary>The localized band word used in timeline labels (web peak / off-peak / standard tooltips).</summary>
    public static string KindWord(OptimizerRateKind kind, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return kind switch
        {
            OptimizerRateKind.Peak => localizer.GetString("widget.chargingOptimizer.peak", "Peak"),
            OptimizerRateKind.Offpeak => localizer.GetString("widget.chargingOptimizer.offpeak", "Off-peak"),
            _ => localizer.GetString("widget.chargingOptimizer.standard", "Standard"),
        };
    }

    private static IReadOnlyList<OptimizerTip> BuildTips(
        IReadOnlyList<OptimizerRecommendation> recommendations,
        ILocalizer localizer)
    {
        if (recommendations.Count == 0)
        {
            return Array.Empty<OptimizerTip>();
        }

        var tips = new List<OptimizerTip>(recommendations.Count);
        for (int i = 0; i < recommendations.Count; i++)
        {
            var rec = recommendations[i];
            bool hasImpact = IsKnownPriority(rec.Priority);
            string impactLabel = string.IsNullOrEmpty(rec.Priority)
                ? string.Empty
                : localizer.GetString($"widget.chargingOptimizer.priority.{rec.Priority}", rec.Priority);

            string automation = hasImpact
                ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}. {2}", impactLabel, rec.Title, rec.Detail)
                : string.Format(CultureInfo.CurrentCulture, "{0}. {1}", rec.Title, rec.Detail);

            tips.Add(new OptimizerTip(
                Id: i.ToString(CultureInfo.InvariantCulture),
                Glyph: SparklesGlyph,
                IconBrushKey: TipBrushKey,
                Title: rec.Title,
                Description: rec.Detail,
                HasImpact: hasImpact,
                ImpactLabel: impactLabel,
                ImpactStatus: ImpactBadgeStatus(rec.Priority),
                AutomationName: automation));
        }

        return tips;
    }

    private static string Compose(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    /// <summary>Substitute the single token slot of a localized template (resw <c>{0}</c> or web <c>{{x}}</c>).</summary>
    private static string Fill(string template, string value) => template
        .Replace("{{pct}}", value, StringComparison.Ordinal)
        .Replace("{{amount}}", value, StringComparison.Ordinal)
        .Replace("{0}", value, StringComparison.Ordinal);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;ChargingOptimizerReport&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. A
/// resolved body with no optimizer data collapses to <see cref="RepositoryResult{T}.Empty"/> so the view
/// shows the "No optimizer data" state (web <c>!data</c> parity). Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class ChargingOptimizerResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<ChargingOptimizerReport> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargingOptimizerReport Parse() =>
            raw.HasValue ? ChargingOptimizerReport.FromJson(raw.Value) : ChargingOptimizerReport.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargingOptimizerReport>.Loading(),
            LoadStatus.Cached => RepositoryResult<ChargingOptimizerReport>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ChargingOptimizerReport>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<ChargingOptimizerReport>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<ChargingOptimizerReport>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<ChargingOptimizerReport>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<ChargingOptimizerReport> ToLoadedOrEmpty(
        ChargingOptimizerReport report,
        DateTimeOffset? fetchedAt)
        => report.HasData
            ? RepositoryResult<ChargingOptimizerReport>.Loaded(report, fetchedAt ?? DateTimeOffset.UtcNow)
            : RepositoryResult<ChargingOptimizerReport>.Empty(fetchedAt);
}
