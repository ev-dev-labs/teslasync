using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="AnalyticsSummaryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>AnalyticsSummaryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetStatGrid</c>
/// (web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData</c> gate (no distance
/// and no energy) rather than an empty HTTP body — the fleet endpoint always returns a populated object.
/// </summary>
public enum AnalyticsSummaryState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot from the network (or non-stale cache) with data to show.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no distance and no energy — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fleet analytics rollup from <c>GET /analytics/fleet</c> (web <c>useAnalyticsSummary</c>, shape
/// <c>AnalyticsSummary</c> in web/src/types/analytics.ts). Field names mirror the Go API's snake_case
/// JSON tags (<c>total_distance_km</c>, <c>avg_efficiency_wh_km</c>, <c>total_energy_kwh</c>,
/// <c>total_cost</c>); parsing is null-tolerant so a partial body never throws. The optional trend
/// arrays mirror the web's forward-looking <c>distanceTrend</c>/<c>efficiencyTrend</c>/… reads (the
/// backend does not emit them today, so they default empty). Distances are kilometres and efficiency
/// is Wh/km — both converted to the user's display unit only at projection time.
/// </summary>
public sealed record AnalyticsSummary(
    double TotalDistanceKm,
    double AvgEfficiencyWhKm,
    double TotalEnergyKwh,
    double TotalCost,
    IReadOnlyList<double> DistanceTrend,
    IReadOnlyList<double> EfficiencyTrend,
    IReadOnlyList<double> EnergyTrend,
    IReadOnlyList<double> CostTrend)
{
    /// <summary>An all-zero snapshot with no trends — the parse fallback for an absent/non-object body.</summary>
    public static AnalyticsSummary Empty { get; } = new(
        0, 0, 0, 0,
        Array.Empty<double>(), Array.Empty<double>(), Array.Empty<double>(), Array.Empty<double>());

    /// <summary>
    /// True when there is something worth charting — at least some distance or some energy (web
    /// <c>hasData = distKm &gt; 0 || energyKwh &gt; 0</c>). Gates the empty state.
    /// </summary>
    public bool HasData => TotalDistanceKm > 0 || TotalEnergyKwh > 0;

    /// <summary>True when any of the four trend series carries at least one point (web <c>hasSparklines</c>).</summary>
    public bool HasTrends =>
        DistanceTrend.Count > 0 || EfficiencyTrend.Count > 0 || EnergyTrend.Count > 0 || CostTrend.Count > 0;

    /// <summary>Project a <c>GET /analytics/fleet</c> JSON object into a tolerant snapshot.</summary>
    public static AnalyticsSummary FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new AnalyticsSummary(
            TotalDistanceKm: GetDouble(element, "total_distance_km") ?? 0,
            AvgEfficiencyWhKm: GetDouble(element, "avg_efficiency_wh_km") ?? 0,
            TotalEnergyKwh: GetDouble(element, "total_energy_kwh") ?? 0,
            TotalCost: GetDouble(element, "total_cost") ?? 0,
            DistanceTrend: GetDoubleArray(element, "distance_trend"),
            EfficiencyTrend: GetDoubleArray(element, "efficiency_trend"),
            EnergyTrend: GetDoubleArray(element, "energy_trend"),
            CostTrend: GetDoubleArray(element, "cost_trend"));
    }

    private static double? GetDouble(JsonElement obj, string name)
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

    private static IReadOnlyList<double> GetDoubleArray(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<double>();
        }

        var list = new List<double>(v.GetArrayLength());
        foreach (var item in v.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Number && item.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n))
            {
                list.Add(n);
            }
        }

        return list;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> logic in
/// web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx.
/// </summary>
public readonly record struct AnalyticsSummarySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static AnalyticsSummarySize Default => new(2, 2);

    /// <summary>True at a single column (web <c>isCompact</c>): show the big animated distance number.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at four or more columns (web <c>isWide</c>): 4-up grid plus the trend sparklines.</summary>
    public bool IsWide => Cols >= 4;

    /// <summary>Stat-grid column count: 4 when wide, otherwise 2 (web <c>cols={isWide ? 4 : 2}</c>).</summary>
    public int GridColumns => IsWide ? 4 : 2;
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view. Holds the localized label, the
/// already-formatted value, the optional unit suffix, the resolved Fluent glyph, the categorical
/// palette index (so a tile's accent matches its trend sparkline), and a Narrator automation name.
/// Pure data — no WinUI types.
/// </summary>
public sealed record AnalyticsSummaryStat(
    string Label,
    string Value,
    string? Unit,
    string Glyph,
    int ColorIndex,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the analytics summary for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds
/// the four stat tiles, the compact big-number distance, and the trend series, plus the footprint
/// flags. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record AnalyticsSummaryDisplay(
    bool HasData,
    bool IsCompact,
    bool IsWide,
    IReadOnlyList<AnalyticsSummaryStat> Stats,
    double CompactDistance,
    string CompactValue,
    string CompactUnit,
    string CompactLabel,
    string CompactAutomationName,
    bool HasSparklines,
    IReadOnlyList<IReadOnlyList<double>> Sparklines);

/// <summary>
/// Pure projection from a raw <see cref="AnalyticsSummary"/> to the display model — the native port of
/// the unit conversion + <c>stats</c> <c>useMemo</c> in
/// web/src/features/dashboard/widgets/AnalyticsSummaryWidget.tsx. SI is converted to the user's display
/// unit here (and only here); every label resolves through the i18n facade.
/// </summary>
public static class AnalyticsSummaryProjection
{
    /// <summary>Miles→kilometres factor used to restate Wh/km efficiency as Wh/mi (web <c>MI_TO_KM</c>).</summary>
    public const double MiToKm = 1.60934;

    /// <summary>Fluent glyph for the surface header / empty state (web <c>BarChart3</c>).</summary>
    public const string HeaderGlyph = "\uE9D9";

    private const string DistanceGlyph = "\uE9D2";   // trending up
    private const string EfficiencyGlyph = "\uE950"; // gauge / pulse
    private const string EnergyGlyph = "\uE945";     // energy / lightning
    private const string CostGlyph = "\uE1D3";       // money

    private const string EmDash = "\u2014";

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the user's units + currency.</summary>
    public static AnalyticsSummaryDisplay Project(
        AnalyticsSummary data,
        AnalyticsSummarySize size,
        UnitPref units,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);
        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        double displayDist = UnitConverters.DistanceFromSi(data.TotalDistanceKm * 1000.0, distanceUnit);
        double displayEff = distanceUnit == DistanceUnit.Mi ? data.AvgEfficiencyWhKm * MiToKm : data.AvgEfficiencyWhKm;
        string effUnit = distanceUnit == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";
        double energyKwh = data.TotalEnergyKwh;
        double costPerDist = displayDist > 0 ? data.TotalCost / displayDist : 0;

        string distanceLabel = localizer.GetString("widget.analyticsSummary.totalDistance", "Total Distance");
        string efficiencyLabel = localizer.GetString("widget.analyticsSummary.avgEfficiency", "Avg Efficiency");
        string energyLabel = localizer.GetString("widget.analyticsSummary.energyConsumed", "Energy Consumed");
        string costLabel = localizer
            .GetString("widget.analyticsSummary.costPerDist", "Cost / {unit}")
            .Replace("{unit}", distanceUnitLabel, StringComparison.Ordinal)
            .Replace("{{unit}}", distanceUnitLabel, StringComparison.Ordinal);

        string distanceValue = ScalarFormatters.FormatNumber(displayDist, 0);
        string efficiencyValue = ScalarFormatters.FormatNumber(displayEff, 0);
        string energyValue = ScalarFormatters.FormatNumber(energyKwh, 1);
        string costValue = costPerDist > 0 ? ScalarFormatters.FormatCurrency(costPerDist, symbol, 3) : EmDash;

        var stats = new List<AnalyticsSummaryStat>(4)
        {
            new(distanceLabel, distanceValue, distanceUnitLabel, DistanceGlyph, 0, StatAutomationName(distanceLabel, distanceValue, distanceUnitLabel)),
            new(efficiencyLabel, efficiencyValue, effUnit, EfficiencyGlyph, 1, StatAutomationName(efficiencyLabel, efficiencyValue, effUnit)),
            new(energyLabel, energyValue, "kWh", EnergyGlyph, 2, StatAutomationName(energyLabel, energyValue, "kWh")),
            new(costLabel, costValue, null, CostGlyph, 3, StatAutomationName(costLabel, costValue, null)),
        };

        double roundedDist = Math.Round(displayDist, MidpointRounding.AwayFromZero);
        string compactValue = ScalarFormatters.FormatNumber(roundedDist, 0);
        string compactAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0} {1}, {2}", compactValue, distanceUnitLabel, distanceLabel);

        var sparklines = new IReadOnlyList<double>[]
        {
            data.DistanceTrend, data.EfficiencyTrend, data.EnergyTrend, data.CostTrend,
        };

        return new AnalyticsSummaryDisplay(
            HasData: data.HasData,
            IsCompact: size.IsCompact,
            IsWide: size.IsWide,
            Stats: stats,
            CompactDistance: roundedDist,
            CompactValue: compactValue,
            CompactUnit: distanceUnitLabel,
            CompactLabel: distanceLabel,
            CompactAutomationName: compactAutomationName,
            HasSparklines: data.HasTrends,
            Sparklines: sparklines);
    }

    private static string StatAutomationName(string label, string value, string? unit) =>
        string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;AnalyticsSummary&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept
/// pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class AnalyticsSummaryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<AnalyticsSummary> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        AnalyticsSummary Parse() => raw.HasValue ? AnalyticsSummary.FromJson(raw.Value) : AnalyticsSummary.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<AnalyticsSummary>.Loading(),
            LoadStatus.Cached => RepositoryResult<AnalyticsSummary>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<AnalyticsSummary>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<AnalyticsSummary>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<AnalyticsSummary>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<AnalyticsSummary>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<AnalyticsSummary>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
