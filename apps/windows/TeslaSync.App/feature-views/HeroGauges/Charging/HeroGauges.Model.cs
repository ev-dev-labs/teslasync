using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The mutually-exclusive lifecycle state the charging <see cref="HeroGaugesViewModel"/> can be in — the
/// native superset of the branches the web charging-list Hero Gauges renders
/// (web/src/features/charging/components/charging-list/HeroGauges.tsx). The web component is a pure child of
/// the Charging-list page (it takes <c>stats: ChargingStats | null</c> and shows either the four radial
/// gauges plus the average-cost tile, or a friendly empty state when <c>stats</c> is null). The native
/// surface binds its own cache-then-network read of the charging sessions, so it owns the full
/// loading / loaded / empty / error / stale / offline matrix the P2 state contract requires. Every value
/// maps onto a visible surface (never a blank panel).
/// </summary>
public enum HeroGaugesState
{
    /// <summary>Initial fetch with no cached snapshot — render the gauge skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one charging session — render the four gauges + cost tile.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no charging sessions — render the empty state (web <c>stats === null</c>).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauges plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauges plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The categorical accent a gauge renders its value arc with — the native mirror of the literal neon hue the
/// web source passes each <c>RadialGauge</c> (<c>#00f0ff</c> cyan, <c>#10b981</c> green, <c>#f59e0b</c> amber,
/// <c>#a855f7</c> purple). Kept WinUI-free so the projection can assign and the tests can assert the per-gauge
/// colour without a UI host; the view maps each value to a themed chart brush at render time.
/// </summary>
public enum HeroGaugeAccent
{
    /// <summary>Cyan (web <c>#00f0ff</c>) — the sessions gauge.</summary>
    Cyan,

    /// <summary>Green (web <c>#10b981</c>) — the energy gauge.</summary>
    Green,

    /// <summary>Amber (web <c>#f59e0b</c>) — the total-cost gauge.</summary>
    Amber,

    /// <summary>Purple (web <c>#a855f7</c>) — the average-power gauge.</summary>
    Purple,
}

/// <summary>
/// The aggregate charging figures the web charging-list Hero Gauges shows — the native mirror of the web
/// <c>ChargingStats</c> shape (web/src/features/charging/components/charging-list/helpers.ts) reduced by the
/// page <c>computeStats</c>. Reproduced verbatim for parity:
/// <list type="bullet">
/// <item><c>TotalEnergyKwh</c> is the SI <c>total_energy_added_wh</c> sum divided by 1000 (web
/// <c>convertEnergyFromSI(..., 'kWh')</c>).</item>
/// <item><c>AvgPowerKw</c> averages <c>peak_power_w / 1000</c> over only the sessions whose
/// <c>peak_power_w</c> is truthy (the web <c>sessions.filter(s =&gt; s.peak_power_w)</c>), dividing by
/// <c>max(count, 1)</c>.</item>
/// <item><c>AvgCostPerKwh</c> is <c>TotalCost / TotalEnergyKwh</c> (0 when there is no energy).</item>
/// </list>
/// WinUI-free so the reduction is unit-tested without a UI host.
/// </summary>
/// <param name="Count">Number of charging sessions (web <c>stats.count</c>).</param>
/// <param name="TotalEnergyKwh">Total energy added in kilowatt-hours (web <c>stats.totalEnergy</c>).</param>
/// <param name="TotalCost">Total charging cost in the user's currency (web <c>stats.totalCost</c>).</param>
/// <param name="AvgPowerKw">Average peak power in kilowatts (web <c>stats.avgPower</c>).</param>
/// <param name="AvgCostPerKwh">Average cost per kilowatt-hour (web <c>stats.avgCostPerKwh</c>).</param>
public sealed record ChargingStats(
    int Count,
    double TotalEnergyKwh,
    double TotalCost,
    double AvgPowerKw,
    double AvgCostPerKwh)
{
    /// <summary>The no-sessions snapshot — the parse fallback for an absent/non-array body (web <c>stats === null</c>).</summary>
    public static ChargingStats Empty { get; } = new(0, 0, 0, 0, 0);

    /// <summary>True when at least one charging session backed the figures (web <c>stats !== null</c>).</summary>
    public bool HasData => Count > 0;

    /// <summary>
    /// Reduce a <c>GET /charging-sessions</c> JSON array into the charging figures — the native port of the
    /// charging-list page <c>computeStats</c>. A non-array body or an empty array yields <see cref="Empty"/>
    /// (the web memo returns <see langword="null"/> for an empty list). Parsing is null-tolerant (the web
    /// <c>?? 0</c>) so a partial row never throws.
    /// </summary>
    /// <param name="element">The parsed charging-sessions JSON body.</param>
    /// <returns>The reduced figures, or <see cref="Empty"/> when there are no sessions.</returns>
    public static ChargingStats FromSessionsJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        int count = 0;
        double totalEnergyWh = 0;
        double totalCost = 0;
        double sumPeakPowerW = 0;
        int withPowerCount = 0;

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            count++;
            totalEnergyWh += ChargingStatsJson.GetDouble(item, "total_energy_added_wh") ?? 0;
            totalCost += ChargingStatsJson.GetDouble(item, "cost_decimal") ?? 0;

            // web: withPower = sessions.filter(s => s.peak_power_w) — only truthy (non-zero) powers contribute.
            double? peak = ChargingStatsJson.GetDouble(item, "peak_power_w");
            if (peak is { } p && p != 0)
            {
                sumPeakPowerW += p;
                withPowerCount++;
            }
        }

        if (count == 0)
        {
            return Empty;
        }

        double totalEnergyKwh = totalEnergyWh / 1000.0;
        double avgPowerKw = (sumPeakPowerW / Math.Max(withPowerCount, 1)) / 1000.0;
        double avgCostPerKwh = totalEnergyKwh > 0 ? totalCost / totalEnergyKwh : 0;

        return new ChargingStats(count, totalEnergyKwh, totalCost, avgPowerKw, avgCostPerKwh);
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the charging Hero Gauges — the numeric getter tolerates
/// a numeric or numeric-string field and rejects NaN/Infinity, so a partial or schema-drifted session row
/// never aborts the reduction (web parity: the page tolerates undefined fields with <c>?? 0</c>). WinUI-free.
/// </summary>
internal static class ChargingStatsJson
{
    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, render-ready radial gauge — the native analogue of one web <c>&lt;RadialGauge&gt;</c>. Holds
/// the localized label, the numeric value and its full-sweep maximum (so the view's gauge arc matches the web
/// sweep), the literal unit suffix, the fixed decimal precision, the categorical accent (so the value arc
/// colour matches the web neon hue) and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized gauge label (web <c>RadialGauge label</c>).</param>
/// <param name="Value">The numeric value the gauge displays (web <c>RadialGauge value</c>).</param>
/// <param name="Max">The value mapped to a full sweep (web <c>RadialGauge max</c>).</param>
/// <param name="Unit">The literal unit suffix, or empty (web <c>RadialGauge unit</c>).</param>
/// <param name="Decimals">Fixed fraction digits for the rendered value.</param>
/// <param name="Accent">The categorical value-arc accent (web <c>RadialGauge color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the gauge.</param>
public sealed record HeroGauge(
    string Label,
    double Value,
    double Max,
    string Unit,
    int Decimals,
    HeroGaugeAccent Accent,
    string AutomationName);

/// <summary>
/// The projected, render-ready average-cost tile — the native analogue of the web's fifth column, a large
/// currency-prefixed <c>&lt;AnimatedNumber&gt;</c> over an uppercase caption. Holds the numeric value (rounded
/// to two decimals, the web <c>parseFloat(fmtNumber(..., 2))</c>), the display precision (three digits, the
/// web <c>decimals={3}</c>), the currency prefix and a Narrator automation name. Pure data.
/// </summary>
/// <param name="Label">The localized tile label (web <c>charging.gauges.avgCostPerKwh</c>).</param>
/// <param name="Value">The numeric value the animated number counts to.</param>
/// <param name="Decimals">Fraction digits for the rendered value (web <c>decimals={3}</c>).</param>
/// <param name="Prefix">The currency prefix shown before the value (web literal <c>$</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the tile.</param>
public sealed record HeroCostTile(
    string Label,
    double Value,
    int Decimals,
    string Prefix,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the charging Hero Gauges — the native analogue of everything the
/// web component composes before returning its grid of four <c>&lt;RadialGauge&gt;</c>s plus the average-cost
/// tile. Holds the four gauges, the cost tile, the data flag and the surface's accessible name. Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when real charging sessions backed the figures.</param>
/// <param name="Gauges">The four display-ready radial gauges, in web order.</param>
/// <param name="CostPerKwh">The average-cost-per-kWh tile.</param>
/// <param name="AutomationName">The composed Narrator name for the whole surface.</param>
public sealed record HeroGaugesDisplay(
    bool HasData,
    IReadOnlyList<HeroGauge> Gauges,
    HeroCostTile CostPerKwh,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ChargingStats"/> to the four-gauge + cost-tile display model — the
/// native port of the render logic in web/src/features/charging/components/charging-list/HeroGauges.tsx. The
/// gauges reproduce the web call sites one-for-one: the value the web passes each <c>RadialGauge</c>
/// (<c>count</c>, <c>round(totalEnergy)</c>, <c>round(totalCost)</c>, <c>round(avgPower)</c>) and the same
/// <c>max(value, floor)</c> ceilings (sessions 50, energy 500, cost 100) or fixed maximum (power 250). The
/// energy ("kWh") and power ("kW") suffixes are SI symbols the web hard-codes, so they stay literal; every
/// translatable label resolves through the i18n facade using the keys the web source passes to <c>t()</c>.
/// WinUI-free — unit-tested without a UI host.
/// </summary>
public static class HeroGaugesProjection
{
    /// <summary>Full-sweep floor for the sessions gauge (web <c>Math.max(count, 50)</c>).</summary>
    public const double SessionsFloor = 50;

    /// <summary>Full-sweep floor for the energy gauge (web <c>Math.max(totalEnergy, 500)</c>).</summary>
    public const double EnergyFloor = 500;

    /// <summary>Full-sweep floor for the total-cost gauge (web <c>Math.max(totalCost, 100)</c>).</summary>
    public const double CostFloor = 100;

    /// <summary>Fixed full-sweep maximum for the average-power gauge (web <c>max={250}</c>).</summary>
    public const double PowerMax = 250;

    /// <summary>Fraction digits the radial gauges render (the web passes pre-rounded integers).</summary>
    public const int GaugeDecimals = 0;

    /// <summary>Decimal digits the average-cost value is rounded to before display (web <c>fmtNumber(..., 2)</c>).</summary>
    public const int CostRoundDigits = 2;

    /// <summary>Fraction digits the average-cost animated number renders (web <c>decimals={3}</c>).</summary>
    public const int CostDisplayDecimals = 3;

    /// <summary>The energy unit suffix the web grid passes the energy gauge.</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>The power unit suffix the web grid passes the average-power gauge.</summary>
    public const string PowerUnit = "kW";

    /// <summary>Project <paramref name="stats"/> using the user's <paramref name="currencySymbol"/> + i18n facade.</summary>
    /// <param name="stats">The reduced charging figures.</param>
    /// <param name="currencySymbol">The currency symbol for the cost gauge + cost tile (blank falls back to "$").</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The four display-ready gauges plus the cost tile and data flag.</returns>
    public static HeroGaugesDisplay Project(ChargingStats stats, string currencySymbol, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(stats);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        string sessionsLabel = localizer.GetString("charging.gauges.sessions", "Sessions");
        string energyLabel = localizer.GetString("charging.gauges.energy", "Energy");
        string totalCostLabel = localizer.GetString("charging.gauges.totalCost", "Total Cost");
        string avgPowerLabel = localizer.GetString("charging.gauges.avgPower", "Avg Power");
        string avgCostLabel = localizer.GetString("charging.gauges.avgCostPerKwh", "Avg $/kWh");

        var gauges = new[]
        {
            Gauge(sessionsLabel, stats.Count, Math.Max(stats.Count, SessionsFloor), unit: string.Empty, HeroGaugeAccent.Cyan),
            Gauge(energyLabel, Round(stats.TotalEnergyKwh), Math.Max(stats.TotalEnergyKwh, EnergyFloor), EnergyUnit, HeroGaugeAccent.Green),
            Gauge(totalCostLabel, Round(stats.TotalCost), Math.Max(stats.TotalCost, CostFloor), symbol, HeroGaugeAccent.Amber),
            Gauge(avgPowerLabel, Round(stats.AvgPowerKw), PowerMax, PowerUnit, HeroGaugeAccent.Purple),
        };

        double costValue = Math.Round(stats.AvgCostPerKwh, CostRoundDigits, MidpointRounding.AwayFromZero);
        var costTile = CostTile(avgCostLabel, costValue, symbol);

        return new HeroGaugesDisplay(
            stats.HasData,
            gauges,
            costTile,
            localizer.GetString("charging.gauges.aria", "Charging statistics"));
    }

    private static double Round(double value) => Math.Round(value, MidpointRounding.AwayFromZero);

    private static HeroGauge Gauge(string label, double value, double max, string unit, HeroGaugeAccent accent)
    {
        string formatted = ScalarFormatters.FormatNumber(value, GaugeDecimals);
        string automation = string.IsNullOrEmpty(unit)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, formatted)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, formatted, unit);
        return new HeroGauge(label, value, max, unit, GaugeDecimals, accent, automation);
    }

    private static HeroCostTile CostTile(string label, double value, string prefix)
    {
        string formatted = ScalarFormatters.FormatNumber(value, CostDisplayDecimals);
        string automation = string.Format(CultureInfo.CurrentCulture, "{0}: {1}{2}", label, prefix, formatted);
        return new HeroCostTile(label, value, CostDisplayDecimals, prefix, automation);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto reduced
/// <c>RepositoryResult&lt;ChargingStats&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class HeroGaugesResultMapper
{
    /// <summary>Reduce <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The same emission with its session array reduced into a <see cref="ChargingStats"/>.</returns>
    public static RepositoryResult<ChargingStats> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargingStats Parse() => raw.HasValue ? ChargingStats.FromSessionsJson(raw.Value) : ChargingStats.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargingStats>.Loading(),
            LoadStatus.Cached => RepositoryResult<ChargingStats>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ChargingStats>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<ChargingStats>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<ChargingStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<ChargingStats>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<ChargingStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
