using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="CostSummaryCardsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web component
/// (web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx) is a presentational grid that
/// receives its <c>coreStats</c> as a prop; the native feature-view owns the charging-sessions read whose
/// aggregate it summarises, so it renders the full state matrix the prompt mandates. Every branch maps onto
/// a visible surface — none is ever hidden. <see cref="Empty"/> mirrors the web cost-analysis page's empty
/// gate (no charging sessions) in addition to an empty HTTP body.
/// </summary>
public enum CostSummaryCardsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton tiles.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) with at least one session to summarise.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no charging sessions — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>The unit the gasoline price is quoted in (web <c>settings.gas_unit</c>).</summary>
public enum CostSummaryCardsGasUnit
{
    /// <summary>Price per US gallon (the web default) — the <c>gal</c> label.</summary>
    Gallon,

    /// <summary>Price per litre — the <c>L</c> label.</summary>
    Liter,
}

/// <summary>
/// The monetary + fuel display preferences the surface needs — the native analogue of the web
/// <c>useFormatting</c> / <c>useSettings</c> inputs the component reads
/// (web/src/hooks/useFormatting.ts, web/src/hooks/useSettings.ts): the currency symbol used to format every
/// money value, the per-gallon/-litre gasoline price the savings tiles compare against, and which gas unit
/// the price is quoted in. The view-model owns one instance and re-projects when it changes.
/// </summary>
/// <param name="CurrencySymbol">Currency symbol (web <c>settings.currency_symbol</c> or "$").</param>
/// <param name="GasPrice">Gasoline price per <see cref="GasUnit"/> (web cost-analysis <c>DEFAULT_GAS_PRICE</c>).</param>
/// <param name="GasUnit">Whether the gas price is per gallon or per litre (web <c>settings.gas_unit</c>).</param>
public sealed record CostSummaryCardsSettings(
    string CurrencySymbol = "$",
    double GasPrice = CostSummaryCardsProjection.DefaultGasPrice,
    CostSummaryCardsGasUnit GasUnit = CostSummaryCardsGasUnit.Gallon)
{
    /// <summary>The all-default preference bundle ("$", $3.50/gal, gallons).</summary>
    public static CostSummaryCardsSettings Default { get; } = new();

    /// <summary>The currency symbol with the web's blank/whitespace → "$" fallback applied.</summary>
    public string ResolvedSymbol => string.IsNullOrWhiteSpace(CurrencySymbol) ? "$" : CurrencySymbol;
}

/// <summary>
/// One charging session from the charging-sessions list (web <c>ChargingSession</c> in
/// web/src/api/types.ts). Only the four fields the web <c>useCostAnalysisData</c> reads to build
/// <c>coreStats</c> are projected: the recorded decimal cost, the SI energy added, and the start/end
/// odometer (SI metres) used to derive the distance the cost-per-distance tile divides by. Parsing is
/// null-tolerant so a partial row never throws.
/// </summary>
/// <param name="CostDecimal">Recorded session cost (web <c>s.cost_decimal ?? 0</c>); null when absent.</param>
/// <param name="EnergyAddedWh">Energy added in watt-hours (web <c>s.total_energy_added_wh</c>).</param>
/// <param name="OdometerStartM">Start odometer in metres (web <c>s.start_odometer_m</c>); null when absent.</param>
/// <param name="OdometerEndM">End odometer in metres (web <c>s.end_odometer_m</c>); null when absent.</param>
public sealed record CostSummaryCardsSession(
    double? CostDecimal,
    double EnergyAddedWh,
    double? OdometerStartM,
    double? OdometerEndM)
{
    /// <summary>
    /// The SI-metre distance added during the session — the native port of the web <c>distanceAddedM</c>
    /// helper (web/src/features/charging/components/charging-curve/helpers.ts): the odometer delta when both
    /// endpoints are present and the delta is strictly positive, otherwise null (which sums as 0).
    /// </summary>
    public double? DistanceAddedM =>
        OdometerStartM is { } start && OdometerEndM is { } end && end - start > 0 ? end - start : null;

    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<CostSummaryCardsSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CostSummaryCardsSession>();
        }

        var list = new List<CostSummaryCardsSession>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charging-session JSON object into a tolerant row.</summary>
    public static CostSummaryCardsSession FromJson(JsonElement obj) => new(
        CostDecimal: GetDouble(obj, "cost_decimal"),
        EnergyAddedWh: GetDouble(obj, "total_energy_added_wh") ?? 0,
        OdometerStartM: GetDouble(obj, "start_odometer_m"),
        OdometerEndM: GetDouble(obj, "end_odometer_m"));

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
}

/// <summary>
/// The aggregated cost figures the six tiles consume — the native port of the web <c>coreStats</c> object
/// computed by <c>useCostAnalysisData</c>
/// (web/src/features/charging/components/cost-analysis/useCostAnalysisData.ts). Only the fields the
/// <c>CostSummaryCards</c> component reads are modelled. Pure data so the aggregation is unit-tested without
/// a UI host.
/// </summary>
/// <param name="TotalCost">Sum of recorded session costs (web <c>totalCost</c>).</param>
/// <param name="Count">Number of sessions summed (web <c>count</c>).</param>
/// <param name="TotalEnergyKwh">Total energy added in kWh (web <c>totalEnergy</c>).</param>
/// <param name="AvgCostPerKwh">Blended cost per kWh (web <c>avgCostPerKwh</c>).</param>
/// <param name="CostPerDistance">Cost per display-distance unit (web <c>costPerDist</c>).</param>
/// <param name="GallonsEquiv">Gallons-of-gasoline energy equivalent (web <c>gallonsEquiv</c>).</param>
/// <param name="Savings">Estimated gasoline cost minus EV cost (web <c>savings</c>).</param>
/// <param name="SavingsPercent">Savings as a percentage of gas cost (web <c>savingsPercent</c>).</param>
public sealed record CostSummaryCoreStats(
    double TotalCost,
    int Count,
    double TotalEnergyKwh,
    double AvgCostPerKwh,
    double CostPerDistance,
    double GallonsEquiv,
    double Savings,
    double SavingsPercent)
{
    /// <summary>An all-zero, no-session snapshot — the aggregation fallback (web <c>coreStats === null</c>).</summary>
    public static CostSummaryCoreStats Empty { get; } = new(0, 0, 0, 0, 0, 0, 0, 0);

    /// <summary>True when at least one session was summed (web parity: <c>coreStats</c> is non-null).</summary>
    public bool HasData => Count > 0;

    /// <summary>
    /// Aggregate <paramref name="sessions"/> into the cost figures — the native port of the web
    /// <c>coreStats</c> <c>useMemo</c>. SI energy is converted to kWh and SI distance to the user's display
    /// unit here (and only here). The cost-per-distance divisor reproduces the web verbatim: the SI-metre
    /// odometer delta is divided by metres-per-mile <em>before</em> being passed to
    /// <see cref="UnitConverters.DistanceFromSi"/>, so the value is converted a second time exactly as the
    /// web does (never silently "fixed").
    /// </summary>
    public static CostSummaryCoreStats Compute(
        IReadOnlyList<CostSummaryCardsSession> sessions,
        CostSummaryCardsSettings settings,
        UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(units);

        if (sessions.Count == 0)
        {
            return Empty;
        }

        double totalCost = 0;
        double totalEnergyWh = 0;
        double totalDistanceM = 0;
        foreach (var s in sessions)
        {
            totalCost += s.CostDecimal ?? 0;
            totalEnergyWh += s.EnergyAddedWh;
            totalDistanceM += s.DistanceAddedM ?? 0;
        }

        double totalEnergyKwh = UnitConverters.EnergyFromSi(totalEnergyWh, EnergyUnit.Kwh);
        double avgCostPerKwh = totalEnergyKwh > 0 ? totalCost / totalEnergyKwh : 0;

        // web: distVal = convertDistanceFromSI(totalDistanceM / 1609.344, unit) — the miles-as-metres
        // double-conversion is reproduced verbatim so the native output matches the web's observable value.
        double distVal = UnitConverters.DistanceFromSi(
            totalDistanceM / CostSummaryCardsProjection.MetersPerMile, units.Distance);
        double costPerDist = distVal > 0 ? totalCost / distVal : 0;

        double gallonsEquiv = totalEnergyKwh / CostSummaryCardsProjection.KwhPerGallon;
        double gasCost = gallonsEquiv * settings.GasPrice;
        double savings = gasCost - totalCost;
        double savingsPercent = gasCost > 0 ? savings / gasCost * 100 : 0;

        return new CostSummaryCoreStats(
            totalCost,
            sessions.Count,
            totalEnergyKwh,
            avgCostPerKwh,
            costPerDist,
            gallonsEquiv,
            savings,
            savingsPercent);
    }
}

/// <summary>
/// One projected, display-ready metric tile consumed by the WinUI view — the native analogue of a web
/// <c>StatBox</c> instance. Holds the localized label, the already-formatted value, the formatted subtitle,
/// the resolved Fluent glyph, the categorical palette index (so each tile gets the web's per-icon accent),
/// and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">The localized tile label.</param>
/// <param name="Value">The pre-formatted primary value.</param>
/// <param name="Subtitle">The pre-formatted caption line.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the leading icon.</param>
/// <param name="ColorIndex">The categorical palette index tinting the icon.</param>
/// <param name="AutomationName">The Narrator name combining label, value and subtitle.</param>
public sealed record CostSummaryCard(
    string Label,
    string Value,
    string Subtitle,
    string Glyph,
    int ColorIndex,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the cost-summary grid — the six tiles plus the
/// <see cref="HasData"/> gate. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="HasData">True when there is at least one session (web <c>coreStats</c> non-null).</param>
/// <param name="Cards">The six metric tiles in web display order.</param>
public sealed record CostSummaryCardsDisplay(bool HasData, IReadOnlyList<CostSummaryCard> Cards)
{
    /// <summary>An empty projection (no tiles) — the projection fallback.</summary>
    public static CostSummaryCardsDisplay Empty { get; } = new(false, Array.Empty<CostSummaryCard>());
}

/// <summary>
/// Pure projection from aggregated <see cref="CostSummaryCoreStats"/> to the six display tiles — the native
/// port of the <c>StatBox</c> composition in
/// web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx, with the value formatting from
/// <c>useFormatting.formatCurrency</c> + <c>fmtNumber</c>/<c>fmtInt</c>/<c>fmtWithUnit</c>. Every label
/// resolves through the i18n facade; no WinUI types — unit-tested without a UI host. The web component also
/// renders the "Cost Per {{unit}}" tile (the prompt's auto-extracted key list omitted it); the web source is
/// the specification, so all six tiles are reproduced.
/// </summary>
public static class CostSummaryCardsProjection
{
    /// <summary>kWh of energy per US gallon of gasoline (web <c>KWH_PER_GALLON</c>).</summary>
    public const double KwhPerGallon = 33.7;

    /// <summary>Metres per mile — the literal divisor the web cost-per-distance maths uses (1609.344).</summary>
    public const double MetersPerMile = 1609.344;

    /// <summary>Default gasoline price the web cost-analysis page seeds (<c>DEFAULT_GAS_PRICE</c>).</summary>
    public const double DefaultGasPrice = 3.5;

    // Segoe Fluent / MDL2 glyphs standing in for the web lucide icons (DollarSign, Zap, Car, Zap, Fuel,
    // TrendingDown).
    private const string GlyphDollar = "\uE1D3";        // money (web DollarSign — cyan)
    private const string GlyphEnergy = "\uE945";        // lightning (web Zap)
    private const string GlyphCar = "\uE804";           // car (web Car — blue)
    private const string GlyphFuel = "\uE950";          // gauge / fuel (web Fuel — red)
    private const string GlyphTrendingDown = "\uE896";  // downward arrow (web TrendingDown — emerald)

    /// <summary>The header / empty-state glyph (web <c>DollarSign</c>).</summary>
    public const string HeaderGlyph = GlyphDollar;

    /// <summary>
    /// Project <paramref name="stats"/> into the six metric tiles using the user's units, currency and gas
    /// settings. Tile order, labels, value precision and subtitles mirror the web component exactly.
    /// </summary>
    public static CostSummaryCardsDisplay Project(
        CostSummaryCoreStats stats,
        CostSummaryCardsSettings settings,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(stats);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = settings.ResolvedSymbol;
        bool isMiles = units.Distance == DistanceUnit.Mi;

        // web: distanceUnit = unitPrefs.distance ('mi' / 'km'); label noun = isMiles ? 'Mile' : 'km'.
        string distanceUnitLabel = UnitLabels.Label(units.Distance);
        string distanceNoun = isMiles
            ? localizer.GetString("costAnalysis.stats.unitMile", "Mile")
            : localizer.GetString("costAnalysis.stats.unitKm", "km");
        string kwhLabel = localizer.GetString("costAnalysis.stats.kwh", "kWh");
        string galEquivLabel = localizer.GetString("costAnalysis.stats.galEquiv", "gal equiv");
        string gasUnitLabel = settings.GasUnit == CostSummaryCardsGasUnit.Liter
            ? localizer.GetString("costAnalysis.stats.gasUnit.liter", "L")
            : localizer.GetString("costAnalysis.stats.gasUnit.gallon", "gal");

        // Tile 1 — Total Cost (web glow cyan, DollarSign cyan): formatCurrency(totalCost, 2); "{count} sessions".
        var totalCostTile = Card(
            localizer.GetString("costAnalysis.stats.totalCost", "Total Cost"),
            Currency(stats.TotalCost, symbol, 2),
            string.Format(
                CultureInfo.CurrentCulture,
                "{0} {1}",
                ScalarFormatters.FormatNumber(stats.Count, 0),
                localizer.GetString("costAnalysis.stats.sessions", "sessions")),
            GlyphDollar,
            0);

        // Tile 2 — Avg $/kWh (web Zap yellow): formatCurrency(avgCostPerKwh, 3); "blended rate".
        var avgPerKwhTile = Card(
            localizer.GetString("costAnalysis.stats.avgPerKwh", "Avg $/kWh"),
            Currency(stats.AvgCostPerKwh, symbol, 3),
            localizer.GetString("costAnalysis.stats.blendedRate", "blended rate"),
            GlyphEnergy,
            1);

        // Tile 3 — Cost Per {Mile|km} (web Car blue): formatCurrency(costPerDist, 3); "per {distanceUnit}".
        var costPerDistTile = Card(
            FillUnit(localizer.GetString("costAnalysis.stats.costPerDist", "Cost Per {{unit}}"), distanceNoun),
            Currency(stats.CostPerDistance, symbol, 3),
            FillUnit(localizer.GetString("costAnalysis.stats.perUnit", "per {{unit}}"), distanceUnitLabel),
            GlyphCar,
            2);

        // Tile 4 — Total Energy (web glow green, Zap green): fmtWithUnit(totalEnergy, 'kWh', 1); "{gallonsEquiv} gal equiv".
        var totalEnergyTile = Card(
            localizer.GetString("costAnalysis.stats.totalEnergy", "Total Energy"),
            WithUnit(stats.TotalEnergyKwh, kwhLabel, 1),
            WithUnit(stats.GallonsEquiv, galEquivLabel, 1),
            GlyphEnergy,
            3);

        // Tile 5 — Gas Savings $ (web glow green, Fuel red): formatCurrency(savings, 2); "vs {gasPrice}/{gasUnit}".
        var gasSavingsTile = Card(
            localizer.GetString("costAnalysis.stats.gasSavings", "Gas Savings $"),
            Currency(stats.Savings, symbol, 2),
            FillPriceUnit(
                localizer.GetString("costAnalysis.stats.vsPrice", "vs {{price}}/{{unit}}"),
                Currency(settings.GasPrice, symbol, 2),
                gasUnitLabel),
            GlyphFuel,
            4);

        // Tile 6 — Savings % (web glow green, TrendingDown emerald): "{savingsPercent}%"; "vs gasoline".
        var savingsPercentTile = Card(
            localizer.GetString("costAnalysis.stats.savingsPercent", "Savings %"),
            string.Format(CultureInfo.CurrentCulture, "{0}%", ScalarFormatters.FormatNumber(stats.SavingsPercent, 1)),
            localizer.GetString("costAnalysis.stats.vsGasoline", "vs gasoline"),
            GlyphTrendingDown,
            5);

        var cards = new List<CostSummaryCard>(6)
        {
            totalCostTile,
            avgPerKwhTile,
            costPerDistTile,
            totalEnergyTile,
            gasSavingsTile,
            savingsPercentTile,
        };

        return new CostSummaryCardsDisplay(stats.HasData, cards);
    }

    // web formatCurrency(amount, decimals) = `${currencySymbol}${fmtNumber(amount, decimals)}`. The values
    // are always finite here (computed with guards), so this never hits the non-finite empty path.
    private static string Currency(double amount, string symbol, int decimals) =>
        ScalarFormatters.FormatCurrency(amount, symbol, decimals);

    // web fmtWithUnit(value, unit, decimals) = `${fmtNumber(value, decimals)} ${unit}`.
    private static string WithUnit(double value, string unit, int decimals) =>
        string.Format(CultureInfo.CurrentCulture, "{0} {1}", ScalarFormatters.FormatNumber(value, decimals), unit);

    private static CostSummaryCard Card(string label, string value, string subtitle, string glyph, int colorIndex) =>
        new(label, value, subtitle, glyph, colorIndex, AutomationName(label, value, subtitle));

    private static string AutomationName(string label, string value, string subtitle) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, subtitle);

    // Substitute the single {{unit}} token (the i18n {{…}} convention) plus the catalog's positional {0}.
    private static string FillUnit(string template, string unit) =>
        template
            .Replace("{{unit}}", unit, StringComparison.Ordinal)
            .Replace("{0}", unit, StringComparison.Ordinal);

    // Substitute the {{price}} and {{unit}} tokens of the gas-savings subtitle.
    private static string FillPriceUnit(string template, string price, string unit) =>
        template
            .Replace("{{price}}", price, StringComparison.Ordinal)
            .Replace("{{unit}}", unit, StringComparison.Ordinal);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;CostSummaryCardsSession&gt;&gt;</c>, preserving every freshness
/// flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept
/// pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class CostSummaryCardsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<CostSummaryCardsSession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<CostSummaryCardsSession> Parse() =>
            raw.HasValue ? CostSummaryCardsSession.ParseList(raw.Value) : Array.Empty<CostSummaryCardsSession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Cost Summary Cards surface — the native mirror of the web component
/// (web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx, rendered by the Cost Analysis
/// page). Centralises the stable id, category and diagnostics slug so the view and view-model stay free of
/// literal identifiers.
/// </summary>
public static class CostSummaryCardsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "cost-summary-cards";

    /// <summary>Surface category (matches the web charging feature).</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "CostSummaryCards";
}

/// <summary>
/// PII-safe diagnostics for the Cost Summary Cards surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost, kWh figure, VIN or vehicle id
/// — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class CostSummaryCardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CostSummaryCardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CostSummaryCards</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CostSummaryCardsRegistration.Slug}");
    }
}
