using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The lifecycle state a <see cref="HeroGaugesViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web source
/// (web/src/features/analytics/components/analytics/HeroGauges.tsx) is a presentational child that only
/// distinguishes a skeleton (data <c>undefined</c>) from the six rendered gauges; the parent analytics
/// page owns the network-failure / freshness branches. The native feature view binds the same
/// <c>GET /analytics/fleet</c> data through a shared state holder, so it reproduces every one of those
/// branches as a visible surface — none is ever hidden. <see cref="Empty"/> mirrors a fleet with no
/// distance, no energy and no drives rather than an empty HTTP body (the endpoint always returns a
/// populated object).
/// </summary>
public enum HeroGaugesState
{
    /// <summary>Initial fetch with no cached snapshot — render the six skeleton tiles.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with data to show — render the six gauges.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no distance, energy or drives — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauges plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauges plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The categorical accent a gauge tile renders with — the native mirror of the web
/// <c>MetricCard color</c> neon hue (web/src/lib/tokens.ts <c>neonColorMap</c>). Kept WinUI-free so the
/// projection can assign and the tests can assert the per-gauge colour without a UI host; the view maps
/// each value to a themed brush at render time.
/// </summary>
public enum HeroGaugeAccent
{
    /// <summary>Cyan (web <c>cyan</c>) — the distance gauge.</summary>
    Cyan,

    /// <summary>Purple (web <c>purple</c>) — the drives gauge.</summary>
    Purple,

    /// <summary>Green (web <c>green</c>) — the energy, gas-savings and CO₂ gauges.</summary>
    Green,

    /// <summary>Amber (web <c>amber</c>) — the efficiency gauge.</summary>
    Amber,
}

/// <summary>
/// The fleet analytics rollup from <c>GET /analytics/fleet</c> consumed by the hero gauges (web
/// <c>FleetAnalytics</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags
/// (<c>total_distance_km</c>, <c>total_drives</c>, <c>total_energy_kwh</c>, <c>avg_efficiency_wh_km</c>,
/// <c>total_cost</c>); parsing is null-tolerant so a partial body never throws. Distance is kilometres
/// and efficiency is Wh/km — both converted to the user's display unit only at projection time.
/// </summary>
/// <param name="TotalDistanceKm">Fleet distance in SI-derived kilometres (web <c>total_distance_km</c>).</param>
/// <param name="TotalDrives">Total completed drives, a count (web <c>total_drives</c>).</param>
/// <param name="TotalEnergyKwh">Energy consumed in kilowatt-hours (web <c>total_energy_kwh</c>).</param>
/// <param name="AvgEfficiencyWhKm">Energy intensity in watt-hours per kilometre (web <c>avg_efficiency_wh_km</c>).</param>
/// <param name="TotalCost">Charging cost in the user's currency (web <c>total_cost</c>).</param>
public sealed record HeroFleetAnalytics(
    double TotalDistanceKm,
    double TotalDrives,
    double TotalEnergyKwh,
    double AvgEfficiencyWhKm,
    double TotalCost)
{
    /// <summary>An all-zero snapshot — the parse fallback for an absent/non-object body.</summary>
    public static HeroFleetAnalytics Empty { get; } = new(0, 0, 0, 0, 0);

    /// <summary>
    /// True when there is something worth showing — at least some distance, energy or drives. Gates the
    /// empty state (the web component always renders the six tiles; the native surface shows a friendly
    /// empty state instead of six zero tiles, per the feature-view state contract).
    /// </summary>
    public bool HasData => TotalDistanceKm > 0 || TotalEnergyKwh > 0 || TotalDrives > 0;

    /// <summary>Project a <c>GET /analytics/fleet</c> JSON object into a tolerant snapshot.</summary>
    /// <param name="element">The parsed JSON body.</param>
    /// <returns>A snapshot with every absent or non-numeric field defaulted to zero.</returns>
    public static HeroFleetAnalytics FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new HeroFleetAnalytics(
            TotalDistanceKm: GetDouble(element, "total_distance_km") ?? 0,
            TotalDrives: GetDouble(element, "total_drives") ?? 0,
            TotalEnergyKwh: GetDouble(element, "total_energy_kwh") ?? 0,
            AvgEfficiencyWhKm: GetDouble(element, "avg_efficiency_wh_km") ?? 0,
            TotalCost: GetDouble(element, "total_cost") ?? 0);
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
}

/// <summary>
/// One projected, display-ready gauge tile consumed by the WinUI view — the native analogue of one web
/// <c>&lt;MetricCard&gt;</c>. Holds the localized label, the already-formatted value, the optional unit
/// sub-line, the resolved Fluent glyph, the categorical accent (so the tile's icon colour matches the
/// web neon hue), and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized tile label (web <c>MetricCard label</c>).</param>
/// <param name="Value">The pre-formatted headline value (web <c>MetricCard value</c>).</param>
/// <param name="Subtitle">The optional unit sub-line, or <see langword="null"/> (web <c>MetricCard subtitle</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph for the tile icon (web <c>MetricCard icon</c>).</param>
/// <param name="Accent">The categorical icon accent (web <c>MetricCard color</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the tile.</param>
public sealed record HeroGauge(
    string Label,
    string Value,
    string? Subtitle,
    string Glyph,
    HeroGaugeAccent Accent,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the hero gauges — the native analogue of everything the web
/// component computes before returning its grid of six <c>&lt;MetricCard&gt;</c> tiles. Holds the six
/// gauges plus the data flag. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when the snapshot has distance, energy or drives to show.</param>
/// <param name="Gauges">The six display-ready gauge tiles, in web order.</param>
public sealed record HeroGaugesDisplay(
    bool HasData,
    IReadOnlyList<HeroGauge> Gauges);

/// <summary>
/// Pure projection from a raw <see cref="HeroFleetAnalytics"/> to the six-gauge display model — the
/// native port of the unit conversion + gas/CO₂ heuristics in
/// web/src/features/analytics/components/analytics/HeroGauges.tsx. SI is converted to the user's display
/// unit here (and only here); every label resolves through the i18n facade. The gas-savings and CO₂
/// heuristics are tied to kilometres regardless of the display unit so the dollar/kg outputs stay stable
/// for the same fleet, exactly as the web source intends.
/// </summary>
public static class HeroGaugesProjection
{
    /// <summary>Kilometres per mile used to restate Wh/km efficiency as Wh/mi (web <c>KM_PER_MILE</c>).</summary>
    public const double KmPerMile = 1.609344;

    /// <summary>Assumed petrol consumption in litres per kilometre for the gas-savings heuristic (web <c>0.085</c>).</summary>
    public const double GasLitresPerKm = 0.085;

    /// <summary>Assumed petrol price per litre for the gas-savings heuristic (web <c>1.5</c>).</summary>
    public const double GasPricePerLitre = 1.5;

    /// <summary>Assumed avoided CO₂ in kilograms per kilometre for the CO₂ heuristic (web <c>0.12</c>).</summary>
    public const double Co2KgPerKm = 0.12;

    /// <summary>Fluent glyph for the distance gauge (web <c>MapPin</c>) — Segoe Fluent Location.</summary>
    public const string DistanceGlyph = "\uE707";

    /// <summary>Fluent glyph for the drives gauge (web <c>Car</c>).</summary>
    public const string DrivesGlyph = "\uE804";

    /// <summary>Fluent glyph for the energy gauge (web <c>Zap</c>) — Segoe Fluent LightningBolt.</summary>
    public const string EnergyGlyph = "\uE945";

    /// <summary>Fluent glyph for the efficiency gauge (web <c>Gauge</c>).</summary>
    public const string EfficiencyGlyph = "\uE950";

    /// <summary>Fluent glyph for the gas-savings gauge (web <c>DollarSign</c>) — money.</summary>
    public const string GasSavingsGlyph = "\uE1D3";

    /// <summary>Fluent glyph for the CO₂ gauge (web <c>Leaf</c>) — World/eco (no native leaf glyph).</summary>
    public const string Co2Glyph = "\uE909";

    private const string MetricEfficiencyUnit = "Wh/km";
    private const string ImperialEfficiencyUnit = "Wh/mi";
    private const string EnergyUnitLabel = "kWh";
    private const string Co2UnitLabel = "kg";

    /// <summary>Project <paramref name="data"/> for the user's <paramref name="units"/> and currency.</summary>
    /// <param name="data">The fleet analytics snapshot.</param>
    /// <param name="units">The user's unit preference (distance unit drives the conversions).</param>
    /// <param name="currencySymbol">The currency symbol for the gas-savings tile (blank falls back to "$").</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The six display-ready gauges plus the data flag.</returns>
    public static HeroGaugesDisplay Project(
        HeroFleetAnalytics data,
        UnitPref units,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var distanceUnit = units.Distance;
        string distanceUnitLabel = UnitLabels.Label(distanceUnit);
        string efficiencyUnit = distanceUnit == DistanceUnit.Mi ? ImperialEfficiencyUnit : MetricEfficiencyUnit;
        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        // backend total_distance_km is SI km — route through the meter-based converter so the factor
        // lives in Core.Units, not here (matches the web meter-floored helper).
        double totalDist = UnitConverters.DistanceFromSi(data.TotalDistanceKm * 1000.0, distanceUnit);
        double avgEffDisplay = distanceUnit == DistanceUnit.Mi
            ? data.AvgEfficiencyWhKm * KmPerMile
            : data.AvgEfficiencyWhKm;

        // Gas savings + CO₂ are tied to kilometres regardless of the display unit (web parity).
        double gasSavings = (data.TotalDistanceKm * GasLitresPerKm * GasPricePerLitre) - data.TotalCost;
        double co2Saved = data.TotalDistanceKm * Co2KgPerKm;

        string distanceLabel = localizer.GetString("analytics.hero.distance", "Distance");
        string drivesLabel = localizer.GetString("analytics.hero.drives", "Drives");
        string energyLabel = localizer.GetString("analytics.hero.energy", "Energy");
        string efficiencyLabel = localizer.GetString("analytics.hero.efficiency", "Efficiency");
        string gasSavingsLabel = localizer.GetString("analytics.hero.gasSavings", "Gas Savings");
        string co2Label = localizer.GetString("analytics.hero.co2Saved", "CO\u2082 Saved");

        string distanceValue = ScalarFormatters.FormatNumber(totalDist, 1);
        string drivesValue = ScalarFormatters.FormatNumber(data.TotalDrives, 0);
        string energyValue = ScalarFormatters.FormatNumber(data.TotalEnergyKwh, 1);
        string efficiencyValue = ScalarFormatters.FormatNumber(avgEffDisplay, 1);
        string gasSavingsValue = ScalarFormatters.FormatCurrency(Math.Max(gasSavings, 0), symbol, 0);
        string co2Value = ScalarFormatters.FormatNumber(co2Saved, 0);

        var gauges = new HeroGauge[]
        {
            Gauge(distanceLabel, distanceValue, distanceUnitLabel, DistanceGlyph, HeroGaugeAccent.Cyan),
            Gauge(drivesLabel, drivesValue, null, DrivesGlyph, HeroGaugeAccent.Purple),
            Gauge(energyLabel, energyValue, EnergyUnitLabel, EnergyGlyph, HeroGaugeAccent.Green),
            Gauge(efficiencyLabel, efficiencyValue, efficiencyUnit, EfficiencyGlyph, HeroGaugeAccent.Amber),
            Gauge(gasSavingsLabel, gasSavingsValue, null, GasSavingsGlyph, HeroGaugeAccent.Green),
            Gauge(co2Label, co2Value, Co2UnitLabel, Co2Glyph, HeroGaugeAccent.Green),
        };

        return new HeroGaugesDisplay(data.HasData, gauges);
    }

    private static HeroGauge Gauge(string label, string value, string? subtitle, string glyph, HeroGaugeAccent accent) =>
        new(label, value, subtitle, glyph, accent, AutomationName(label, value, subtitle));

    private static string AutomationName(string label, string value, string? subtitle) =>
        string.IsNullOrEmpty(subtitle)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, subtitle);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;HeroFleetAnalytics&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept
/// pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class HeroGaugesResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The same emission with its JSON payload parsed into a <see cref="HeroFleetAnalytics"/>.</returns>
    public static RepositoryResult<HeroFleetAnalytics> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        HeroFleetAnalytics Parse() => raw.HasValue ? HeroFleetAnalytics.FromJson(raw.Value) : HeroFleetAnalytics.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<HeroFleetAnalytics>.Loading(),
            LoadStatus.Cached => RepositoryResult<HeroFleetAnalytics>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<HeroFleetAnalytics>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<HeroFleetAnalytics>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<HeroFleetAnalytics>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<HeroFleetAnalytics>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<HeroFleetAnalytics>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
