using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="CostForecastViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>CostForecastWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetChartSummary</c>
/// (web/src/features/dashboard/widgets/CostForecastWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>WidgetChartSummary isEmpty</c>
/// gate (<c>hasData = chartData.length &gt; 0</c> — no historical and no forecast months) — the friendly
/// "No forecast data" empty state — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum CostForecastState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying at least one month to chart.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no historical/forecast months — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One past month of charging cost (web <c>CostHistoricalMonth</c> in web/src/types/charging.ts). Only the
/// three fields the web <c>CostForecastWidget</c> reads are projected: the month label, the month's cost,
/// and the blended cost-per-kWh (surfaced as the "Avg $/kWh" stat from the most recent month). Costs are
/// plain currency amounts (already in the user's currency on the wire); parsing is null-tolerant so a
/// partial row never throws.
/// </summary>
/// <param name="Month">The month label (web <c>h.month ?? '—'</c>).</param>
/// <param name="Cost">The charging cost for the month (web <c>h.cost ?? 0</c>).</param>
/// <param name="CostPerKwh">The blended cost per kWh for the month (web <c>h.cost_per_kwh ?? 0</c>).</param>
public sealed record CostForecastHistoryMonth(string Month, double Cost, double CostPerKwh);

/// <summary>
/// One projected future month of charging cost (web <c>CostForecastMonth</c> in
/// web/src/types/charging.ts). Only the two fields the web chart reads are projected: the month label and
/// the projected cost. Parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Month">The month label (web <c>f.month ?? '—'</c>).</param>
/// <param name="Cost">The projected charging cost for the month (web <c>f.cost ?? 0</c>).</param>
public sealed record CostForecastProjectionMonth(string Month, double Cost);

/// <summary>
/// The cost-forecast rollup from <c>GET /analytics/cost-forecast?vehicle_id=…&amp;months=…</c> (web
/// <c>useCostForecast</c>, shape <c>CostForecastData</c> in web/src/types/charging.ts). Only the two arrays
/// the widget renders — <c>historical</c> and <c>forecast</c> — are projected; the unused
/// <c>breakdown</c> / <c>gas_comparison</c> / <c>insights</c> fields are ignored. Field names mirror the Go
/// API's snake_case JSON tags; parsing is null-tolerant so a partial body never throws.
/// </summary>
public sealed record CostForecast(
    IReadOnlyList<CostForecastHistoryMonth> Historical,
    IReadOnlyList<CostForecastProjectionMonth> Forecast)
{
    /// <summary>An empty snapshot with no months — the parse fallback for an absent/non-object body.</summary>
    public static CostForecast Empty { get; } = new(
        Array.Empty<CostForecastHistoryMonth>(), Array.Empty<CostForecastProjectionMonth>());

    /// <summary>
    /// True when there is at least one historical or forecast month (web
    /// <c>hasData = chartData.length &gt; 0</c>). Gates the empty state.
    /// </summary>
    public bool HasData => Historical.Count > 0 || Forecast.Count > 0;

    /// <summary>Project a <c>GET /analytics/cost-forecast</c> JSON object into a tolerant snapshot.</summary>
    public static CostForecast FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new CostForecast(
            GetHistorical(element, "historical"),
            GetForecast(element, "forecast"));
    }

    private static IReadOnlyList<CostForecastHistoryMonth> GetHistorical(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CostForecastHistoryMonth>();
        }

        var list = new List<CostForecastHistoryMonth>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new CostForecastHistoryMonth(
                GetString(item, "month") ?? EmDash,
                GetDouble(item, "cost") ?? 0,
                GetDouble(item, "cost_per_kwh") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<CostForecastProjectionMonth> GetForecast(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CostForecastProjectionMonth>();
        }

        var list = new List<CostForecastProjectionMonth>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new CostForecastProjectionMonth(
                GetString(item, "month") ?? EmDash,
                GetDouble(item, "cost") ?? 0));
        }

        return list;
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private const string EmDash = "\u2014";
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/CostForecastWidget.tsx (the row count does not affect the layout).
/// </summary>
public readonly record struct CostForecastSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static CostForecastSize Default => new(2, 4);

    /// <summary>
    /// True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): hide the title and chart,
    /// showing the big predicted-cost summary (Next Month + Trend) only.
    /// </summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready stat from the summary row — the native analogue of a web
/// <c>ChartSummaryStat</c>. Holds the localized <see cref="Label"/>, the formatted <see cref="Value"/>
/// (already currency-formatted, with the trend arrow embedded where applicable), and a Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
public sealed record CostForecastStat(string Label, string Value, string AutomationName);

/// <summary>
/// One projected, render-ready bar — the native analogue of a single web <c>BarDatum</c>. Holds the
/// X-axis <see cref="Month"/> label, the cost and its formatted text, whether the month is a projection
/// (web <c>isForecast</c>, kept for parity of the data shape and asserted in tests), the
/// <see cref="HeightRatio"/> (0..1 of the costliest bar) the view scales the bar to, the design-token
/// <see cref="ColorBrushKey"/> the bar fills with, and a Narrator automation name. Pure data so the
/// geometry is unit-tested without a UI host.
/// </summary>
public sealed record CostForecastBar(
    string Month,
    double Cost,
    string ValueText,
    bool IsForecast,
    double HeightRatio,
    string ColorBrushKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the cost forecast for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX. Holds the summary stats
/// (two when compact, three when standard), the bar chart data (already sliced to the most recent six
/// months, chronological order), the <see cref="TrendUp"/> flag (drives the header icon), and the
/// compact-mode Narrator name. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record CostForecastDisplay(
    bool IsCompact,
    bool HasData,
    bool TrendUp,
    IReadOnlyList<CostForecastStat> Stats,
    IReadOnlyList<CostForecastBar> Bars,
    string CompactAutomationName);

/// <summary>
/// Pure projection from the raw cost-forecast snapshot to the display model — the native port of the
/// <c>buildChartData</c> / <c>stats</c> <c>useMemo</c> work and the <c>hasData</c> / <c>isCompact</c>
/// gating in web/src/features/dashboard/widgets/CostForecastWidget.tsx. Currency is formatted exactly as
/// the web <c>useFormatting().formatCurrency(value, decimals)</c> does
/// (<c>currencySymbol + fmtNumber(value, decimals)</c>, null/NaN coerced to 0); every label resolves
/// through the i18n facade; the single bar color flows from the W1 brand chart palette (web's flat
/// indigo <c>#6366f1</c>).
/// </summary>
public static class CostForecastProjection
{
    /// <summary>Segoe Fluent "trending up" glyph for the header when costs rise (web <c>TrendingUp</c>).</summary>
    public const string TrendUpGlyph = "\uE9D2";

    /// <summary>Segoe Fluent "market down" glyph for the header when costs fall (web <c>TrendingDown</c>).</summary>
    public const string TrendDownGlyph = "\uEB0F";

    /// <summary>Accent brush tinting the header icon when costs rise (web amber <c>text-amber-400</c>).</summary>
    public const string TrendUpBrushKey = "TsColorWarningBrush";

    /// <summary>Accent brush tinting the header icon when costs fall (web emerald <c>text-emerald-400</c>).</summary>
    public const string TrendDownBrushKey = "TsColorSuccessBrush";

    /// <summary>The most-recent months retained for the chart (web <c>chartData.slice(-6)</c>).</summary>
    public const int WindowMonths = 6;

    /// <summary>Default fraction digits for whole-currency figures (web <c>formatCurrency(_, 0)</c>).</summary>
    public const int DefaultPrecision = 0;

    private const string UpArrow = "\u2191";
    private const string DownArrow = "\u2193";
    private const string EmDash = "\u2014";

    /// <summary>The single bar fill — the W1 brand chart palette's first categorical brush (web flat indigo).</summary>
    public static string BarBrushKey => ChartPalette.KeyForIndex(0);

    /// <summary>The header glyph for the current trend (web <c>TrendingUp</c> / <c>TrendingDown</c>).</summary>
    public static string TrendGlyph(bool trendUp) => trendUp ? TrendUpGlyph : TrendDownGlyph;

    /// <summary>The header accent brush key for the current trend (web amber up / emerald down).</summary>
    public static string TrendBrushKey(bool trendUp) => trendUp ? TrendUpBrushKey : TrendDownBrushKey;

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the supplied currency and localizer.</summary>
    /// <param name="data">The parsed cost-forecast snapshot.</param>
    /// <param name="size">The widget footprint (drives the compact branch).</param>
    /// <param name="currencySymbol">The currency symbol (web <c>useFormatting().currencySymbol</c>, default "$").</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static CostForecastDisplay Project(
        CostForecast data,
        CostForecastSize size,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        var bars = BuildBars(data, symbol);
        bool hasData = bars.Count > 0;

        // Web parity: nextForecast = forecast[0]; lastHistorical = historical[last]; trendUp = next >= last.
        double nextCost = data.Forecast.Count > 0 ? Safe(data.Forecast[0].Cost) : 0;
        var lastHistorical = data.Historical.Count > 0 ? data.Historical[^1] : null;
        double lastCost = lastHistorical is { } lh ? Safe(lh.Cost) : 0;
        bool trendUp = nextCost >= lastCost;

        IReadOnlyList<CostForecastStat> stats = hasData
            ? size.IsCompact
                ? BuildCompactStats(nextCost, trendUp, symbol, localizer)
                : BuildStandardStats(nextCost, lastCost, lastHistorical, trendUp, symbol, localizer)
            : Array.Empty<CostForecastStat>();

        return new CostForecastDisplay(
            IsCompact: size.IsCompact,
            HasData: hasData,
            TrendUp: trendUp,
            Stats: stats,
            Bars: bars,
            CompactAutomationName: string.Join(", ", AutomationParts(stats)));
    }

    private static List<CostForecastBar> BuildBars(CostForecast data, string symbol)
    {
        // Web parity: chartData = [...historical, ...forecast].slice(-6) — historical first, then forecast,
        // keeping the six most-recent points.
        var combined = new List<(string Month, double Cost, bool IsForecast)>(
            data.Historical.Count + data.Forecast.Count);
        foreach (var h in data.Historical)
        {
            combined.Add((string.IsNullOrEmpty(h.Month) ? EmDash : h.Month, Safe(h.Cost), false));
        }

        foreach (var f in data.Forecast)
        {
            combined.Add((string.IsNullOrEmpty(f.Month) ? EmDash : f.Month, Safe(f.Cost), true));
        }

        int skip = Math.Max(0, combined.Count - WindowMonths);
        double max = 0;
        for (int i = skip; i < combined.Count; i++)
        {
            if (combined[i].Cost > max)
            {
                max = combined[i].Cost;
            }
        }

        var bars = new List<CostForecastBar>(combined.Count - skip);
        for (int i = skip; i < combined.Count; i++)
        {
            var (month, cost, isForecast) = combined[i];
            string valueText = FmtCurrency(cost, symbol, DefaultPrecision);
            double ratio = max > 0 ? Math.Clamp(cost / max, 0.0, 1.0) : 0.0;
            bars.Add(new CostForecastBar(
                Month: month,
                Cost: cost,
                ValueText: valueText,
                IsForecast: isForecast,
                HeightRatio: ratio,
                ColorBrushKey: BarBrushKey,
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", month, valueText)));
        }

        return bars;
    }

    private static List<CostForecastStat> BuildCompactStats(
        double nextCost, bool trendUp, string symbol, ILocalizer localizer)
    {
        string nextLabel = localizer.GetString("widget.costForecast.nextMonth", "Next Month");
        string trendLabel = localizer.GetString("widget.costForecast.trend", "Trend");
        string nextValue = FmtCurrency(nextCost, symbol, DefaultPrecision);
        string trendValue = trendUp ? UpArrow : DownArrow;

        return new List<CostForecastStat>(2)
        {
            new(nextLabel, nextValue, StatAutomation(nextLabel, nextValue)),
            new(trendLabel, trendValue, StatAutomation(trendLabel, trendValue)),
        };
    }

    private static List<CostForecastStat> BuildStandardStats(
        double nextCost,
        double lastCost,
        CostForecastHistoryMonth? lastHistorical,
        bool trendUp,
        string symbol,
        ILocalizer localizer)
    {
        string nextLabel = localizer.GetString("widget.costForecast.nextMonth", "Next Month");
        string avgLabel = localizer.GetString("widget.costForecast.avgPerKwh", "Avg $/kWh");
        string trendLabel = localizer.GetString("widget.costForecast.trend", "Trend");

        string nextValue = FmtCurrency(nextCost, symbol, DefaultPrecision);

        // Web parity: lastHistorical ? formatCurrency(lastHistorical.cost_per_kwh ?? 0, 2) : '—'.
        string avgValue = lastHistorical is { } last
            ? FmtCurrency(last.CostPerKwh, symbol, 2)
            : EmDash;

        // Web parity: trendUp ? `↑ ${Δ}` : `↓ ${Δ}` where Δ is the absolute next-vs-last difference.
        double delta = trendUp ? nextCost - lastCost : lastCost - nextCost;
        string trendValue = string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            trendUp ? UpArrow : DownArrow,
            FmtCurrency(delta, symbol, DefaultPrecision));

        return new List<CostForecastStat>(3)
        {
            new(nextLabel, nextValue, StatAutomation(nextLabel, nextValue)),
            new(avgLabel, avgValue, StatAutomation(avgLabel, avgValue)),
            new(trendLabel, trendValue, StatAutomation(trendLabel, trendValue)),
        };
    }

    private static IEnumerable<string> AutomationParts(IReadOnlyList<CostForecastStat> stats)
    {
        foreach (var stat in stats)
        {
            yield return stat.AutomationName;
        }
    }

    private static string StatAutomation(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    /// <summary>
    /// Format a currency amount exactly as the web <c>formatCurrency(amount, decimals)</c> does:
    /// <c>currencySymbol</c> + <c>fmtNumber(safeNumber(amount), decimals)</c> (null / NaN / ±∞ coerced to 0,
    /// then fixed fraction digits with en-US grouping).
    /// </summary>
    private static string FmtCurrency(double value, string symbol, int decimals) =>
        symbol + ScalarFormatters.FormatNumber(Safe(value), decimals);

    private static double Safe(double value) =>
        !double.IsNaN(value) && !double.IsInfinity(value) ? value : 0.0;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;CostForecast&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. The <c>hasData</c> gate (web's
/// <c>WidgetChartSummary isEmpty</c>) is applied by the view-model, not here, so a snapshot with empty
/// month arrays still flows through with its freshness intact. Kept pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class CostForecastResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<CostForecast> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        CostForecast Parse() => raw.HasValue ? CostForecast.FromJson(raw.Value) : CostForecast.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<CostForecast>.Loading(),
            LoadStatus.Cached => RepositoryResult<CostForecast>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<CostForecast>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<CostForecast>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<CostForecast>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<CostForecast>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<CostForecast>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
