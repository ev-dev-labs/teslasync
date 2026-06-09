using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Charging analytics surface. Every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted body from
/// <c>GET /analytics/fleet</c> never aborts the parse (web parity: the React component reads
/// <c>data?.charging_analytics?.charger_types ?? []</c> and tolerates an undefined response). Kept private to
/// the surface and free of WinUI types so the parse is unit-tested without a UI host.
/// </summary>
internal static class ChargingTabJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? GetLong(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)Math.Round(d),
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The double value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The child object property <paramref name="name"/>, or <c>default</c> when absent / not an object.</summary>
    public static JsonElement? GetObject(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.Object
            ? prop
            : null;

    /// <summary>Enumerate the array property <paramref name="name"/>; empty when absent / not an array.</summary>
    public static IReadOnlyList<JsonElement> GetArray(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !obj.TryGetProperty(name, out var prop)
            || prop.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<JsonElement>();
        }

        var list = new List<JsonElement>(prop.GetArrayLength());
        foreach (var item in prop.EnumerateArray())
        {
            list.Add(item);
        }

        return list;
    }
}

/// <summary>
/// The native analogue of the web <c>StatsSummary</c> (<c>{ min, max, avg, median, p95, count }</c>) used by
/// the charging power / duration / efficiency / cost aggregates. A missing or non-object stats block parses to
/// <c>null</c> so the surface renders the '—' / "no statistics" branch exactly like the web
/// <c>powerStats ? … : '—'</c> / <c>costStats ? … : EmptyState</c> gates. Pure data — no WinUI types.
/// </summary>
public sealed record ChargingStats(double Min, double Max, double Avg, double Median, double P95, long Count)
{
    /// <summary>Parse a stats object, or null when <paramref name="obj"/> is absent / not a JSON object.</summary>
    public static ChargingStats? FromJson(JsonElement? obj)
    {
        if (obj is not { ValueKind: JsonValueKind.Object } element)
        {
            return null;
        }

        return new ChargingStats(
            Min: ChargingTabJson.GetDouble(element, "min") ?? 0,
            Max: ChargingTabJson.GetDouble(element, "max") ?? 0,
            Avg: ChargingTabJson.GetDouble(element, "avg") ?? 0,
            Median: ChargingTabJson.GetDouble(element, "median") ?? 0,
            P95: ChargingTabJson.GetDouble(element, "p95") ?? 0,
            Count: ChargingTabJson.GetLong(element, "count") ?? 0);
    }
}

/// <summary>One charger-type tally — the native mirror of the web <c>{ type, count }</c> pie datum.</summary>
public sealed record ChargerTypeCount(string Type, long Count);

/// <summary>One start-battery distribution bucket — the native mirror of the web <c>{ range, count }</c> bar datum.</summary>
public sealed record BatteryStartBucket(string Range, long Count);

/// <summary>One hour-of-day charging tally — the native mirror of the web <c>{ hour, charges, energy }</c> datum.</summary>
public sealed record HourlyChargeBucket(int Hour, long Charges, double Energy);

/// <summary>One charger-brand tally — the native mirror of the web <c>{ brand, count }</c> leaderboard datum.</summary>
public sealed record ChargerBrandCount(string Brand, long Count);

/// <summary>
/// One month of the charging trend — the native mirror of the web
/// <c>{ month, energy, cost, sessions, avg_power, gas_cost, savings }</c> datum. The detail trend chart reads
/// energy / avg_power / sessions; the remaining fields round-trip for fidelity.
/// </summary>
public sealed record MonthlyChargeTrend(
    string Month,
    double Energy,
    double Cost,
    long Sessions,
    double AvgPower,
    double GasCost,
    double Savings);

/// <summary>
/// The <c>charging_analytics</c> slice of <c>GET /analytics/fleet</c> — the native analogue of the web
/// <c>FleetAnalytics.charging_analytics</c>. Lists default to empty and stats to null so the surface always
/// has something to render. Pure data — no WinUI types.
/// </summary>
public sealed record ChargingAnalyticsData(
    IReadOnlyList<ChargerTypeCount> ChargerTypes,
    IReadOnlyList<BatteryStartBucket> StartBatteryDist,
    IReadOnlyList<HourlyChargeBucket> HourlyPattern,
    IReadOnlyList<ChargerBrandCount> ChargerBrands,
    IReadOnlyList<MonthlyChargeTrend> MonthlyTrend,
    ChargingStats? PowerStats,
    ChargingStats? DurationStats,
    ChargingStats? EfficiencyStats,
    ChargingStats? CostStats)
{
    /// <summary>An all-empty analytics block (the parse fallback for an absent <c>charging_analytics</c>).</summary>
    public static ChargingAnalyticsData Empty { get; } = new(
        Array.Empty<ChargerTypeCount>(),
        Array.Empty<BatteryStartBucket>(),
        Array.Empty<HourlyChargeBucket>(),
        Array.Empty<ChargerBrandCount>(),
        Array.Empty<MonthlyChargeTrend>(),
        null,
        null,
        null,
        null);

    /// <summary>Project the <c>charging_analytics</c> object into a tolerant <see cref="ChargingAnalyticsData"/>.</summary>
    public static ChargingAnalyticsData FromJson(JsonElement? obj)
    {
        if (obj is not { ValueKind: JsonValueKind.Object } ca)
        {
            return Empty;
        }

        return new ChargingAnalyticsData(
            ChargerTypes: ReadList(ca, "charger_types", static e => new ChargerTypeCount(
                ChargingTabJson.GetString(e, "type") ?? string.Empty,
                ChargingTabJson.GetLong(e, "count") ?? 0)),
            StartBatteryDist: ReadList(ca, "start_battery_dist", static e => new BatteryStartBucket(
                ChargingTabJson.GetString(e, "range") ?? string.Empty,
                ChargingTabJson.GetLong(e, "count") ?? 0)),
            HourlyPattern: ReadList(ca, "hourly_pattern", static e => new HourlyChargeBucket(
                (int)(ChargingTabJson.GetLong(e, "hour") ?? 0),
                ChargingTabJson.GetLong(e, "charges") ?? 0,
                ChargingTabJson.GetDouble(e, "energy") ?? 0)),
            ChargerBrands: ReadList(ca, "charger_brands", static e => new ChargerBrandCount(
                ChargingTabJson.GetString(e, "brand") ?? string.Empty,
                ChargingTabJson.GetLong(e, "count") ?? 0)),
            MonthlyTrend: ReadList(ca, "monthly_trend", static e => new MonthlyChargeTrend(
                ChargingTabJson.GetString(e, "month") ?? string.Empty,
                ChargingTabJson.GetDouble(e, "energy") ?? 0,
                ChargingTabJson.GetDouble(e, "cost") ?? 0,
                ChargingTabJson.GetLong(e, "sessions") ?? 0,
                ChargingTabJson.GetDouble(e, "avg_power") ?? 0,
                ChargingTabJson.GetDouble(e, "gas_cost") ?? 0,
                ChargingTabJson.GetDouble(e, "savings") ?? 0)),
            PowerStats: ChargingStats.FromJson(ChargingTabJson.GetObject(ca, "power_stats")),
            DurationStats: ChargingStats.FromJson(ChargingTabJson.GetObject(ca, "duration_stats")),
            EfficiencyStats: ChargingStats.FromJson(ChargingTabJson.GetObject(ca, "efficiency_stats")),
            CostStats: ChargingStats.FromJson(ChargingTabJson.GetObject(ca, "cost_stats")));
    }

    private static IReadOnlyList<T> ReadList<T>(JsonElement obj, string name, Func<JsonElement, T> map)
    {
        var raw = ChargingTabJson.GetArray(obj, name);
        if (raw.Count == 0)
        {
            return Array.Empty<T>();
        }

        var list = new List<T>(raw.Count);
        foreach (var item in raw)
        {
            list.Add(map(item));
        }

        return list;
    }
}

/// <summary>
/// The charging-relevant slice of <c>GET /analytics/fleet</c> — the native analogue of the web
/// <c>FleetAnalytics</c> fields the charging tab reads (<c>total_charging_sessions</c>,
/// <c>total_energy_kwh</c>, <c>total_cost</c> and the whole <c>charging_analytics</c> block). Field names
/// mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial body never throws. Pure
/// data — no WinUI types.
/// </summary>
public sealed record ChargingTabData(
    long TotalChargingSessions,
    double TotalEnergyKwh,
    double TotalCost,
    ChargingAnalyticsData Analytics)
{
    /// <summary>An all-empty snapshot (the parse fallback for an absent / non-object body).</summary>
    public static ChargingTabData Empty { get; } = new(0, 0, 0, ChargingAnalyticsData.Empty);

    /// <summary>Project a fleet-analytics JSON object into a tolerant <see cref="ChargingTabData"/>.</summary>
    public static ChargingTabData FromJson(JsonElement obj)
    {
        if (obj.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new ChargingTabData(
            TotalChargingSessions: ChargingTabJson.GetLong(obj, "total_charging_sessions") ?? 0,
            TotalEnergyKwh: ChargingTabJson.GetDouble(obj, "total_energy_kwh") ?? 0,
            TotalCost: ChargingTabJson.GetDouble(obj, "total_cost") ?? 0,
            Analytics: ChargingAnalyticsData.FromJson(ChargingTabJson.GetObject(obj, "charging_analytics")));
    }
}

/// <summary>
/// The lifecycle state the charging tab can be in. Every branch maps onto a visible surface — none is ever
/// hidden (engineering rule #6). The web component itself is presentational (it takes <c>data</c> as a prop
/// and renders per-section empty states; its parent <c>AnalyticsPage</c> owns the query's loading / error /
/// stale / offline lifecycle). This self-contained native surface reproduces the web's per-section content AND
/// the parent-owned query lifecycle as explicit <see cref="Loading"/>, <see cref="Empty"/>, <see cref="Stale"/>,
/// <see cref="Offline"/> and <see cref="Error"/> branches — a strict superset that satisfies the prompt's
/// mandated state set.
/// </summary>
public enum ChargingTabState
{
    /// <summary>First fetch with nothing cached — skeleton chrome; values read '—'.</summary>
    Loading,

    /// <summary>A fresh (network or non-stale cache) result — the full content composition.</summary>
    Ready,

    /// <summary>The read resolved with no body at all — a friendly whole-surface empty state.</summary>
    Empty,

    /// <summary>A cached result older than the freshness window — content plus a stale chip (auto-refreshing).</summary>
    Stale,

    /// <summary>The network failed but cached values remain — content plus an offline chip.</summary>
    Offline,

    /// <summary>The read failed and no cached value exists — a QueryError with a retry affordance.</summary>
    Error,
}

/// <summary>
/// One projected, render-ready metric tile — the native analogue of a web <c>MetricCard</c> (label + value +
/// optional unit subtitle + accent rail + leading glyph). The value is pre-formatted (grouped number,
/// currency, or the em-dash when the source stat is absent). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record ChargingMetricCard(
    string Label,
    string Value,
    string Subtitle,
    string AccentBrushKey,
    string Glyph,
    string AutomationName);

/// <summary>One projected charger-type slice — the type name, its formatted count and a palette index.</summary>
public sealed record ChargingTypeSlice(string Type, long Count, string CountText, int ColorIndex);

/// <summary>
/// One projected start-battery distribution bar — the range label, its formatted count and the bar height as a
/// fraction (0..1) of the tallest bucket.
/// </summary>
public sealed record ChargingBatteryBar(string Range, long Count, string CountText, double HeightRatio);

/// <summary>
/// One projected hour-of-day point — the <c>{h}:00</c> axis label plus the formatted charge count and energy
/// for the dual bar (charges) + line (energy) composition.
/// </summary>
public sealed record ChargingHourBar(
    int Hour,
    string HourLabel,
    long Charges,
    string ChargesText,
    double Energy,
    string EnergyText);

/// <summary>
/// One projected charger-brand leaderboard row — its 1-based rank, brand, formatted count and the bar fill as a
/// percent (0..100) of the leading brand.
/// </summary>
public sealed record ChargingBrandRow(int Rank, string Brand, long Count, string CountText, double Percent);

/// <summary>
/// One projected month of the trend — the month label plus formatted energy / avg-power / sessions for the
/// area + line + bar composition.
/// </summary>
public sealed record ChargingMonthPoint(
    string Month,
    double Energy,
    string EnergyText,
    double AvgPower,
    string AvgPowerText,
    long Sessions,
    string SessionsText);

/// <summary>
/// One projected cost-by-charger-type row — the type, its formatted count, the share as a percent (0..100) of
/// all sessions, the formatted percent and a palette index.
/// </summary>
public sealed record ChargingCostTypeRow(
    string Type,
    long Count,
    string CountText,
    double Percent,
    string PercentText,
    int ColorIndex);

/// <summary>
/// The fully projected, render-ready view of the charging tab for one snapshot — the native analogue of what
/// the web <c>ChargingTab</c> + <c>ChargingDetailSection</c> render. Holds the six summary cards, the three
/// primary chart datasets, and the four detail datasets (brand leaderboard, monthly trend, cost-analysis cards,
/// cost-by-type bars). An empty list drives that section's empty state; none is ever hidden. Pure data so every
/// branch is asserted headlessly.
/// </summary>
public sealed record ChargingTabDisplay(
    IReadOnlyList<ChargingMetricCard> SummaryCards,
    IReadOnlyList<ChargingTypeSlice> ChargerTypes,
    IReadOnlyList<ChargingBatteryBar> BatteryDistribution,
    IReadOnlyList<ChargingHourBar> HourlyPattern,
    IReadOnlyList<ChargingBrandRow> ChargerBrands,
    IReadOnlyList<ChargingMonthPoint> MonthlyTrend,
    IReadOnlyList<ChargingMetricCard> CostCards,
    IReadOnlyList<ChargingCostTypeRow> CostByType)
{
    /// <summary>True when the cost-analysis stat block was present (web <c>costStats</c> truthy).</summary>
    public bool HasCostStats => CostCards.Count > 0;

    /// <summary>An all-empty display (the loading / no-data scaffold — cards read '—', sections are empty).</summary>
    public static ChargingTabDisplay Empty { get; } = new(
        Array.Empty<ChargingMetricCard>(),
        Array.Empty<ChargingTypeSlice>(),
        Array.Empty<ChargingBatteryBar>(),
        Array.Empty<ChargingHourBar>(),
        Array.Empty<ChargingBrandRow>(),
        Array.Empty<ChargingMonthPoint>(),
        Array.Empty<ChargingMetricCard>(),
        Array.Empty<ChargingCostTypeRow>());
}

/// <summary>
/// Pure projection from a parsed <see cref="ChargingTabData"/> to its render-ready
/// <see cref="ChargingTabDisplay"/> — the native port of
/// web/src/features/analytics/components/analytics/ChargingTab.tsx and its composed
/// <c>ChargingDetailSection</c>. The number formatting mirrors the web helpers exactly: <c>fmtInt</c> /
/// <c>fmtNumber</c> coerce a nullish source to <c>0</c> (so a null snapshot's count / energy / cost cards read
/// "0" / "0.0" / "$0.00", not the em-dash), while the average power / duration / efficiency cards reproduce the
/// web <c>powerStats ? … : '—'</c> gate (the em-dash only when the stat block is absent). The <c>safe</c>
/// helper (web <c>isFinite(v) ? v : 0</c>) guards every average. Every label resolves through the i18n facade.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ChargingTabProjection
{
    /// <summary>Em-dash shown for an absent average stat (web parity '—').</summary>
    public const string EmDash = "\u2014";

    private const string UnitKwh = "kWh";
    private const string UnitKw = "kW";
    private const string UnitPercent = "%";

    /// <summary>Project <paramref name="data"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="data">The parsed charging snapshot, or null while loading / on a hard failure.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public static ChargingTabDisplay Project(ChargingTabData? data, ILocalizer localizer, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? ChargingTabRegistration.DefaultCurrencySymbol
            : currencySymbol;
        var ca = data?.Analytics;

        return new ChargingTabDisplay(
            SummaryCards: BuildSummaryCards(data, localizer, symbol),
            ChargerTypes: BuildChargerTypes(ca),
            BatteryDistribution: BuildBatteryDistribution(ca),
            HourlyPattern: BuildHourly(ca),
            ChargerBrands: BuildBrands(ca),
            MonthlyTrend: BuildMonthly(ca),
            CostCards: BuildCostCards(ca, localizer, symbol),
            CostByType: BuildCostByType(ca));
    }

    /// <summary>Web <c>safe</c>: a finite number passes through, anything else becomes 0.</summary>
    public static double Safe(double value) => double.IsFinite(value) ? value : 0;

    /// <summary>Format a number with en-US grouping at <paramref name="decimals"/> places (web <c>fmtNumber</c>).</summary>
    public static string FormatNumber(double value, int decimals) =>
        NumberFormatting.Format(Safe(value), null, decimals);

    /// <summary>Format an integer with en-US grouping (web <c>fmtInt</c>).</summary>
    public static string FormatInt(double value) => NumberFormatting.Format(Safe(value), null, 0);

    /// <summary>Format a currency amount as <c>{symbol}{grouped,2dp}</c> (web <c>formatCurrency(x, 2)</c>).</summary>
    public static string FormatCurrency(double value, string symbol) =>
        symbol + NumberFormatting.Format(Safe(value), null, 2);

    private static IReadOnlyList<ChargingMetricCard> BuildSummaryCards(
        ChargingTabData? data, ILocalizer localizer, string symbol)
    {
        var ca = data?.Analytics;
        string sessions = FormatInt(data?.TotalChargingSessions ?? 0);
        string energy = FormatNumber(data?.TotalEnergyKwh ?? 0, 1);
        string cost = FormatCurrency(data?.TotalCost ?? 0, symbol);
        string power = ca?.PowerStats is { } ps ? FormatNumber(ps.Avg, 1) : EmDash;
        string duration = ca?.DurationStats is { } ds ? FormatNumber(ds.Avg, 0) : EmDash;
        string efficiency = ca?.EfficiencyStats is { } es ? FormatNumber(es.Avg, 1) : EmDash;

        return
        [
            Card(ChargingTabRegistration.SessionsLabel(localizer), sessions, string.Empty,
                "TsColorInfoBrush", ChargingTabRegistration.SessionsGlyph),
            Card(ChargingTabRegistration.TotalEnergyLabel(localizer), energy, UnitKwh,
                "TsColorSuccessBrush", ChargingTabRegistration.EnergyGlyph),
            Card(ChargingTabRegistration.TotalCostLabel(localizer), cost, string.Empty,
                "TsColorWarningBrush", ChargingTabRegistration.CostGlyph),
            Card(ChargingTabRegistration.AvgPowerLabel(localizer), power, UnitKw,
                "TsColorAccentBrush", ChargingTabRegistration.PowerGlyph),
            Card(ChargingTabRegistration.AvgDurationLabel(localizer), duration, ChargingTabRegistration.MinUnit(localizer),
                "TsColorInfoBrush", ChargingTabRegistration.DurationGlyph),
            Card(ChargingTabRegistration.ChargeEfficiencyLabel(localizer), efficiency, UnitPercent,
                "TsColorSuccessBrush", ChargingTabRegistration.EfficiencyGlyph),
        ];
    }

    private static IReadOnlyList<ChargingTypeSlice> BuildChargerTypes(ChargingAnalyticsData? ca)
    {
        var types = ca?.ChargerTypes ?? Array.Empty<ChargerTypeCount>();
        if (types.Count == 0)
        {
            return Array.Empty<ChargingTypeSlice>();
        }

        var slices = new List<ChargingTypeSlice>(types.Count);
        for (int i = 0; i < types.Count; i++)
        {
            var t = types[i];
            slices.Add(new ChargingTypeSlice(t.Type, t.Count, FormatInt(t.Count), i));
        }

        return slices;
    }

    private static IReadOnlyList<ChargingBatteryBar> BuildBatteryDistribution(ChargingAnalyticsData? ca)
    {
        var buckets = ca?.StartBatteryDist ?? Array.Empty<BatteryStartBucket>();
        if (buckets.Count == 0)
        {
            return Array.Empty<ChargingBatteryBar>();
        }

        long max = 0;
        foreach (var b in buckets)
        {
            if (b.Count > max)
            {
                max = b.Count;
            }
        }

        var bars = new List<ChargingBatteryBar>(buckets.Count);
        foreach (var b in buckets)
        {
            double ratio = max > 0 ? Math.Clamp(b.Count / (double)max, 0.0, 1.0) : 0.0;
            bars.Add(new ChargingBatteryBar(b.Range, b.Count, FormatInt(b.Count), ratio));
        }

        return bars;
    }

    private static IReadOnlyList<ChargingHourBar> BuildHourly(ChargingAnalyticsData? ca)
    {
        var hourly = ca?.HourlyPattern ?? Array.Empty<HourlyChargeBucket>();
        if (hourly.Count == 0)
        {
            return Array.Empty<ChargingHourBar>();
        }

        var bars = new List<ChargingHourBar>(hourly.Count);
        foreach (var h in hourly)
        {
            string label = string.Create(CultureInfo.InvariantCulture, $"{h.Hour}:00");
            bars.Add(new ChargingHourBar(
                h.Hour, label, h.Charges, FormatInt(h.Charges), h.Energy, FormatNumber(h.Energy, 1)));
        }

        return bars;
    }

    private static IReadOnlyList<ChargingBrandRow> BuildBrands(ChargingAnalyticsData? ca)
    {
        var brands = ca?.ChargerBrands ?? Array.Empty<ChargerBrandCount>();
        if (brands.Count == 0)
        {
            return Array.Empty<ChargingBrandRow>();
        }

        // web: maxCount = brands.reduce(max, safe(count)) || 1
        long max = 0;
        foreach (var b in brands)
        {
            if (b.Count > max)
            {
                max = b.Count;
            }
        }

        double denom = max > 0 ? max : 1;
        var rows = new List<ChargingBrandRow>(brands.Count);
        for (int i = 0; i < brands.Count; i++)
        {
            var b = brands[i];
            double pct = b.Count / denom * 100.0;
            rows.Add(new ChargingBrandRow(i + 1, b.Brand, b.Count, FormatInt(b.Count), pct));
        }

        return rows;
    }

    private static IReadOnlyList<ChargingMonthPoint> BuildMonthly(ChargingAnalyticsData? ca)
    {
        var months = ca?.MonthlyTrend ?? Array.Empty<MonthlyChargeTrend>();
        if (months.Count == 0)
        {
            return Array.Empty<ChargingMonthPoint>();
        }

        var points = new List<ChargingMonthPoint>(months.Count);
        foreach (var m in months)
        {
            points.Add(new ChargingMonthPoint(
                m.Month,
                m.Energy, FormatNumber(m.Energy, 1),
                m.AvgPower, FormatNumber(m.AvgPower, 1),
                m.Sessions, FormatInt(m.Sessions)));
        }

        return points;
    }

    private static ChargingMetricCard[] BuildCostCards(
        ChargingAnalyticsData? ca, ILocalizer localizer, string symbol)
    {
        if (ca?.CostStats is not { } cost)
        {
            return Array.Empty<ChargingMetricCard>();
        }

        return
        [
            Card(ChargingTabRegistration.MinCostLabel(localizer), FormatCurrency(cost.Min, symbol), string.Empty,
                "TsColorSuccessBrush", ChargingTabRegistration.CostGlyph),
            Card(ChargingTabRegistration.AvgCostLabel(localizer), FormatCurrency(cost.Avg, symbol), string.Empty,
                "TsColorInfoBrush", ChargingTabRegistration.CostGlyph),
            Card(ChargingTabRegistration.MedianCostLabel(localizer), FormatCurrency(cost.Median, symbol), string.Empty,
                "TsColorAccentBrush", ChargingTabRegistration.CostGlyph),
            Card(ChargingTabRegistration.MaxCostLabel(localizer), FormatCurrency(cost.Max, symbol), string.Empty,
                "TsColorWarningBrush", ChargingTabRegistration.CostGlyph),
        ];
    }

    private static IReadOnlyList<ChargingCostTypeRow> BuildCostByType(ChargingAnalyticsData? ca)
    {
        var types = ca?.ChargerTypes ?? Array.Empty<ChargerTypeCount>();
        if (types.Count == 0)
        {
            return Array.Empty<ChargingCostTypeRow>();
        }

        // web: totalSessions = sum(count); pct = total > 0 ? count/total*100 : 0
        long total = 0;
        foreach (var t in types)
        {
            total += t.Count;
        }

        var rows = new List<ChargingCostTypeRow>(types.Count);
        for (int i = 0; i < types.Count; i++)
        {
            var t = types[i];
            double pct = total > 0 ? t.Count / (double)total * 100.0 : 0.0;
            rows.Add(new ChargingCostTypeRow(t.Type, t.Count, FormatInt(t.Count), pct, FormatInt(pct), i));
        }

        return rows;
    }

    private static ChargingMetricCard Card(
        string label, string value, string subtitle, string accentKey, string glyph)
    {
        string spoken = string.IsNullOrEmpty(subtitle)
            ? string.Create(CultureInfo.CurrentCulture, $"{label}: {value}")
            : string.Create(CultureInfo.CurrentCulture, $"{label}: {value} {subtitle}");
        return new ChargingMetricCard(label, value, subtitle, accentKey, glyph, spoken);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions to typed
/// <c>RepositoryResult&lt;ChargingTabData&gt;</c>, preserving the cache-then-network status / freshness while
/// parsing the snake_case payload (the native analogue of the web hook's typed query result). The
/// fleet-analytics endpoint returns a populated object even when every charging list is empty, so the mapper
/// never collapses a content body to empty — the per-section "no data" treatment is decided by the projection
/// from the parsed lists. Pure — unit-tested without a network or cache.
/// </summary>
public static class ChargingTabResultMapper
{
    /// <summary>Map a raw fleet-analytics emission to a typed charging result.</summary>
    public static RepositoryResult<ChargingTabData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        switch (raw.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<ChargingTabData>.Loading();

            case LoadStatus.Empty:
                return RepositoryResult<ChargingTabData>.Empty(raw.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<ChargingTabData>.Failure(
                    raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }

        var data = ChargingTabData.FromJson(raw.Value);
        var fetchedAt = raw.FetchedAt ?? DateTimeOffset.UtcNow;

        return raw.Status switch
        {
            LoadStatus.Cached => RepositoryResult<ChargingTabData>.Cached(data, fetchedAt, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ChargingTabData>.Refreshing(data, fetchedAt, raw.IsStale),
            LoadStatus.Offline => RepositoryResult<ChargingTabData>.OfflineCached(
                data, fetchedAt, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
            _ => RepositoryResult<ChargingTabData>.Loaded(data, fetchedAt),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Charging analytics surface — the native mirror of the web component
/// (web/src/features/analytics/components/analytics/ChargingTab.tsx + ChargingDetailSection.tsx). Centralises
/// the diagnostics slug, the Segoe Fluent glyphs standing in for the web Lucide icons, the default currency
/// symbol, and the localized copy (the same <c>analytics.charging.*</c> i18n keys the web component uses) so
/// the view and view-model stay free of literal strings.
/// </summary>
public static class ChargingTabRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ChargingTab";

    /// <summary>The default currency symbol (web parity for an unset <c>settings.currency_symbol</c>).</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Segoe Fluent "Lightbulb" glyph — native stand-in for the web Lucide <c>Plug</c> icon.</summary>
    public const string SessionsGlyph = "\uE945";

    /// <summary>Segoe Fluent "EnergySaver" glyph — native stand-in for the web Lucide <c>Zap</c> icon.</summary>
    public const string EnergyGlyph = "\uEC0A";

    /// <summary>Segoe Fluent "Market" glyph — native stand-in for the web Lucide <c>DollarSign</c> icon.</summary>
    public const string CostGlyph = "\uEAFC";

    /// <summary>Segoe Fluent "Speed" glyph — native stand-in for the web Lucide <c>Gauge</c> icon.</summary>
    public const string PowerGlyph = "\uEC4A";

    /// <summary>Segoe Fluent "Stopwatch" glyph — native stand-in for the web Lucide <c>Timer</c> icon.</summary>
    public const string DurationGlyph = "\uE916";

    /// <summary>Segoe Fluent "Health" glyph — native stand-in for the web Lucide <c>TrendingUp</c> icon.</summary>
    public const string EfficiencyGlyph = "\uE9D9";

    // ── Summary card labels (web analytics.charging.* keys) ───────────────────────────────────────────

    /// <summary>"Sessions" summary / series label (web <c>analytics.charging.sessions</c>).</summary>
    public static string SessionsLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.sessions", "Sessions");

    /// <summary>"Total Energy" summary label (web <c>analytics.charging.totalEnergy</c>).</summary>
    public static string TotalEnergyLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.totalEnergy", "Total Energy");

    /// <summary>"Total Cost" summary label (web <c>analytics.charging.totalCost</c>).</summary>
    public static string TotalCostLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.totalCost", "Total Cost");

    /// <summary>"Avg Power" summary label (web <c>analytics.charging.avgPower</c>).</summary>
    public static string AvgPowerLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.avgPower", "Avg Power");

    /// <summary>"Avg Duration" summary label (web <c>analytics.charging.avgDuration</c>).</summary>
    public static string AvgDurationLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.avgDuration", "Avg Duration");

    /// <summary>"min" duration unit subtitle (web <c>analytics.charging.min</c>).</summary>
    public static string MinUnit(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.min", "min");

    /// <summary>"Charge Efficiency" summary label (web <c>analytics.charging.chargeEff</c>).</summary>
    public static string ChargeEfficiencyLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.chargeEff", "Charge Efficiency");

    // ── Section titles ────────────────────────────────────────────────────────────────────────────────

    /// <summary>"Charger Types" panel title (web <c>analytics.charging.chargerTypes</c>).</summary>
    public static string ChargerTypesTitle(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.chargerTypes", "Charger Types");

    /// <summary>"Start Battery Distribution" panel title (web <c>analytics.charging.startBattery</c>).</summary>
    public static string StartBatteryTitle(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.startBattery", "Start Battery Distribution");

    /// <summary>"Hourly Charging Pattern" panel title (web <c>analytics.charging.hourlyPattern</c>).</summary>
    public static string HourlyPatternTitle(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.hourlyPattern", "Hourly Charging Pattern");

    /// <summary>"Charger Brands" panel title (web <c>analytics.charging.chargerBrands</c>).</summary>
    public static string ChargerBrandsTitle(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.chargerBrands", "Charger Brands");

    /// <summary>"Monthly Charging Trend" panel title (web <c>analytics.charging.monthlyTrend</c>).</summary>
    public static string MonthlyTrendTitle(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.monthlyTrend", "Monthly Charging Trend");

    /// <summary>"Cost Analysis" panel title (web <c>analytics.charging.costAnalysis</c>).</summary>
    public static string CostAnalysisTitle(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.costAnalysis", "Cost Analysis");

    /// <summary>"Cost by Charger Type" panel title (web <c>analytics.charging.costByType</c>).</summary>
    public static string CostByTypeTitle(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.costByType", "Cost by Charger Type");

    // ── Series / legend names ─────────────────────────────────────────────────────────────────────────

    /// <summary>"Charges" series name (web <c>analytics.charging.charges</c>).</summary>
    public static string ChargesSeries(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.charges", "Charges");

    /// <summary>"Energy (kWh)" series name (web <c>analytics.charging.energykWh</c>).</summary>
    public static string EnergySeries(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.energykWh", "Energy (kWh)");

    /// <summary>"Avg Power (kW)" series name (web <c>analytics.charging.avgPowerkW</c>).</summary>
    public static string AvgPowerSeries(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.avgPowerkW", "Avg Power (kW)");

    // ── Cost-analysis card labels ─────────────────────────────────────────────────────────────────────

    /// <summary>"Min Cost" card label (web <c>analytics.charging.minCost</c>).</summary>
    public static string MinCostLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.minCost", "Min Cost");

    /// <summary>"Avg Cost" card label (web <c>analytics.charging.avgCost</c>).</summary>
    public static string AvgCostLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.avgCost", "Avg Cost");

    /// <summary>"Median Cost" card label (web <c>analytics.charging.medianCost</c>).</summary>
    public static string MedianCostLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.medianCost", "Median Cost");

    /// <summary>"Max Cost" card label (web <c>analytics.charging.maxCost</c>).</summary>
    public static string MaxCostLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.maxCost", "Max Cost");

    // ── Per-section empty messages ────────────────────────────────────────────────────────────────────

    /// <summary>Charger-types empty message (web <c>analytics.charging.noTypes</c>).</summary>
    public static string NoChargerTypes(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.noTypes", "No charger type data");

    /// <summary>Battery-distribution empty message (web <c>analytics.charging.noBatDist</c>).</summary>
    public static string NoBatteryDistribution(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.noBatDist", "No battery distribution data");

    /// <summary>Hourly-pattern empty message (web <c>analytics.charging.noHourly</c>).</summary>
    public static string NoHourly(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.noHourly", "No hourly data");

    /// <summary>Charger-brands empty message (web <c>analytics.charging.noBrands</c>).</summary>
    public static string NoBrands(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.noBrands", "No charger brand data");

    /// <summary>Monthly-trend empty message (web <c>analytics.charging.noMonthly</c>).</summary>
    public static string NoMonthly(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.noMonthly", "No monthly data");

    /// <summary>Cost-statistics empty message (web <c>analytics.charging.noCostStats</c>).</summary>
    public static string NoCostStats(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.noCostStats", "No cost statistics");

    /// <summary>Cost-by-type empty message (web <c>analytics.charging.noCostByType</c>).</summary>
    public static string NoCostByType(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.noCostByType", "No charger type data");

    // ── Surface chrome (native superset; the web parent owns the query lifecycle) ─────────────────────

    /// <summary>The surface title used for the accessible name (web tab label "Charging").</summary>
    public static string SurfaceTitle(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.tabTitle", "Charging");

    /// <summary>"sessions" lowercase word for the brand leaderboard count line.</summary>
    public static string SessionsWord(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.sessionsWord", "sessions");

    /// <summary>Stale freshness chip label (native superset; the web parent owns freshness).</summary>
    public static string StaleLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.status.stale", "Stale");

    /// <summary>Offline freshness chip label (native superset).</summary>
    public static string OfflineLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.status.offline", "Offline");

    /// <summary>Retry affordance label for the hard-error branch (native superset).</summary>
    public static string RetryLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.status.retry", "Retry");

    /// <summary>Loading announcement label (native superset).</summary>
    public static string LoadingLabel(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.status.loading", "Loading\u2026");

    /// <summary>Hard-error message (native superset; the web parent renders QueryError).</summary>
    public static string ErrorText(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.status.error", "Couldn't load charging analytics");

    /// <summary>Offline message shown alongside the cached content (native superset).</summary>
    public static string OfflineText(ILocalizer localizer) =>
        Require(localizer).GetString(
            "analytics.charging.status.offlineMessage",
            "You're offline — showing the last cached charging analytics");

    /// <summary>Whole-surface empty message for a null body (native superset).</summary>
    public static string EmptyText(ILocalizer localizer) =>
        Require(localizer).GetString("analytics.charging.status.empty", "No charging analytics available");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// PII-safe diagnostics for the Charging analytics surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session count, energy figure, cost or
/// any operator data — so a diagnostics line can never leak analytics. Thread-safe.
/// </summary>
public sealed class ChargingTabDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no user data is ever passed).</param>
    public ChargingTabDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingTab</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingTabRegistration.Slug}");
    }
}
