using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="CostBreakdownViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>CostBreakdownWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/CostBreakdownWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData</c> gate (no monthly
/// breakdown rows) rather than an empty HTTP body — the TCO endpoint returns a populated object even
/// when the fleet has no charging history.
/// </summary>
public enum CostBreakdownState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with cost data to show.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no monthly breakdown — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One month of the charging-cost rollup (web <c>MonthlyCostEntry</c> in web/src/types/analytics.ts).
/// Only the two fields the web component reads are projected: the <c>YYYY-MM</c> label and the EV
/// charging cost for that month. Parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="Month">The <c>YYYY-MM</c> label (web <c>entry.month ?? '—'</c>).</param>
/// <param name="EvCost">The EV charging cost for the month (web <c>entry.ev_cost ?? 0</c>).</param>
public sealed record CostBreakdownMonth(string Month, double EvCost);

/// <summary>
/// The total-cost-of-ownership rollup from <c>GET /analytics/tco?vehicle_id=…</c> (web
/// <c>useCostBreakdown</c>, shape <c>CostBreakdown</c> in web/src/types/analytics.ts). Field names
/// mirror the Go API's snake_case JSON tags (<c>total_charging_cost</c>, <c>total_savings</c>,
/// <c>monthly_savings</c>, <c>cost_per_km_ev</c>, <c>monthly_breakdown</c>); parsing is null-tolerant so
/// a partial body never throws. The per-km EV cost is SI (cost per kilometre) — restated to the user's
/// display unit only at projection time.
/// </summary>
public sealed record CostBreakdown(
    double TotalChargingCost,
    double TotalSavings,
    double MonthlySavings,
    double CostPerKmEv,
    IReadOnlyList<CostBreakdownMonth> MonthlyBreakdown)
{
    /// <summary>An all-zero snapshot with no months — the parse fallback for an absent/non-object body.</summary>
    public static CostBreakdown Empty { get; } = new(0, 0, 0, 0, Array.Empty<CostBreakdownMonth>());

    /// <summary>True when there is at least one monthly breakdown row (web <c>hasData</c>). Gates the empty state.</summary>
    public bool HasData => MonthlyBreakdown.Count > 0;

    /// <summary>The most recent month's EV cost (web <c>currentMonthCost</c> = last breakdown entry).</summary>
    public double CurrentMonthCost =>
        MonthlyBreakdown.Count == 0 ? 0 : MonthlyBreakdown[^1].EvCost;

    /// <summary>Project a <c>GET /analytics/tco</c> JSON object into a tolerant snapshot.</summary>
    public static CostBreakdown FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new CostBreakdown(
            TotalChargingCost: GetDouble(element, "total_charging_cost") ?? 0,
            TotalSavings: GetDouble(element, "total_savings") ?? 0,
            MonthlySavings: GetDouble(element, "monthly_savings") ?? 0,
            CostPerKmEv: GetDouble(element, "cost_per_km_ev") ?? 0,
            MonthlyBreakdown: GetMonths(element, "monthly_breakdown"));
    }

    private static IReadOnlyList<CostBreakdownMonth> GetMonths(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CostBreakdownMonth>();
        }

        var list = new List<CostBreakdownMonth>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string month = GetString(item, "month") ?? EmDash;
            double cost = GetDouble(item, "ev_cost") ?? 0;
            list.Add(new CostBreakdownMonth(month, cost));
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
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> logic in
/// web/src/features/dashboard/widgets/CostBreakdownWidget.tsx.
/// </summary>
public readonly record struct CostBreakdownSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static CostBreakdownSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the big current-month cost number.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One donut slice projected from a month's EV cost (the native counterpart of the web
/// <c>DonutSegment</c>). <see cref="ColorIndex"/> is the slice's position in the last-six-months window
/// so the wedge colour matches the web's <c>palette.series[i % len]</c> assignment. Pure data — no WinUI
/// types.
/// </summary>
public sealed record CostBreakdownSegment(string Label, double Value, int ColorIndex);

/// <summary>
/// One row of the monthly ranked list (the native counterpart of the web <c>RankedItem</c> consumed by
/// <c>WidgetRankedList</c>). The bar colour follows the month's chronological position
/// (<see cref="ColorIndex"/>) — matching the web's <c>palette.series[i % len]</c> — while the rows are
/// ordered by descending cost. <see cref="BarFraction"/> is the 0..1 width relative to the largest
/// visible row (web <c>barPct = value / maxValue</c>). Pure data — no WinUI types.
/// </summary>
public sealed record CostBreakdownRankedItem(
    int Rank,
    string Label,
    double Value,
    string FormattedValue,
    int ColorIndex,
    double BarFraction,
    string AutomationName);

/// <summary>
/// One projected, display-ready stat card (the native counterpart of the web <c>StatCard</c>): the
/// localized label, the already-formatted value, an optional sub-line, the resolved Fluent glyph, and a
/// Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record CostBreakdownStat(
    string Label,
    string Value,
    string? Sublabel,
    string Glyph,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the cost breakdown for one footprint — the native analogue
/// of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the compact
/// big-number fields, the donut slices, the ranked list, and the three stat cards, plus the footprint
/// flags. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record CostBreakdownDisplay(
    bool HasData,
    bool IsCompact,
    double CompactValue,
    string CompactValueText,
    string CompactUnit,
    string CompactLabel,
    string? CompactSubtitle,
    bool ShowSavingBadge,
    string SavingBadgeText,
    string CompactAutomationName,
    IReadOnlyList<CostBreakdownSegment> Donut,
    IReadOnlyList<CostBreakdownRankedItem> Ranked,
    CostBreakdownStat TotalCost,
    CostBreakdownStat CostPerDistance,
    CostBreakdownStat GasSavings,
    string EmptyMessage);

/// <summary>
/// Pure projection from a raw <see cref="CostBreakdown"/> to the display model — the native port of the
/// <c>useMemo</c> blocks (<c>currentMonthCost</c>, <c>donutData</c>, <c>rankedItems</c>,
/// <c>costPerDist</c>) plus the <c>StatCard</c> / <c>WidgetBigNumber</c> assembly in
/// web/src/features/dashboard/widgets/CostBreakdownWidget.tsx. The per-km EV cost is restated to the
/// user's display unit here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class CostBreakdownProjection
{
    /// <summary>Kilometres per mile used to restate $/km as $/mi (web <c>const MI_TO_KM = 1.60934</c>).</summary>
    public const double MiToKm = 1.60934;

    /// <summary>The trailing window of months charted in the donut (web <c>monthlyEntries.slice(-6)</c>).</summary>
    public const int DonutMonths = 6;

    /// <summary>The ranked-list cap (web <c>WidgetRankedList maxItems={5}</c>).</summary>
    public const int MaxRankedItems = 5;

    /// <summary>The default currency fraction digits (web <c>useFormatting</c> <c>decimal_precision ?? 2</c>).</summary>
    public const int DefaultPrecision = 2;

    private const string EmDash = "\u2014";

    /// <summary>Fluent glyph for the surface header / empty state (web <c>PieChart</c> / <c>PieIcon</c>).</summary>
    public const string HeaderGlyph = "\uE9D2";

    private const string CostGlyph = "\uE1D3";     // money (web DollarSign)
    private const string DistanceGlyph = "\uE950"; // gauge (web Fuel)
    private const string SavingsGlyph = "\uE896";  // downward arrow (web TrendingDown)

    /// <summary>The accent brush tinting the header icon (web emerald).</summary>
    public const string HeaderAccentBrushKey = "TsColorSuccessBrush";

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the user's units + currency.</summary>
    public static CostBreakdownDisplay Project(
        CostBreakdown data,
        CostBreakdownSize size,
        UnitPref units,
        string currencySymbol,
        int currencyPrecision,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        int precision = currencyPrecision < 0 ? 0 : currencyPrecision;
        string distanceUnitLabel = UnitLabels.Label(units.Distance);

        // ---- Compact (web WidgetBigNumber) ----
        double currentMonthCost = data.CurrentMonthCost;
        string compactValueText = ScalarFormatters.FormatNumber(currentMonthCost, 0);
        string compactLabel = localizer.GetString("widget.costBreakdown.monthlyTotal", "This Month");
        string? compactSubtitle = data.MonthlySavings > 0
            ? Fill(
                localizer.GetString("widget.costBreakdown.savedVsGas", "Saved {{amount}} vs gas"),
                FormatCurrency(data.MonthlySavings, symbol, precision))
            : null;
        bool showSavingBadge = data.TotalSavings > 0;
        string savingBadgeText = localizer.GetString("widget.costBreakdown.saving", "Saving");
        string compactAutomationName = compactSubtitle is null
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1}, {2}", compactValueText, symbol, compactLabel)
            : string.Format(CultureInfo.CurrentCulture, "{0} {1}, {2}, {3}", compactValueText, symbol, compactLabel, compactSubtitle);

        // ---- Donut (web monthlyEntries.slice(-6)) ----
        var donut = BuildDonut(data.MonthlyBreakdown);

        // ---- Ranked list (web rankedItems → WidgetRankedList sort desc, top 5) ----
        var ranked = BuildRanked(data.MonthlyBreakdown, symbol, precision, localizer);

        // ---- Stat cards (web three StatCards) ----
        double costPerDist = CostPerDistanceUnit(data.CostPerKmEv, units.Distance);

        string totalCostLabel = localizer.GetString("widget.costBreakdown.totalCost", "Total Cost");
        string totalCostValue = FormatCurrency(data.TotalChargingCost, symbol, precision);
        var totalCostStat = Stat(totalCostLabel, totalCostValue, null, CostGlyph);

        string cpdLabel = Fill(
            localizer.GetString("widget.costBreakdown.costPerDist", "Cost / {{unit}}"), distanceUnitLabel);
        string cpdValue = costPerDist > 0 ? FormatCurrency(costPerDist, symbol, 3) : EmDash;
        var costPerDistanceStat = Stat(cpdLabel, cpdValue, null, DistanceGlyph);

        string gasLabel = localizer.GetString("widget.costBreakdown.gasSavings", "Gas Savings");
        string gasValue = data.TotalSavings > 0 ? FormatCurrency(data.TotalSavings, symbol, precision) : EmDash;
        string? gasSublabel = data.TotalSavings > 0
            ? localizer.GetString("widget.costBreakdown.lifetime", "Lifetime")
            : null;
        var gasSavingsStat = Stat(gasLabel, gasValue, gasSublabel, SavingsGlyph);

        string emptyMessage = localizer.GetString("widget.costBreakdown.noData", "No cost data");

        return new CostBreakdownDisplay(
            HasData: data.HasData,
            IsCompact: size.IsCompact,
            CompactValue: currentMonthCost,
            CompactValueText: compactValueText,
            CompactUnit: symbol,
            CompactLabel: compactLabel,
            CompactSubtitle: compactSubtitle,
            ShowSavingBadge: showSavingBadge,
            SavingBadgeText: savingBadgeText,
            CompactAutomationName: compactAutomationName,
            Donut: donut,
            Ranked: ranked,
            TotalCost: totalCostStat,
            CostPerDistance: costPerDistanceStat,
            GasSavings: gasSavingsStat,
            EmptyMessage: emptyMessage);
    }

    /// <summary>
    /// Cost per the user's display-distance unit — the native port of the web <c>costPerDist</c>
    /// <c>useMemo</c>: <c>$/km</c> as reported, multiplied by <see cref="MiToKm"/> when the display unit
    /// is miles (so <c>$/km × km/mi = $/mi</c>). Returns 0 when the source per-km cost is 0.
    /// </summary>
    public static double CostPerDistanceUnit(double costPerKmEv, DistanceUnit distanceUnit)
    {
        if (costPerKmEv == 0)
        {
            return 0;
        }

        return distanceUnit == DistanceUnit.Mi ? costPerKmEv * MiToKm : costPerKmEv;
    }

    /// <summary>Format a currency amount — the native port of <c>useFormatting.formatCurrency</c>.</summary>
    public static string FormatCurrency(double amount, string symbol, int decimals) =>
        ScalarFormatters.FormatCurrency(amount, string.IsNullOrWhiteSpace(symbol) ? "$" : symbol, decimals < 0 ? 0 : decimals);

    private static IReadOnlyList<CostBreakdownSegment> BuildDonut(IReadOnlyList<CostBreakdownMonth> months)
    {
        if (months.Count == 0)
        {
            return Array.Empty<CostBreakdownSegment>();
        }

        int start = months.Count > DonutMonths ? months.Count - DonutMonths : 0;
        var donut = new List<CostBreakdownSegment>(months.Count - start);
        for (int i = start; i < months.Count; i++)
        {
            donut.Add(new CostBreakdownSegment(months[i].Month, months[i].EvCost, i - start));
        }

        return donut;
    }

    private static IReadOnlyList<CostBreakdownRankedItem> BuildRanked(
        IReadOnlyList<CostBreakdownMonth> months, string symbol, int precision, ILocalizer localizer)
    {
        if (months.Count == 0)
        {
            return Array.Empty<CostBreakdownRankedItem>();
        }

        // Web parity: each item's bar colour is its chronological index; the rows are then sorted by
        // descending cost and the top five kept (stable, so ties keep chronological order).
        var indexed = new List<(CostBreakdownMonth Month, int ColorIndex)>(months.Count);
        for (int i = 0; i < months.Count; i++)
        {
            indexed.Add((months[i], i));
        }

        var visible = indexed
            .OrderByDescending(x => x.Month.EvCost)
            .Take(MaxRankedItems)
            .ToList();

        double maxValue = 0;
        foreach (var x in visible)
        {
            maxValue = Math.Max(maxValue, x.Month.EvCost);
        }

        string rankWord = localizer.GetString("widget.costBreakdown.rank", "Rank");
        var ranked = new List<CostBreakdownRankedItem>(visible.Count);
        for (int rank = 0; rank < visible.Count; rank++)
        {
            var (month, colorIndex) = visible[rank];
            string formatted = FormatCurrency(month.EvCost, symbol, precision);
            double fraction = maxValue > 0 ? Math.Clamp(month.EvCost / maxValue, 0, 1) : 0;
            string automation = string.Format(
                CultureInfo.CurrentCulture, "{0} {1}: {2}, {3}", rankWord, rank + 1, month.Month, formatted);
            ranked.Add(new CostBreakdownRankedItem(
                Rank: rank + 1,
                Label: month.Month,
                Value: month.EvCost,
                FormattedValue: formatted,
                ColorIndex: colorIndex,
                BarFraction: fraction,
                AutomationName: automation));
        }

        return ranked;
    }

    private static CostBreakdownStat Stat(string label, string value, string? sublabel, string glyph) =>
        new(label, value, sublabel, glyph, AutomationName(label, value, sublabel));

    private static string AutomationName(string label, string value, string? sublabel) =>
        string.IsNullOrEmpty(sublabel)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, sublabel);

    // Substitute the one interpolation token a string carries, accepting both the catalog's {0} form and
    // the web fallbacks' {{amount}}/{{unit}} form so production and headless tests both resolve.
    private static string Fill(string template, string value) =>
        template
            .Replace("{0}", value, StringComparison.Ordinal)
            .Replace("{{amount}}", value, StringComparison.Ordinal)
            .Replace("{{unit}}", value, StringComparison.Ordinal);
}

/// <summary>
/// Canonical registry metadata for the Cost Breakdown surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/analytics.ts (<c>cost-breakdown</c>). The
/// dashboard grid system binds this surface with the same <see cref="Id"/> and honours the same size
/// constraints.
/// </summary>
public static class CostBreakdownRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "cost-breakdown";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "CostBreakdownWidget";

    /// <summary>Default footprint: 2 columns × 4 rows (web registry <c>defaultSize</c>).</summary>
    public static CostBreakdownSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows (web registry <c>minSize</c>).</summary>
    public static CostBreakdownSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows (web registry <c>maxSize</c>).</summary>
    public static CostBreakdownSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Cost Breakdown").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.costBreakdown.title", "Cost Breakdown");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.costBreakdown.description",
            "Charging cost by source: home vs Supercharger vs destination, gas savings");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(CostBreakdownSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static CostBreakdownSize Clamp(CostBreakdownSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Cost Breakdown surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost figure, vehicle id or VIN —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class CostBreakdownDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CostBreakdownDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CostBreakdownWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CostBreakdownRegistration.Slug}");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;CostBreakdown&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class CostBreakdownResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<CostBreakdown> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        CostBreakdown Parse() => raw.HasValue ? CostBreakdown.FromJson(raw.Value) : CostBreakdown.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<CostBreakdown>.Loading(),
            LoadStatus.Cached => RepositoryResult<CostBreakdown>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<CostBreakdown>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<CostBreakdown>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<CostBreakdown>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<CostBreakdown>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<CostBreakdown>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
