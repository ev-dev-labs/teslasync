using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <c>DriveStatCards</c> feature view. The web source
/// (web/src/features/driving/components/drive-detail/DriveStatCards.tsx) is a pure presentational component:
/// it receives a fully-resolved <c>drive</c> + computed <c>stats</c> prop and performs no fetching, so it has
/// a single content state — <see cref="Ready"/> — whose internal conditionals (the energy-gated Trip-Cost and
/// Cost-per-distance tiles) are reproduced inside that state. There is deliberately no fetch-driven
/// error / stale / offline branch to reproduce here — those belong to the parent drive-detail page that owns
/// the <c>useDriveDetailData</c> query, not this presentational child (the same precedent the sibling
/// <c>DriveDetailHeader</c> / <c>StatusHeader</c> / <c>QuickNav</c> surfaces follow). The defensive
/// <see cref="Loading"/> branch renders tokenized skeleton chrome while the parent has not resolved the drive
/// yet, so the surface is never a blank box.
/// </summary>
public enum DriveStatCardsState
{
    /// <summary>The parent has not resolved the drive / stats yet — render skeleton chrome.</summary>
    Loading,

    /// <summary>The drive + stats resolved — render the web stat-card grid.</summary>
    Ready,
}

/// <summary>
/// The SI-canonical slice of the web <c>DriveDetail</c> + computed <c>DriveStats</c> that the stat-card grid
/// reads — held in SI floors (metres, metres-per-second, watt-hours) so the projection converts to the user's
/// display units at the render boundary exactly once (ADR-004). Mirrors the fields the web component touches:
/// <c>drive.distanceM</c>, <c>drive.durationS</c>, <c>drive.startBatteryPct</c>, <c>drive.endBatteryPct</c>
/// (from the <c>DriveDetail</c>), plus <c>stats.maxSpd</c>/<c>avgSpd</c> (the web <c>toSpeedDisplay(drive.*Mps)</c>
/// inputs kept here as their SI <c>m/s</c> source), <c>stats.powerMax</c> (kW, the wire unit of the
/// drive-power series), <c>stats.energyWh</c>, <c>stats.elevGain</c> and <c>stats.elevLoss</c>. A null speed
/// mirrors the web <c>drive.maxSpeedMps != null ? … : 0</c> guard. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="DistanceM">Drive distance in SI metres (web <c>drive.distanceM</c>).</param>
/// <param name="DurationS">Drive duration in SI seconds (web <c>drive.durationS</c>).</param>
/// <param name="MaxSpeedMps">Peak speed in SI metres-per-second (web <c>drive.maxSpeedMps</c>); null renders 0.</param>
/// <param name="AvgSpeedMps">Average speed in SI metres-per-second (web <c>drive.avgSpeedMps</c>); null renders 0.</param>
/// <param name="StartBatteryPct">State-of-charge at drive start, 0..100 (web <c>drive.startBatteryPct</c>); null renders 0.</param>
/// <param name="EndBatteryPct">State-of-charge at drive end, 0..100 (web <c>drive.endBatteryPct</c>); null renders 0.</param>
/// <param name="PowerMaxKw">Peak power in kilowatts (web <c>stats.powerMax</c>, already the kW series unit).</param>
/// <param name="EnergyWh">Energy used in SI watt-hours (web <c>stats.energyWh</c>); gates the two cost tiles.</param>
/// <param name="ElevGainM">Cumulative elevation gain in metres (web <c>stats.elevGain</c>).</param>
/// <param name="ElevLossM">Cumulative elevation loss in metres (web <c>stats.elevLoss</c>).</param>
public sealed record DriveStatsSnapshot(
    double DistanceM,
    double DurationS,
    double? MaxSpeedMps,
    double? AvgSpeedMps,
    double? StartBatteryPct,
    double? EndBatteryPct,
    double PowerMaxKw,
    double EnergyWh,
    double ElevGainM,
    double ElevLossM);

/// <summary>
/// The currency + cost-rate + precision context the two energy-cost tiles format through — the native analogue
/// of the web <c>useFormatting()</c> values derived from user settings
/// (web/src/hooks/useFormatting.ts): <c>base_cost_per_kwh ?? 0.12</c>, <c>currency_symbol</c> (blank → "$") and
/// <c>decimal_precision ?? 2</c>. Supplied to the projection so the Trip-Cost (<c>formatEnergyCost</c>) and
/// Cost-per-distance (<c>formatCurrency</c>) tiles reproduce the web output exactly. Pure data — no WinUI types.
/// </summary>
/// <param name="CurrencySymbol">The leading currency symbol (web <c>currencySymbol</c>; default "$").</param>
/// <param name="CostPerKwh">The energy price per kWh (web <c>costPerKwh</c>; default 0.12).</param>
/// <param name="Precision">The user's decimal precision for money / power readouts (web <c>userPrecision</c>; default 2).</param>
public sealed record DriveStatsFormatting(
    string CurrencySymbol = "$",
    double CostPerKwh = 0.12,
    int Precision = 2)
{
    /// <summary>The web defaults: "$", 0.12 per kWh, two decimal places.</summary>
    public static DriveStatsFormatting Default { get; } = new();
}

/// <summary>
/// One projected, display-ready stat tile consumed by the WinUI view — the native analogue of a web
/// <c>IconStatCard</c> instance. Holds the localized <see cref="Label"/>, the resolved Fluent
/// <see cref="Glyph"/> + accent <see cref="ColorKey"/> (a design-token brush key, never a literal hex), the
/// final formatted <see cref="Value"/> string (used for the static tiles, the count-up completion text and the
/// Narrator name), and — for the tiles the web renders with <c>AnimatedNumber</c> — the count-up
/// <see cref="AnimatedValue"/> target plus its <see cref="AnimatedPrecision"/> / <see cref="AnimatedSuffix"/>.
/// A null <see cref="AnimatedValue"/> marks a static-text tile (the web plain-string tiles). Pure data.
/// </summary>
/// <param name="Label">The localized tile label (web <c>t('driveDetail.*')</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph standing in for the web Lucide icon.</param>
/// <param name="ColorKey">The accent brush resource key (theme-aware token, never a literal hex).</param>
/// <param name="Value">The final formatted readout (static text, count-up completion text and Narrator value).</param>
/// <param name="AnimatedValue">The count-up target for an animated tile (web <c>AnimatedNumber</c>); null for a static tile.</param>
/// <param name="AnimatedPrecision">The count-up fraction digits (web <c>AnimatedNumber decimals</c>).</param>
/// <param name="AnimatedSuffix">The count-up suffix appended after the number (web <c>AnimatedNumber suffix</c>).</param>
/// <param name="AutomationName">The composed Narrator name for the tile (label + value).</param>
public sealed record DriveStatCardModel(
    string Label,
    string Glyph,
    string ColorKey,
    string Value,
    double? AnimatedValue,
    int AnimatedPrecision,
    string AnimatedSuffix,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the stat-card grid for one input model — the resolved
/// <see cref="State"/>, the ordered <see cref="Cards"/> (eight always-present tiles plus the energy-gated
/// Trip-Cost and Cost-per-distance tiles), the localized loading + region announcements and the surface
/// Narrator name. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive surface state (<see cref="DriveStatCardsState"/>).</param>
/// <param name="Cards">The ordered, formatted stat tiles (empty while loading).</param>
/// <param name="RegionLabel">The Narrator group name for the surface.</param>
/// <param name="LoadingLabel">The Narrator announcement while the skeleton renders.</param>
public sealed record DriveStatCardsDisplay(
    DriveStatCardsState State,
    IReadOnlyList<DriveStatCardModel> Cards,
    string RegionLabel,
    string LoadingLabel)
{
    /// <summary>The number of rendered tiles (web <c>StaggerItem</c> count, 8–10).</summary>
    public int CardCount => Cards.Count;
}

/// <summary>
/// The render-time data model the <c>DriveStatCards</c> view binds to — the native analogue of the web
/// <c>DriveStatCardsProps</c> (<c>drive</c> + <c>stats</c>), folded into the single SI snapshot the surface
/// actually reads. The presentational surface is fed the resolved <see cref="Stats"/> by the parent
/// drive-detail page (or null while that page is still loading the drive). Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Stats">The resolved SI snapshot the grid reads, or null while the parent is still loading.</param>
public sealed record DriveStatCardsModel(DriveStatsSnapshot? Stats)
{
    /// <summary>The initial model: the parent is still resolving the drive, so the skeleton branch renders.</summary>
    public static DriveStatCardsModel Pending { get; } = new((DriveStatsSnapshot?)null);
}

/// <summary>
/// Pure projection from a <see cref="DriveStatCardsModel"/> to its <see cref="DriveStatCardsDisplay"/> — the
/// native port of web/src/features/driving/components/drive-detail/DriveStatCards.tsx. Reproduces the web
/// derivations exactly: distance is <c>convertDistanceFromSI(distanceM, unit)</c> at one decimal; duration is
/// the web <c>formatDuration(durationS / 60)</c> "Hh Mm" / "Mm" clock; max / avg speed are
/// <c>convertSpeedFromSI(*Mps, unit)</c> at zero decimals; SOC is <c>fmtInt(startPct)% → fmtInt(endPct)%</c>;
/// max power is <c>fmtWithUnit(powerMax, 'kW')</c>; elevation gain / loss are <c>Math.round(metres)</c> with a
/// "↑" / "↓" suffix; the Trip-Cost tile (rendered only when <c>energyWh &gt; 0</c>) is
/// <c>formatEnergyCost(energyWh / 1000)</c>; and the Cost-per-distance tile (rendered only when
/// <c>energyWh &gt; 0 &amp;&amp; distanceM &gt; 0</c>) is <c>formatCurrency(costPerDistanceUnit(…), 3)</c> with the
/// interpolated <c>Cost / {{unit}}</c> label. Every number formats through the en-US
/// <see cref="NumberFormatting"/> port (the web <c>fmtNumber</c> contract: <c>safeNumber</c> coercion + fixed
/// digits + grouping) and every label resolves through the i18n facade. No WinUI types — unit-tested headless.
/// </summary>
public static class DriveStatCardsProjection
{
    /// <summary>The web "→" arrow (U+2192) between the start and end state-of-charge.</summary>
    public const string SocArrow = "\u2192";

    /// <summary>The web "↑" elevation-gain marker (U+2191) in the tile suffix.</summary>
    public const string UpArrow = "\u2191";

    /// <summary>The web "↓" elevation-loss marker (U+2193) in the tile suffix.</summary>
    public const string DownArrow = "\u2193";

    private const double WhPerKwh = 1000.0;
    private const double SecondsPerMinute = 60.0;
    private const int CostPerDistancePrecision = 3; // web formatCurrency(value, 3)
    private const string PowerUnitLabel = "kW";     // web fmtWithUnit(stats.powerMax, 'kW')
    private const string ElevationUnitLabel = "m";  // web suffix " m ↑" / " m ↓"

    /// <summary>Project <paramref name="model"/> into a render-ready display using the user's units + formatting.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="units">The user's unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="formatting">The currency + cost-rate + precision context (web <c>useFormatting()</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static DriveStatCardsDisplay Project(
        DriveStatCardsModel model,
        UnitPref units,
        DriveStatsFormatting formatting,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(formatting);
        ArgumentNullException.ThrowIfNull(localizer);

        string regionLabel = localizer.GetString(
            DriveStatCardsRegistration.RegionLabelKey, DriveStatCardsRegistration.RegionLabelFallback);
        string loadingLabel = localizer.GetString(
            DriveStatCardsRegistration.LoadingKey, DriveStatCardsRegistration.LoadingFallback);

        if (model.Stats is not { } stats)
        {
            return new DriveStatCardsDisplay(
                DriveStatCardsState.Loading,
                Array.Empty<DriveStatCardModel>(),
                regionLabel,
                loadingLabel);
        }

        var cards = BuildCards(stats, units, formatting, localizer);
        return new DriveStatCardsDisplay(DriveStatCardsState.Ready, cards, regionLabel, loadingLabel);
    }

    private static List<DriveStatCardModel> BuildCards(
        DriveStatsSnapshot stats,
        UnitPref units,
        DriveStatsFormatting formatting,
        ILocalizer localizer)
    {
        string distanceLabel = UnitLabels.Label(units.Distance);
        string speedLabel = UnitLabels.Label(units.Speed);
        int precision = formatting.Precision < 0 ? 0 : formatting.Precision;

        // web: toDistanceDisplay(drive.distanceM) at decimals={1}.
        double distanceDisplay = UnitConverters.DistanceFromSi(stats.DistanceM, units.Distance);
        // web: stats.maxSpd / avgSpd = drive.*Mps != null ? toSpeedDisplay(*Mps) : 0.
        double maxSpeed = UnitConverters.SpeedFromSi(stats.MaxSpeedMps ?? 0, units.Speed);
        double avgSpeed = UnitConverters.SpeedFromSi(stats.AvgSpeedMps ?? 0, units.Speed);
        // web: Math.round(stats.elevGain) / Math.round(stats.elevLoss).
        double elevGain = JsRound(stats.ElevGainM);
        double elevLoss = JsRound(stats.ElevLossM);

        var cards = new List<DriveStatCardModel>(10)
        {
            Animated(
                localizer.GetString(DriveStatCardsRegistration.DistanceKey, DriveStatCardsRegistration.DistanceFallback),
                DriveStatCardsRegistration.DistanceGlyph,
                DriveStatCardsRegistration.DistanceColor,
                distanceDisplay,
                1,
                " " + distanceLabel),
            Static(
                localizer.GetString(DriveStatCardsRegistration.DurationKey, DriveStatCardsRegistration.DurationFallback),
                DriveStatCardsRegistration.DurationGlyph,
                DriveStatCardsRegistration.DurationColor,
                FormatDuration(stats.DurationS / SecondsPerMinute)),
            Animated(
                localizer.GetString(DriveStatCardsRegistration.MaxSpeedKey, DriveStatCardsRegistration.MaxSpeedFallback),
                DriveStatCardsRegistration.MaxSpeedGlyph,
                DriveStatCardsRegistration.MaxSpeedColor,
                maxSpeed,
                0,
                " " + speedLabel),
            Animated(
                localizer.GetString(DriveStatCardsRegistration.AvgSpeedKey, DriveStatCardsRegistration.AvgSpeedFallback),
                DriveStatCardsRegistration.AvgSpeedGlyph,
                DriveStatCardsRegistration.AvgSpeedColor,
                avgSpeed,
                0,
                " " + speedLabel),
            Static(
                localizer.GetString(DriveStatCardsRegistration.SocKey, DriveStatCardsRegistration.SocFallback),
                DriveStatCardsRegistration.SocGlyph,
                DriveStatCardsRegistration.SocColor,
                FormatSoc(stats.StartBatteryPct, stats.EndBatteryPct)),
            Static(
                localizer.GetString(DriveStatCardsRegistration.MaxPowerKey, DriveStatCardsRegistration.MaxPowerFallback),
                DriveStatCardsRegistration.MaxPowerGlyph,
                DriveStatCardsRegistration.MaxPowerColor,
                Fmt(stats.PowerMaxKw, precision) + " " + PowerUnitLabel),
            Animated(
                localizer.GetString(DriveStatCardsRegistration.ElevGainKey, DriveStatCardsRegistration.ElevGainFallback),
                DriveStatCardsRegistration.ElevGainGlyph,
                DriveStatCardsRegistration.ElevGainColor,
                elevGain,
                0,
                " " + ElevationUnitLabel + " " + UpArrow),
            Animated(
                localizer.GetString(DriveStatCardsRegistration.ElevLossKey, DriveStatCardsRegistration.ElevLossFallback),
                DriveStatCardsRegistration.ElevLossGlyph,
                DriveStatCardsRegistration.ElevLossColor,
                elevLoss,
                0,
                " " + ElevationUnitLabel + " " + DownArrow),
        };

        // web: {stats.energyWh > 0 && ( <Trip Cost/> )}.
        if (stats.EnergyWh > 0)
        {
            string tripCost = formatting.CurrencySymbol + Fmt(stats.EnergyWh / WhPerKwh * formatting.CostPerKwh, precision);
            cards.Add(Static(
                localizer.GetString(DriveStatCardsRegistration.TripCostKey, DriveStatCardsRegistration.TripCostFallback),
                DriveStatCardsRegistration.TripCostGlyph,
                DriveStatCardsRegistration.TripCostColor,
                tripCost));
        }

        // web: {stats.energyWh > 0 && drive.distanceM > 0 && ( <Cost / unit/> )}.
        if (stats.EnergyWh > 0 && stats.DistanceM > 0)
        {
            double costPerUnit = CostPerDistanceUnit(stats.EnergyWh / WhPerKwh, stats.DistanceM, units, formatting) ?? 0;
            string label = localizer
                .GetString(DriveStatCardsRegistration.CostPerUnitKey, DriveStatCardsRegistration.CostPerUnitFallback)
                .Replace(DriveStatCardsRegistration.UnitToken, distanceLabel, StringComparison.Ordinal);
            cards.Add(Static(
                label,
                DriveStatCardsRegistration.CostPerUnitGlyph,
                DriveStatCardsRegistration.CostPerUnitColor,
                formatting.CurrencySymbol + Fmt(costPerUnit, CostPerDistancePrecision)));
        }

        return cards;
    }

    /// <summary>
    /// The web <c>formatDuration(min)</c>: <c>h = floor(min / 60)</c>, <c>m = round(min % 60)</c>, then
    /// <c>h &gt; 0 ? "{h}h {m}m" : "{m}m"</c>. The minute rounding is the JS <c>Math.round</c> (half away from
    /// zero for the non-negative durations here).
    /// </summary>
    public static string FormatDuration(double minutes)
    {
        double safe = double.IsFinite(minutes) ? minutes : 0;
        long h = (long)Math.Floor(safe / 60.0);
        long m = (long)JsRound(safe % 60.0);
        return h > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{h}h {m}m")
            : string.Create(CultureInfo.InvariantCulture, $"{m}m");
    }

    /// <summary>
    /// The web cost-per-display-distance derivation
    /// (web/src/hooks/useFormatting.ts <c>costPerDistanceUnit</c>): null when <paramref name="distanceM"/> is
    /// non-positive; otherwise <c>(kwh * costPerKwh) / convertDistanceFromSI(distanceM, unit)</c>, or null when
    /// the converted distance is non-positive.
    /// </summary>
    /// <param name="kwh">The energy used, in kilowatt-hours.</param>
    /// <param name="distanceM">The drive distance, in SI metres.</param>
    /// <param name="units">The user's unit preference.</param>
    /// <param name="formatting">The cost-rate context.</param>
    public static double? CostPerDistanceUnit(
        double kwh,
        double distanceM,
        UnitPref units,
        DriveStatsFormatting formatting)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(formatting);
        if (distanceM <= 0)
        {
            return null;
        }

        double cost = kwh * formatting.CostPerKwh;
        double distance = UnitConverters.DistanceFromSi(distanceM, units.Distance);
        return distance > 0 ? cost / distance : null;
    }

    private static DriveStatCardModel Animated(
        string label, string glyph, string colorKey, double value, int precision, string suffix)
    {
        string text = Fmt(value, precision) + suffix;
        return new DriveStatCardModel(label, glyph, colorKey, text, value, precision, suffix, Narrator(label, text));
    }

    private static DriveStatCardModel Static(string label, string glyph, string colorKey, string value) =>
        new(label, glyph, colorKey, value, null, 0, string.Empty, Narrator(label, value));

    private static string Narrator(string label, string value) =>
        string.Create(CultureInfo.CurrentCulture, $"{label}: {value}");

    // web fmtInt(start)% → fmtInt(end)% (fmtInt = fmtNumber(v, 0); safeNumber coerces null → 0).
    private static string FormatSoc(double? start, double? end) =>
        string.Concat(Fmt(start ?? 0, 0), "% ", SocArrow, " ", Fmt(end ?? 0, 0), "%");

    // web fmtNumber(v, digits): safeNumber(v) (null/NaN/∞ → 0) then en-US fixed-digit grouped formatting.
    private static string Fmt(double value, int digits) =>
        NumberFormatting.Format(double.IsFinite(value) ? value : 0, null, digits < 0 ? 0 : digits);

    // JS Math.round: floor(x + 0.5) — half rounds toward +∞ (matches the web Math.round used for elevation
    // and the duration minute component).
    private static double JsRound(double value) => double.IsFinite(value) ? Math.Floor(value + 0.5) : 0;
}

/// <summary>
/// Canonical metadata for the <c>DriveStatCards</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/driving/components/drive-detail/DriveStatCards.tsx</c>: the stable diagnostics slug, the
/// i18n keys + English fallbacks the web source feeds into <c>t()</c> (plus the <c>common.loading</c> and
/// region-label keys backing the Narrator-only affordances Windows accessibility minimums require), the Segoe
/// Fluent glyphs standing in for the web Lucide icons, and the design-token accent brush keys whose colours
/// match the web per-tile hexes exactly (e.g. <c>#00f0ff</c> → <c>TsColorInfoBrush</c>, <c>#a855f7</c> →
/// <c>TsChartPowerBrush</c>). UI-free so the metadata is asserted in tests.
/// </summary>
public static class DriveStatCardsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "DriveStatCards";

    /// <summary>The interpolation token in the Cost-per-distance label (web i18next <c>{{unit}}</c>).</summary>
    public const string UnitToken = "{{unit}}";

    /// <summary>i18n key for the surface's Narrator group label (Windows accessibility minimum; no visible web text).</summary>
    public const string RegionLabelKey = "driveDetail.statsRegion";

    /// <summary>English fallback for the surface's Narrator group label.</summary>
    public const string RegionLabelFallback = "Drive statistics";

    /// <summary>i18n key for the skeleton's Narrator announcement.</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for the skeleton's Narrator announcement.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>i18n key for the Distance tile (web <c>t('driveDetail.distance', 'Distance')</c>).</summary>
    public const string DistanceKey = "driveDetail.distance";

    /// <summary>English fallback for the Distance tile — verbatim from the web source.</summary>
    public const string DistanceFallback = "Distance";

    /// <summary>i18n key for the Duration tile (web <c>t('driveDetail.duration', 'Duration')</c>).</summary>
    public const string DurationKey = "driveDetail.duration";

    /// <summary>English fallback for the Duration tile — verbatim from the web source.</summary>
    public const string DurationFallback = "Duration";

    /// <summary>i18n key for the Max-Speed tile (web <c>t('driveDetail.maxSpeed', 'Max Speed')</c>).</summary>
    public const string MaxSpeedKey = "driveDetail.maxSpeed";

    /// <summary>English fallback for the Max-Speed tile — verbatim from the web source.</summary>
    public const string MaxSpeedFallback = "Max Speed";

    /// <summary>i18n key for the Avg-Speed tile (web <c>t('driveDetail.avgSpeed', 'Avg Speed')</c>).</summary>
    public const string AvgSpeedKey = "driveDetail.avgSpeed";

    /// <summary>English fallback for the Avg-Speed tile — verbatim from the web source.</summary>
    public const string AvgSpeedFallback = "Avg Speed";

    /// <summary>i18n key for the SOC tile (web <c>t('driveDetail.soc', 'SOC')</c>).</summary>
    public const string SocKey = "driveDetail.soc";

    /// <summary>English fallback for the SOC tile — verbatim from the web source.</summary>
    public const string SocFallback = "SOC";

    /// <summary>i18n key for the Max-Power tile (web <c>t('driveDetail.maxPower', 'Max Power')</c>).</summary>
    public const string MaxPowerKey = "driveDetail.maxPower";

    /// <summary>English fallback for the Max-Power tile — verbatim from the web source.</summary>
    public const string MaxPowerFallback = "Max Power";

    /// <summary>i18n key for the Elevation-Gain tile (web <c>t('driveDetail.elevGain', 'Elev. Gain')</c>).</summary>
    public const string ElevGainKey = "driveDetail.elevGain";

    /// <summary>English fallback for the Elevation-Gain tile — verbatim from the web source.</summary>
    public const string ElevGainFallback = "Elev. Gain";

    /// <summary>i18n key for the Elevation-Loss tile (web <c>t('driveDetail.elevLoss', 'Elev. Loss')</c>).</summary>
    public const string ElevLossKey = "driveDetail.elevLoss";

    /// <summary>English fallback for the Elevation-Loss tile — verbatim from the web source.</summary>
    public const string ElevLossFallback = "Elev. Loss";

    /// <summary>i18n key for the Trip-Cost tile (web <c>t('driveDetail.tripCost', 'Trip Cost')</c>).</summary>
    public const string TripCostKey = "driveDetail.tripCost";

    /// <summary>English fallback for the Trip-Cost tile — verbatim from the web source.</summary>
    public const string TripCostFallback = "Trip Cost";

    /// <summary>i18n key for the Cost-per-distance tile (web <c>t('driveDetail.costPerUnit', 'Cost / {{unit}}')</c>).</summary>
    public const string CostPerUnitKey = "driveDetail.costPerUnit";

    /// <summary>English fallback for the Cost-per-distance tile — verbatim from the web source (interpolated).</summary>
    public const string CostPerUnitFallback = "Cost / {{unit}}";

    /// <summary>Segoe Fluent "Route" glyph — web Lucide <c>Route</c> (Distance).</summary>
    public const string DistanceGlyph = "\uE7C0";

    /// <summary>Segoe Fluent "Clock" glyph — web Lucide <c>Clock</c> (Duration).</summary>
    public const string DurationGlyph = "\uE121";

    /// <summary>Segoe Fluent "Speed" glyph — web Lucide <c>Gauge</c> (Max Speed).</summary>
    public const string MaxSpeedGlyph = "\uE9D9";

    /// <summary>Segoe Fluent "trending up" glyph — web Lucide <c>TrendingUp</c> (Avg Speed).</summary>
    public const string AvgSpeedGlyph = "\uE9D2";

    /// <summary>Segoe Fluent "Battery" glyph — web Lucide <c>Battery</c> (SOC).</summary>
    public const string SocGlyph = "\uE83F";

    /// <summary>Segoe Fluent "lightning" glyph — web Lucide <c>Zap</c> (Max Power).</summary>
    public const string MaxPowerGlyph = "\uE945";

    /// <summary>Segoe Fluent "Location" glyph — web Lucide <c>Navigation</c> (Elevation Gain).</summary>
    public const string ElevGainGlyph = "\uE707";

    /// <summary>Segoe Fluent "Location" glyph — web Lucide <c>Navigation</c> (Elevation Loss).</summary>
    public const string ElevLossGlyph = "\uE707";

    /// <summary>Segoe Fluent "money" glyph — web Lucide <c>DollarSign</c> (Trip Cost).</summary>
    public const string TripCostGlyph = "\uE1D3";

    /// <summary>Segoe Fluent "trending down" glyph — web Lucide <c>TrendingDown</c> (Cost per distance).</summary>
    public const string CostPerUnitGlyph = "\uEB0F";

    /// <summary>Accent brush key for Distance — web <c>#00f0ff</c> (theme-aware cyan info token).</summary>
    public const string DistanceColor = "TsColorInfoBrush";

    /// <summary>Accent brush key for Duration — web <c>#f59e0b</c> (amber).</summary>
    public const string DurationColor = "TsChartEnergyBrush";

    /// <summary>Accent brush key for Max Speed — web <c>#a855f7</c> (purple).</summary>
    public const string MaxSpeedColor = "TsChartPowerBrush";

    /// <summary>Accent brush key for Avg Speed — web <c>#10b981</c> (emerald).</summary>
    public const string AvgSpeedColor = "TsChartBatteryBrush";

    /// <summary>Accent brush key for SOC — web <c>#10b981</c> (emerald).</summary>
    public const string SocColor = "TsChartBatteryBrush";

    /// <summary>Accent brush key for Max Power — web <c>#f59e0b</c> (amber).</summary>
    public const string MaxPowerColor = "TsChartEnergyBrush";

    /// <summary>Accent brush key for Elevation Gain — web <c>#10b981</c> (emerald).</summary>
    public const string ElevGainColor = "TsChartBatteryBrush";

    /// <summary>Accent brush key for Elevation Loss — web <c>#ef4444</c> (red).</summary>
    public const string ElevLossColor = "TsColorDangerBrush";

    /// <summary>Accent brush key for Trip Cost — web <c>#10b981</c> (emerald).</summary>
    public const string TripCostColor = "TsChartBatteryBrush";

    /// <summary>Accent brush key for Cost per distance — web <c>#06b6d4</c> (cyan regen token).</summary>
    public const string CostPerUnitColor = "TsChartRegenBrush";
}

/// <summary>
/// PII-safe diagnostics for the <c>DriveStatCards</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, speed, state-of-charge, cost
/// or any other drive metric — so a diagnostics line can never leak a user's trip. Thread-safe.
/// </summary>
public sealed class DriveStatCardsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveStatCardsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveStatCards</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveStatCardsRegistration.Slug}");
    }
}
