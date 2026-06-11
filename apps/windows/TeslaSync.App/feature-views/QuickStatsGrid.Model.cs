using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>QuickStatsGrid</c> surface — the native union of what the web
/// component renders (web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx). The web source is
/// a <em>pure presentational</em> grid: it receives an already-resolved <c>state: VehicleState</c> +
/// <c>status: VehicleStatus</c> pair and performs no fetching, so it has a single content branch —
/// <see cref="Ready"/> — and no fetch-driven empty / error / stale / offline branch of its own. Those belong to
/// the owning Vehicle-Detail page that runs the <c>useVehicleState</c> query (its skeleton / <c>QueryError</c> /
/// freshness chrome renders once for the whole page before this grid is composed with resolved props), exactly
/// as React only mounts <c>&lt;QuickStatsGrid state={…} status={…} /&gt;</c> once the data has resolved — the same
/// precedent the sibling vehicle-detail / drive-detail ports (<c>DriveStatCards</c>, <c>SummaryStatsRow</c>)
/// follow. The defensive <see cref="Loading"/> branch renders tokenized skeleton chrome while the parent has not
/// handed down a <see cref="QuickVehicleSnapshot"/> yet, so the surface is never a blank box. Every branch maps
/// onto a visible surface; none is ever hidden.
/// </summary>
public enum QuickStatsGridState
{
    /// <summary>The parent has not resolved the live vehicle state yet — render skeleton chrome.</summary>
    Loading,

    /// <summary>The live state resolved (the web fall-through) — render the eight metric tiles.</summary>
    Ready,
}

/// <summary>
/// The SI-canonical slice of the web <c>VehicleState</c> the grid reads (plus the derived <c>VehicleStatus</c>),
/// held in SI floors — percent, metres, metres-per-second, degrees Celsius, kilowatts — so the projection
/// converts to the user's display units at the render boundary exactly once (ADR-004). Mirrors the fields the
/// web component touches: <c>state.battery_level</c>, <c>state.rated_range</c>, <c>state.odometer</c>,
/// <c>state.speed</c>, <c>state.inside_temp</c>, <c>state.outside_temp</c>, <c>state.power</c> and the
/// already-derived <c>status</c> string. The four <c>formatDistance</c> / <c>formatSpeed</c> /
/// <c>formatTemperature</c> inputs are kept in their SI source units (metres, m/s, °C) — the same contract the
/// shared <see cref="UnitFormatters"/> port consumes; <see cref="PowerKw"/> is the wire unit the web renders
/// verbatim through <c>fmtNumber</c> + a literal " kW" suffix (it is <em>not</em> a SI-watt formatter input, so
/// it is held as kilowatts to match the source). Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="BatteryLevel">State-of-charge percentage, 0..100 (web <c>state.battery_level</c>), rendered verbatim with "%".</param>
/// <param name="RatedRangeM">Rated range in SI metres (web <c>state.rated_range</c>), formatted at zero decimals.</param>
/// <param name="OdometerM">Odometer reading in SI metres (web <c>state.odometer</c>), formatted at zero decimals.</param>
/// <param name="SpeedMps">Instantaneous speed in SI metres-per-second (web <c>state.speed</c>), formatted at zero decimals.</param>
/// <param name="InsideTempC">Cabin temperature in SI degrees Celsius (web <c>state.inside_temp</c>).</param>
/// <param name="OutsideTempC">Outside temperature in SI degrees Celsius (web <c>state.outside_temp</c>).</param>
/// <param name="PowerKw">Instantaneous power in kilowatts (web <c>state.power</c>), the wire unit rendered verbatim with " kW".</param>
/// <param name="Status">The derived vehicle status string (web <c>status</c>), rendered verbatim.</param>
public sealed record QuickVehicleSnapshot(
    double BatteryLevel,
    double RatedRangeM,
    double OdometerM,
    double SpeedMps,
    double InsideTempC,
    double OutsideTempC,
    double PowerKw,
    string Status);

/// <summary>
/// One fully projected, render-ready metric tile — the native analogue of a single web <c>&lt;MetricCard&gt;</c>
/// (QuickStatsGrid.tsx lines 22-70). <see cref="Label"/> is the localized metric label; <see cref="Value"/> the
/// already-formatted display value the tile renders verbatim; <see cref="AccentBrushKey"/> the theme token brush
/// that tints the accent rail (the native mapping of the web <c>color</c> prop — see
/// <see cref="QuickStatsGridProjection"/>); <see cref="Subtitle"/> the optional muted caption line (only the
/// Speed tile carries one — the web <c>subtitle</c> driving/parked prop — every other tile leaves it null); and
/// <see cref="AutomationName"/> the spoken "<c>{label}: {value}</c>" (with the subtitle appended when present).
/// The web <c>icon</c> is intentionally dropped: the shared <c>TsMetricCard</c> carries its semantic colour on
/// the accent rail rather than a glyph, exactly as the sibling <c>SummaryStatsRow</c> port does. Pure data.
/// </summary>
/// <param name="Label">The localized tile label (web <c>t('common.*')</c>).</param>
/// <param name="Value">The final formatted readout (verbatim display + Narrator value).</param>
/// <param name="AccentBrushKey">The accent-rail brush resource key (theme-aware token, never a literal hex).</param>
/// <param name="Subtitle">The optional muted caption (web <c>subtitle</c>); null when the tile has none.</param>
/// <param name="AutomationName">The composed Narrator name for the tile (label + value + optional subtitle).</param>
public sealed record QuickStat(
    string Label,
    string Value,
    string AccentBrushKey,
    string? Subtitle,
    string AutomationName);

/// <summary>
/// The fully projected view of the grid for one input model — the native analogue of what the web
/// <c>QuickStatsGrid</c> renders. Holds the active <see cref="State"/>, the eight tile projections (empty while
/// loading), the shared loading copy, and the surface <see cref="AutomationName"/>. Pure data so every branch is
/// asserted headlessly.
/// </summary>
/// <param name="State">The mutually-exclusive surface state (<see cref="QuickStatsGridState"/>).</param>
/// <param name="Cards">The ordered, formatted metric tiles (empty while loading).</param>
/// <param name="LoadingLabel">The Narrator announcement while the skeleton renders.</param>
/// <param name="AutomationName">The composed surface Narrator name (joined tiles, or the loading label).</param>
public sealed record QuickStatsGridDisplay(
    QuickStatsGridState State,
    IReadOnlyList<QuickStat> Cards,
    string LoadingLabel,
    string AutomationName)
{
    /// <summary>The number of rendered tiles (web's eight <c>&lt;MetricCard&gt;</c>; zero while loading).</summary>
    public int CardCount => Cards.Count;
}

/// <summary>
/// The render-time data model the <c>QuickStatsGrid</c> view binds to — the native analogue of the web
/// <c>QuickStatsGridProps</c> (<c>state</c> + <c>status</c>), folded into the single SI snapshot the surface
/// actually reads. The presentational surface is fed the resolved <see cref="Vehicle"/> by the parent
/// vehicle-detail page (or null while that page is still loading the live state). Pure data — no WinUI types —
/// so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Vehicle">The resolved SI snapshot the grid reads, or null while the parent is still loading.</param>
public sealed record QuickStatsGridModel(QuickVehicleSnapshot? Vehicle)
{
    /// <summary>The initial model: the parent is still resolving the live state, so the skeleton branch renders.</summary>
    public static QuickStatsGridModel Pending { get; } = new((QuickVehicleSnapshot?)null);
}

/// <summary>
/// Pure projection from a <see cref="QuickStatsGridModel"/> to its <see cref="QuickStatsGridDisplay"/> — the
/// native port of web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx. The eight tiles
/// reproduce the web's eight <c>&lt;MetricCard&gt;</c> in order: Battery
/// (<c>`${state.battery_level}%`</c>, verbatim like the web template literal — no grouping, no forced decimals),
/// Range (<c>formatDistance(state.rated_range, {precision:0})</c>), Odometer
/// (<c>formatDistance(state.odometer, {precision:0})</c>), Speed
/// (<c>formatSpeed(state.speed, {precision:0})</c> with the driving/parked subtitle), Inside Temp
/// (<c>formatTemperature(state.inside_temp)</c>), Outside Temp (<c>formatTemperature(state.outside_temp)</c>),
/// Power (<c>`${fmtNumber(state.power)} kW`</c>) and State (<c>status</c>, verbatim). The distance / speed /
/// temperature values flow through the shared <see cref="UnitFormatters"/> SI→display port (the exact web
/// <c>useUnits</c> contract); the power value reproduces the web <c>fmtNumber</c> default (two fraction digits,
/// or the user's precision when set) plus the literal " kW"; and every label resolves through the i18n facade
/// using the <c>common.*</c> keys the web feeds into <c>t(...)</c>. Each web <c>color</c> maps to a theme-aware
/// token brush key (the web icon chip's tint): cyan → <c>TsColorInfoBrush</c>, green → <c>TsChartBatteryBrush</c>,
/// purple → <c>TsChartPowerBrush</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class QuickStatsGridProjection
{
    /// <summary>The literal percent suffix the web appends to the battery value (<c>`${level}%`</c>).</summary>
    public const string PercentSuffix = "%";

    /// <summary>The literal power unit suffix the web appends after a space (<c>`${fmtNumber(power)} kW`</c>).</summary>
    public const string PowerUnitSuffix = " kW";

    /// <summary>The number of metric tiles the grid always renders (web's eight <c>&lt;MetricCard&gt;</c>).</summary>
    public const int TileCount = 8;

    /// <summary>The web <c>fmtNumber</c> default fraction digits for the Power tile (its module precision is 2).</summary>
    public const int DefaultPowerPrecision = 2;

    /// <summary>The zero-decimal override the web passes to distance / speed (<c>{ precision: 0 }</c>).</summary>
    private const int WholeNumberPrecision = 0;

    // ── Web color → theme token brush keys (the web MetricCard icon-chip tint) ───────────────────────────────

    /// <summary>Accent token for the web <c>color="cyan"</c> tiles — <c>TsColorInfoBrush</c> (#00F0FF neon-cyan).</summary>
    public const string CyanBrushKey = "TsColorInfoBrush";

    /// <summary>Accent token for the web <c>color="green"</c> tiles — <c>TsChartBatteryBrush</c> (#10B981 emerald).</summary>
    public const string GreenBrushKey = "TsChartBatteryBrush";

    /// <summary>Accent token for the web <c>color="purple"</c> tiles — <c>TsChartPowerBrush</c> (#A855F7 neon-purple).</summary>
    public const string PurpleBrushKey = "TsChartPowerBrush";

    /// <summary>The battery-level threshold above which the web tints the Battery tile green (else cyan).</summary>
    private const double BatteryGreenThreshold = 50;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the user's units + i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props), or its pending form while loading.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits().unitPrefs</c>); metric when defaulted.</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>).</param>
    public static QuickStatsGridDisplay Project(QuickStatsGridModel model, UnitPref units, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string loadingLabel = localizer.GetString(
            QuickStatsGridRegistration.LoadingKey, QuickStatsGridRegistration.LoadingFallback);

        if (model.Vehicle is not { } vehicle)
        {
            return new QuickStatsGridDisplay(QuickStatsGridState.Loading, [], loadingLabel, loadingLabel);
        }

        var cards = BuildCards(vehicle, units, localizer);
        return new QuickStatsGridDisplay(
            QuickStatsGridState.Ready,
            cards,
            loadingLabel,
            BuildSurfaceAutomationName(cards));
    }

    private static List<QuickStat> BuildCards(QuickVehicleSnapshot v, UnitPref units, ILocalizer localizer)
    {
        // web: subtitle={state.speed > 0 ? t('common.driving') : t('common.parked')}.
        string motionSubtitle = v.SpeedMps > 0
            ? localizer.GetString(QuickStatsGridRegistration.DrivingKey, QuickStatsGridRegistration.DrivingFallback)
            : localizer.GetString(QuickStatsGridRegistration.ParkedKey, QuickStatsGridRegistration.ParkedFallback);

        return new List<QuickStat>(TileCount)
        {
            // web: value={`${state.battery_level}%`}, color green > 50 else cyan.
            Card(
                localizer.GetString(QuickStatsGridRegistration.BatteryKey, QuickStatsGridRegistration.BatteryFallback),
                JsNumberString(v.BatteryLevel) + PercentSuffix,
                v.BatteryLevel > BatteryGreenThreshold ? GreenBrushKey : CyanBrushKey),

            // web: value={formatDistance(state.rated_range, { precision: 0 })}, color cyan.
            Card(
                localizer.GetString(QuickStatsGridRegistration.RangeKey, QuickStatsGridRegistration.RangeFallback),
                UnitFormatters.FormatDistance(v.RatedRangeM, units, WholeNumberPrecision),
                CyanBrushKey),

            // web: value={formatDistance(state.odometer, { precision: 0 })}, color purple.
            Card(
                localizer.GetString(QuickStatsGridRegistration.OdometerKey, QuickStatsGridRegistration.OdometerFallback),
                UnitFormatters.FormatDistance(v.OdometerM, units, WholeNumberPrecision),
                PurpleBrushKey),

            // web: value={formatSpeed(state.speed, { precision: 0 })}, color cyan, subtitle driving/parked.
            Card(
                localizer.GetString(QuickStatsGridRegistration.SpeedKey, QuickStatsGridRegistration.SpeedFallback),
                UnitFormatters.FormatSpeed(v.SpeedMps, units, WholeNumberPrecision),
                CyanBrushKey,
                motionSubtitle),

            // web: value={formatTemperature(state.inside_temp)}, color green.
            Card(
                localizer.GetString(QuickStatsGridRegistration.InsideTempKey, QuickStatsGridRegistration.InsideTempFallback),
                UnitFormatters.FormatTemperature(v.InsideTempC, units),
                GreenBrushKey),

            // web: value={formatTemperature(state.outside_temp)}, color cyan.
            Card(
                localizer.GetString(QuickStatsGridRegistration.OutsideTempKey, QuickStatsGridRegistration.OutsideTempFallback),
                UnitFormatters.FormatTemperature(v.OutsideTempC, units),
                CyanBrushKey),

            // web: value={`${fmtNumber(state.power)} kW`}, color purple.
            Card(
                localizer.GetString(QuickStatsGridRegistration.PowerKey, QuickStatsGridRegistration.PowerFallback),
                FormatPower(v.PowerKw, units) + PowerUnitSuffix,
                PurpleBrushKey),

            // web: value={status}, color cyan.
            Card(
                localizer.GetString(QuickStatsGridRegistration.StateKey, QuickStatsGridRegistration.StateFallback),
                v.Status ?? string.Empty,
                CyanBrushKey),
        };
    }

    /// <summary>
    /// The web <c>fmtNumber(state.power)</c>: <c>safeNumber</c> coerces null / NaN / ∞ to 0, then en-US fixed-digit
    /// grouped formatting at the module precision (2) or the user's <see cref="UnitPref.Precision"/> when set.
    /// </summary>
    /// <param name="powerKw">The instantaneous power in kilowatts (web <c>state.power</c>).</param>
    /// <param name="units">The user's unit preference (its locale + precision drive the formatting).</param>
    public static string FormatPower(double powerKw, UnitPref units)
    {
        ArgumentNullException.ThrowIfNull(units);
        int digits = units.Precision is { } p and >= 0 ? p : DefaultPowerPrecision;
        double safe = double.IsFinite(powerKw) ? powerKw : 0;
        return NumberFormatting.Format(safe, units.Locale, digits);
    }

    /// <summary>
    /// The web template-literal coercion <c>`${value}`</c> (JS <c>String(number)</c>): an integral value renders
    /// with no fraction digits and no grouping, a fractional value with its shortest round-trip decimals — never
    /// the fixed-digit grouped <c>fmtNumber</c> form (the web battery tile interpolates the raw number directly).
    /// Non-finite input renders the JS token verbatim ("NaN" / "Infinity" / "-Infinity").
    /// </summary>
    /// <param name="value">The number to coerce to its JS string form (web <c>state.battery_level</c>).</param>
    public static string JsNumberString(double value)
    {
        if (double.IsNaN(value))
        {
            return "NaN";
        }

        if (double.IsPositiveInfinity(value))
        {
            return "Infinity";
        }

        if (double.IsNegativeInfinity(value))
        {
            return "-Infinity";
        }

        return value.ToString("R", CultureInfo.InvariantCulture);
    }

    private static QuickStat Card(string label, string value, string accentBrushKey, string? subtitle = null)
    {
        string narrator = subtitle is { Length: > 0 }
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}, {2}", label, value, subtitle)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
        return new QuickStat(label, value, accentBrushKey, subtitle, narrator);
    }

    private static string BuildSurfaceAutomationName(List<QuickStat> cards)
    {
        var parts = new string[cards.Count];
        for (int i = 0; i < cards.Count; i++)
        {
            parts[i] = cards[i].AutomationName;
        }

        return string.Join(". ", parts);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>QuickStatsGrid</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the battery level, range, odometer, speed,
/// cabin / outside temperature, power or status — so a diagnostics line can never leak a vehicle's live state or
/// location-adjacent telemetry. Thread-safe.
/// </summary>
public sealed class QuickStatsGridDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public QuickStatsGridDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=QuickStatsGrid</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={QuickStatsGridRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>QuickStatsGrid</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/vehicles/components/vehicle-detail/QuickStatsGrid.tsx</c>: the stable diagnostics slug and
/// the <c>common.*</c> i18n keys + English fallbacks the web source feeds into <c>t()</c> (plus the
/// <c>common.loading</c> key backing the skeleton's Narrator announcement that Windows accessibility minimums
/// require). UI-free so the metadata is asserted in tests and referenced without a XAML runtime.
/// </summary>
public static class QuickStatsGridRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "QuickStatsGrid";

    /// <summary>i18n key for the skeleton's Narrator announcement (no visible web text — a Windows a11y minimum).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for the skeleton's Narrator announcement.</summary>
    public const string LoadingFallback = "Loading...";

    /// <summary>i18n key for the Battery tile (web <c>t('common.battery', 'Battery')</c>).</summary>
    public const string BatteryKey = "common.battery";

    /// <summary>English fallback for the Battery tile — verbatim from the web source.</summary>
    public const string BatteryFallback = "Battery";

    /// <summary>i18n key for the Range tile (web <c>t('common.range', 'Range')</c>).</summary>
    public const string RangeKey = "common.range";

    /// <summary>English fallback for the Range tile — verbatim from the web source.</summary>
    public const string RangeFallback = "Range";

    /// <summary>i18n key for the Odometer tile (web <c>t('common.odometer', 'Odometer')</c>).</summary>
    public const string OdometerKey = "common.odometer";

    /// <summary>English fallback for the Odometer tile — verbatim from the web source.</summary>
    public const string OdometerFallback = "Odometer";

    /// <summary>i18n key for the Speed tile (web <c>t('common.speed', 'Speed')</c>).</summary>
    public const string SpeedKey = "common.speed";

    /// <summary>English fallback for the Speed tile — verbatim from the web source.</summary>
    public const string SpeedFallback = "Speed";

    /// <summary>i18n key for the Speed tile's "driving" subtitle (web <c>t('common.driving', 'Driving')</c>).</summary>
    public const string DrivingKey = "common.driving";

    /// <summary>English fallback for the "driving" subtitle — verbatim from the web source.</summary>
    public const string DrivingFallback = "Driving";

    /// <summary>i18n key for the Speed tile's "parked" subtitle (web <c>t('common.parked', 'Parked')</c>).</summary>
    public const string ParkedKey = "common.parked";

    /// <summary>English fallback for the "parked" subtitle — verbatim from the web source.</summary>
    public const string ParkedFallback = "Parked";

    /// <summary>i18n key for the Inside-Temp tile (web <c>t('common.insideTemp', 'Inside Temp')</c>).</summary>
    public const string InsideTempKey = "common.insideTemp";

    /// <summary>English fallback for the Inside-Temp tile — verbatim from the web source.</summary>
    public const string InsideTempFallback = "Inside Temp";

    /// <summary>i18n key for the Outside-Temp tile (web <c>t('common.outsideTemp', 'Outside Temp')</c>).</summary>
    public const string OutsideTempKey = "common.outsideTemp";

    /// <summary>English fallback for the Outside-Temp tile — verbatim from the web source.</summary>
    public const string OutsideTempFallback = "Outside Temp";

    /// <summary>i18n key for the Power tile (web <c>t('common.power', 'Power')</c>).</summary>
    public const string PowerKey = "common.power";

    /// <summary>English fallback for the Power tile — verbatim from the web source.</summary>
    public const string PowerFallback = "Power";

    /// <summary>i18n key for the State tile (web <c>t('common.state', 'State')</c>).</summary>
    public const string StateKey = "common.state";

    /// <summary>English fallback for the State tile — verbatim from the web source.</summary>
    public const string StateFallback = "State";
}
