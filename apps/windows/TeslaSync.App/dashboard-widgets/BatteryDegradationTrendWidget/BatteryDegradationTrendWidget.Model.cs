using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="BatteryDegradationTrendViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>BatteryDegradationTrendWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>isEmpty</c> gate (no current-health
/// value AND no monthly-trend rows) — the friendly "No degradation data" empty state — distinct from a
/// transport failure (<see cref="Error"/>).
/// </summary>
public enum BatteryDegradationTrendState
{
    /// <summary>Initial fetch with no cached trend — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh trend (or non-stale cache) carrying a current-health value or trend rows.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or a trend with no usable data — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached trend exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached trend older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached trend remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One monthly aggregation row from <c>GET /analytics/battery-degradation</c> (web <c>DegradationTrend</c>
/// in web/src/types/energy.ts): the <see cref="Month"/> bucket label, the average state-of-health
/// percentage (<c>avg_health</c>, the value the web area chart plots), and the average rated range
/// (<c>avg_range</c>). Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a
/// partial row never throws.
/// </summary>
public sealed record DegradationTrendPoint(string Month, double AvgHealth, double AvgRange)
{
    /// <summary>Project a single monthly-trend JSON object into a tolerant <see cref="DegradationTrendPoint"/>.</summary>
    public static DegradationTrendPoint FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new DegradationTrendPoint(string.Empty, 0, 0);
        }

        return new DegradationTrendPoint(
            Month: TrendJson.String(element, "month") ?? string.Empty,
            AvgHealth: TrendJson.Double(element, "avg_health") ?? 0,
            AvgRange: TrendJson.Double(element, "avg_range") ?? 0);
    }
}

/// <summary>
/// The battery-degradation trend read-model the widget consumes — the subset of the
/// <c>GET /analytics/battery-degradation</c> body (web <c>DegradationData</c>) the web
/// <c>BatteryDegradationTrendWidget</c> reads: the current health percentage
/// (<c>current_health_pct ?? current_health</c>), the monthly degradation rate, the lifetime cycle count,
/// and the monthly health/range trend. All percentages are already display-ready (the web shows them raw,
/// no unit conversion). Parsing is tolerant so a partial or non-object body yields <see cref="Empty"/>
/// rather than throwing.
/// </summary>
public sealed record BatteryDegradationTrend(
    double? CurrentHealthPct,
    double? DegradationRatePctPerMonth,
    double? CurrentCycles,
    IReadOnlyList<DegradationTrendPoint> MonthlyTrend)
{
    /// <summary>A data-free trend — the parse fallback for an absent/non-object body.</summary>
    public static BatteryDegradationTrend Empty { get; } =
        new(null, null, null, Array.Empty<DegradationTrendPoint>());

    /// <summary>
    /// True when the whole surface has nothing to show (web <c>isEmpty = currentHealth == null &amp;&amp;
    /// chartData.length === 0</c>): no resolved current-health value and no monthly-trend rows.
    /// </summary>
    public bool IsEmpty => CurrentHealthPct is null && MonthlyTrend.Count == 0;

    /// <summary>Project a <c>GET /analytics/battery-degradation</c> JSON body into a tolerant trend.</summary>
    public static BatteryDegradationTrend FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        // Web parity: current_health_pct wins, then current_health, then null (the ?? chain only falls
        // through on absent/null — a literal 0 is a valid health value and is kept).
        double? currentHealth = TrendJson.Double(element, "current_health_pct")
            ?? TrendJson.Double(element, "current_health");

        return new BatteryDegradationTrend(
            CurrentHealthPct: currentHealth,
            DegradationRatePctPerMonth: TrendJson.Double(element, "degradation_rate_pct_per_month"),
            CurrentCycles: TrendJson.Double(element, "current_cycles"),
            MonthlyTrend: ReadTrend(element));
    }

    private static IReadOnlyList<DegradationTrendPoint> ReadTrend(JsonElement element)
    {
        if (!element.TryGetProperty("monthly_trend", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DegradationTrendPoint>();
        }

        var list = new List<DegradationTrendPoint>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            list.Add(DegradationTrendPoint.FromJson(item));
        }

        return list;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1 &amp;&amp; size.rows &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx.
/// </summary>
public readonly record struct BatteryDegradationTrendSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static BatteryDegradationTrendSize Default => new(2, 4);

    /// <summary>True at a single cell (web <c>isCompact</c>): hide the title and chart, show the stats only.</summary>
    public bool IsCompact => Cols <= 1 && Rows <= 1;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/>, the
/// optional <see cref="Unit"/> suffix (e.g. <c>/mo</c>), and a Narrator automation name. Pure data — no
/// WinUI types.
/// </summary>
public sealed record TrendSummaryStat(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the degradation trend for one footprint — the native analogue
/// of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the summary
/// stats, the area-chart health series (with its month labels and end-of-life reference flag), and the
/// localized chart copy. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BatteryDegradationTrendDisplay(
    bool IsCompact,
    bool IsEmpty,
    IReadOnlyList<TrendSummaryStat> Stats,
    bool HasChart,
    IReadOnlyList<double> ChartHealth,
    IReadOnlyList<string> ChartMonths,
    bool ShowEolThreshold,
    string ChartSeriesName,
    string ChartEmptyMessage,
    string CompactAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="BatteryDegradationTrend"/> to the display model — the native port
/// of the <c>stats</c> / <c>chartData</c> <c>useMemo</c> work and the <c>isCompact</c> / <c>isEmpty</c>
/// gating in web/src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx. Percentages are already
/// display-ready (the web shows them raw, no unit conversion), so this only formats, labels and derives the
/// chart series; every label resolves through the i18n facade.
/// </summary>
public static class BatteryDegradationTrendProjection
{
    /// <summary>Segoe Fluent "MarketDown" glyph for the surface header / empty state (web <c>TrendingDown</c>).</summary>
    public const string HeaderGlyph = "\uEB0F";

    /// <summary>End-of-life reference percentage the chart marks with a dashed line (web <c>ReferenceLine y=80</c>).</summary>
    public const double EolThresholdPct = 80.0;

    /// <summary>Domain padding (web Y axis <c>domain={['dataMin - 2', 100]}</c>) used for the reference-line visibility test.</summary>
    public const double DomainPaddingPct = 2.0;

    private const string EmDash = "\u2014";
    private const string MinusSign = "\u2212";

    /// <summary>Project <paramref name="trend"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static BatteryDegradationTrendDisplay Project(
        BatteryDegradationTrend trend,
        BatteryDegradationTrendSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(trend);
        ArgumentNullException.ThrowIfNull(localizer);

        var stats = BuildStats(trend, localizer);

        var health = new List<double>(trend.MonthlyTrend.Count);
        var months = new List<string>(trend.MonthlyTrend.Count);
        foreach (var point in trend.MonthlyTrend)
        {
            health.Add(point.AvgHealth);
            months.Add(point.Month);
        }

        // Web parity: the area chart only renders with more than one point; otherwise the "need more data"
        // message takes its place.
        bool hasChart = health.Count > 1;

        // Web parity: the y-axis domain is [dataMin - 2, 100], so the 80% reference line is only visible when
        // the lowest health sample sits at or below 82 — otherwise it falls outside the zoomed-in domain.
        bool showEol = hasChart && MinOf(health) <= EolThresholdPct + DomainPaddingPct;

        return new BatteryDegradationTrendDisplay(
            IsCompact: size.IsCompact,
            IsEmpty: trend.IsEmpty,
            Stats: stats,
            HasChart: hasChart,
            ChartHealth: health,
            ChartMonths: months,
            ShowEolThreshold: showEol,
            ChartSeriesName: localizer.GetString("widget.healthPct", "Health %"),
            ChartEmptyMessage: localizer.GetString("widget.needMoreData", "More data needed for trend"),
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    private static List<TrendSummaryStat> BuildStats(BatteryDegradationTrend trend, ILocalizer localizer)
    {
        var stats = new List<TrendSummaryStat>(3);

        string sohLabel = localizer.GetString("widget.soh", "SoH");
        string sohValue = trend.CurrentHealthPct is { } health ? $"{Fmt(health, 1)}%" : EmDash;
        stats.Add(new TrendSummaryStat(sohLabel, sohValue, null, $"{sohLabel}: {sohValue}"));

        // Web parity: the degradation stat only appears when a positive monthly rate is present.
        if (trend.DegradationRatePctPerMonth is { } rate && rate > 0)
        {
            string degLabel = localizer.GetString("widget.degradation", "Degradation");
            string degValue = $"{MinusSign}{Fmt(rate, 2)}%";
            string degUnit = $"/{localizer.GetString("widget.mo", "mo")}";
            stats.Add(new TrendSummaryStat(degLabel, degValue, degUnit, $"{degLabel}: {degValue}{degUnit}"));
        }

        string cyclesLabel = localizer.GetString("widget.cycles", "Cycles");
        string cyclesValue = trend.CurrentCycles is { } cycles ? Fmt(cycles, 0) : EmDash;
        stats.Add(new TrendSummaryStat(cyclesLabel, cyclesValue, null, $"{cyclesLabel}: {cyclesValue}"));

        return stats;
    }

    private static IEnumerable<string> AutomationParts(IReadOnlyList<TrendSummaryStat> stats)
    {
        foreach (var stat in stats)
        {
            yield return stat.AutomationName;
        }
    }

    private static double MinOf(IReadOnlyList<double> values)
    {
        double min = double.PositiveInfinity;
        foreach (double v in values)
        {
            if (v < min)
            {
                min = v;
            }
        }

        return double.IsPositiveInfinity(min) ? 0 : min;
    }

    /// <summary>
    /// Format a number exactly as the web <c>fmtNumber</c> does: coerce null / NaN / ±∞ to 0 (web
    /// <c>safeNumber</c>) then render with fixed <paramref name="decimals"/> fraction digits and en-US grouping.
    /// </summary>
    private static string Fmt(double value, int decimals)
    {
        double safe = !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;BatteryDegradationTrend&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>isEmpty</c> gate (web's <c>WidgetChartSummary isEmpty</c>) is applied by the view-model, not here, so
/// a populated-but-data-free body still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class BatteryDegradationTrendResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<BatteryDegradationTrend> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        BatteryDegradationTrend Parse() =>
            raw.HasValue ? BatteryDegradationTrend.FromJson(raw.Value) : BatteryDegradationTrend.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<BatteryDegradationTrend>.Loading(),
            LoadStatus.Cached => RepositoryResult<BatteryDegradationTrend>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<BatteryDegradationTrend>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<BatteryDegradationTrend>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<BatteryDegradationTrend>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<BatteryDegradationTrend>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<BatteryDegradationTrend>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case battery-degradation JSON wire shape: numbers (or numeric
/// strings) and strings. Kept private to this surface so the trend adapter stays self-contained.
/// </summary>
internal static class TrendJson
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
}
