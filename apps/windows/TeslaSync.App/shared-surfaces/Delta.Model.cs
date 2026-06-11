using System.Collections.Generic;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Unit hint a <see cref="Delta"/> uses to pick the right prefix/suffix — the native port of the web
/// <c>MetricUnit</c> union (web/src/lib/metricSemantics.ts L21-L36). <see cref="None"/> covers the web
/// <c>'count'</c> and the absent (<c>undefined</c>) unit, both of which resolve to an empty suffix.
/// </summary>
public enum DeltaMetricUnit
{
    /// <summary>No unit — empty prefix/suffix (web <c>'count'</c> / <c>undefined</c> / default branch).</summary>
    None = 0,

    /// <summary>A currency amount — the user's currency symbol is shown as a prefix (web <c>'currency'</c>).</summary>
    Currency,

    /// <summary>A percentage — a trailing <c>%</c> (web <c>'percent'</c>).</summary>
    Percent,

    /// <summary>A distance in miles — suffix follows the user's distance preference (web <c>'mi'</c>).</summary>
    Miles,

    /// <summary>A distance in kilometres — suffix follows the user's distance preference (web <c>'km'</c>).</summary>
    Kilometres,

    /// <summary>Energy in kilowatt-hours (web <c>'kwh'</c>, suffix <c>kWh</c>).</summary>
    KilowattHours,

    /// <summary>Energy in watt-hours (web <c>'wh'</c>, suffix <c>Wh</c>).</summary>
    WattHours,

    /// <summary>Consumption efficiency (web <c>'wh_per_mi'</c>, suffix <c>Wh/mi</c> or <c>Wh/km</c>).</summary>
    WattHoursPerDistance,

    /// <summary>A duration in hours (web <c>'h'</c>, suffix <c>h</c>).</summary>
    Hours,

    /// <summary>A duration in minutes (web <c>'min'</c>, suffix <c>min</c>).</summary>
    Minutes,

    /// <summary>A bare count — empty suffix (web <c>'count'</c>).</summary>
    Count,

    /// <summary>A speed in miles per hour — suffix follows the user's speed preference (web <c>'mph'</c>).</summary>
    MilesPerHour,

    /// <summary>A speed in kilometres per hour — suffix follows the user's speed preference (web <c>'kph'</c>).</summary>
    KilometresPerHour,

    /// <summary>A temperature in Celsius — suffix follows the user's temperature preference (web <c>'c'</c>).</summary>
    Celsius,

    /// <summary>A temperature in Fahrenheit — suffix follows the user's temperature preference (web <c>'f'</c>).</summary>
    Fahrenheit,

    /// <summary>A tyre pressure — suffix follows the user's pressure preference (web <c>'bar'</c>).</summary>
    Pressure,
}

/// <summary>
/// Which form the value renders in — the native port of the web <c>display</c> prop
/// (web/src/components/data-display/Delta.tsx L25). Defaults to <see cref="Percent"/>.
/// </summary>
public enum DeltaDisplayMode
{
    /// <summary>The percent change (web <c>'percent'</c>, the default).</summary>
    Percent = 0,

    /// <summary>The absolute change in the metric's units (web <c>'absolute'</c>).</summary>
    Absolute,

    /// <summary>The absolute change followed by the percent in parentheses (web <c>'both'</c>).</summary>
    Both,
}

/// <summary>The chip / row size — the native port of the web <c>size</c> prop (web L28, <c>'sm' | 'md'</c>).</summary>
public enum DeltaSize
{
    /// <summary>Small — 12px text, 12px icon (web <c>'sm'</c>, the default).</summary>
    Sm = 0,

    /// <summary>Medium — 14px text, 14px icon (web <c>'md'</c>).</summary>
    Md,
}

/// <summary>
/// The mutually-exclusive render branches the surface shows — a faithful reproduction of the three branches in
/// the web <c>Delta</c> (web/src/components/data-display/Delta.tsx): the loading skeleton (web L140-L146,
/// <see cref="Loading"/>), the missing-inputs em-dash (web L148-L162, <see cref="Empty"/>) and the populated
/// indicator (web L164-L212, <see cref="Value"/>). The web component is presentational — it renders the
/// already-resolved <c>current</c> / <c>previous</c> / <c>loading</c> props passed by its parent and has no
/// fetch lifecycle (no error / stale / offline branch), exactly like the other presentational shared surfaces
/// (e.g. <c>ElevationProfile</c>, <c>AnnouncerRegion</c>).
/// </summary>
public enum DeltaState
{
    /// <summary>The forced loading skeleton (web <c>loading</c> prop true).</summary>
    Loading = 0,

    /// <summary>Missing / non-finite inputs — an em-dash with no good/bad colour (web <c>delta-empty</c>).</summary>
    Empty,

    /// <summary>A resolved comparison — arrow + coloured value (web populated branch).</summary>
    Value,
}

/// <summary>
/// A resolved metric semantic — the native port of the web <c>MetricSemantic</c>
/// (web/src/lib/metricSemantics.ts L38-L42): the direction that decides "is up good or bad?" and the optional
/// unit hint that decides the suffix/prefix. Reuse <see cref="DeltaMetrics"/> to resolve a registered id or to
/// build an inline semantic for a one-off metric.
/// </summary>
/// <param name="Id">The metric id (registry key or <c>inline</c>); never null.</param>
/// <param name="Direction">Whether a higher or lower value is the desirable outcome.</param>
/// <param name="Unit">The unit hint used for the suffix/prefix (<see cref="DeltaMetricUnit.None"/> = none).</param>
public readonly record struct DeltaMetricSemantic(string Id, MetricDirection Direction, DeltaMetricUnit Unit);

/// <summary>
/// The registry of common metrics and the resolver — the native port of the web <c>METRIC_SEMANTICS</c> map and
/// <c>resolveSemantic</c> (web/src/lib/metricSemantics.ts L50-L90). Naming uses the same snake_case ids as the
/// web (parity with the backend JSON tags); an unknown id resolves to a neutral, unit-less semantic so the UI
/// never throws on a typo, exactly like the web fallback.
/// </summary>
public static class DeltaMetrics
{
    private static readonly Dictionary<string, DeltaMetricSemantic> Registry =
        new(StringComparer.Ordinal)
        {
            ["cost"] = new("cost", MetricDirection.LowerBetter, DeltaMetricUnit.Currency),
            ["cost_per_mi"] = new("cost_per_mi", MetricDirection.LowerBetter, DeltaMetricUnit.Currency),
            ["energy_consumed"] = new("energy_consumed", MetricDirection.LowerBetter, DeltaMetricUnit.KilowattHours),
            ["energy_per_mi"] = new("energy_per_mi", MetricDirection.LowerBetter, DeltaMetricUnit.WattHoursPerDistance),
            ["range"] = new("range", MetricDirection.HigherBetter, DeltaMetricUnit.Miles),
            ["efficiency"] = new("efficiency", MetricDirection.LowerBetter, DeltaMetricUnit.WattHoursPerDistance),
            ["regen_pct"] = new("regen_pct", MetricDirection.HigherBetter, DeltaMetricUnit.Percent),
            ["drive_score"] = new("drive_score", MetricDirection.HigherBetter, DeltaMetricUnit.Count),
            ["vampire_drain"] = new("vampire_drain", MetricDirection.LowerBetter, DeltaMetricUnit.KilowattHours),
            ["idle_time"] = new("idle_time", MetricDirection.LowerBetter, DeltaMetricUnit.Hours),
            ["distance"] = new("distance", MetricDirection.Neutral, DeltaMetricUnit.Miles),
            ["trip_count"] = new("trip_count", MetricDirection.Neutral, DeltaMetricUnit.Count),
            ["charging_sessions"] = new("charging_sessions", MetricDirection.Neutral, DeltaMetricUnit.Count),
            ["battery_health_pct"] = new("battery_health_pct", MetricDirection.HigherBetter, DeltaMetricUnit.Percent),
            ["speed_avg"] = new("speed_avg", MetricDirection.Neutral, DeltaMetricUnit.MilesPerHour),
            ["temperature"] = new("temperature", MetricDirection.Neutral, DeltaMetricUnit.Celsius),
            ["pressure"] = new("pressure", MetricDirection.Neutral, DeltaMetricUnit.Pressure),
        };

    /// <summary>The number of registered metrics (parity guard against the web registry).</summary>
    public static int Count => Registry.Count;

    /// <summary>
    /// Resolve a registered metric <paramref name="id"/> to its semantic — the native port of
    /// <c>resolveSemantic(id)</c> (web L83-L87). An unknown / blank id falls back to a neutral, unit-less
    /// semantic carrying the supplied id, so the indicator never throws on a typo.
    /// </summary>
    public static DeltaMetricSemantic Resolve(string? id)
    {
        if (!string.IsNullOrEmpty(id) && Registry.TryGetValue(id, out var found))
        {
            return found;
        }

        return new DeltaMetricSemantic(id ?? "inline", MetricDirection.Neutral, DeltaMetricUnit.None);
    }

    /// <summary>
    /// Build an inline semantic for a one-off metric — the native port of the web inline
    /// <c>{ direction, unit }</c> object (web L19, L88-L89). The id is <c>inline</c>, matching the web fallback.
    /// </summary>
    public static DeltaMetricSemantic Inline(MetricDirection direction, DeltaMetricUnit unit = DeltaMetricUnit.None) =>
        new("inline", direction, unit);

    /// <summary>True when <paramref name="id"/> is a registered metric.</summary>
    public static bool IsRegistered(string id) => !string.IsNullOrEmpty(id) && Registry.ContainsKey(id);
}

/// <summary>The resolved prefix/suffix for a value — the native port of the web <c>ResolvedUnitLabels</c> (web L40-L45).</summary>
/// <param name="Prefix">Shown before the value (e.g. a currency symbol); empty when there is none.</param>
/// <param name="Suffix">Shown after the value (e.g. <c>kWh</c>); empty when there is none.</param>
public readonly record struct DeltaUnitLabels(string Prefix, string Suffix);

/// <summary>
/// The user's unit + currency display context a <see cref="Delta"/> resolves labels against — the native
/// analogue of the values the web <c>useUnitLabels</c> reads from <c>useUnits()</c> / <c>useFormatting()</c>
/// (web/src/components/data-display/Delta.tsx L47-L85). It carries the four per-quantity display preferences
/// (distance / speed / temperature / pressure), the currency symbol and the locale + precision hints, all
/// already resolved by the shared settings/units state holder (P1/S8). The value never reaches into settings
/// itself; the holder passes a resolved context, exactly as the web component reads a resolved
/// <c>unitPrefs</c>.
/// </summary>
public sealed record DeltaUnitContext
{
    /// <summary>The default currency symbol when none is configured (web <c>useFormatting</c> default <c>$</c>).</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Creates a context from explicit per-quantity preferences.</summary>
    public DeltaUnitContext(
        DistanceUnit distance,
        SpeedUnit speed,
        TemperatureUnit temperature,
        PressureUnit pressure,
        string? currencySymbol = null,
        string? locale = null,
        int? precision = null)
    {
        Distance = distance;
        Speed = speed;
        Temperature = temperature;
        Pressure = pressure;
        CurrencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? DefaultCurrencySymbol : currencySymbol;
        Locale = locale;
        Precision = precision;
    }

    /// <summary>The metric-default context (km, km/h, °C, kPa→bar, <c>$</c>).</summary>
    public static DeltaUnitContext Metric { get; } = FromUnitPref(UnitPref.Metric, DefaultCurrencySymbol);

    /// <summary>The imperial-default context (mi, mph, °F, psi, <c>$</c>).</summary>
    public static DeltaUnitContext Imperial { get; } = FromUnitPref(UnitPref.Imperial, DefaultCurrencySymbol);

    /// <summary>The distance display preference (web <c>unitPrefs.distance</c>).</summary>
    public DistanceUnit Distance { get; }

    /// <summary>The speed display preference (web <c>unitPrefs.speed</c>).</summary>
    public SpeedUnit Speed { get; }

    /// <summary>The temperature display preference (web <c>unitPrefs.temperature</c>).</summary>
    public TemperatureUnit Temperature { get; }

    /// <summary>The pressure display preference (web <c>unitPrefs.pressure</c>).</summary>
    public PressureUnit Pressure { get; }

    /// <summary>The currency symbol shown as a prefix (web <c>useFormatting().currencySymbol</c>).</summary>
    public string CurrencySymbol { get; }

    /// <summary>The BCP-47 locale used for number grouping/separators (web <c>unitPrefs.locale</c>).</summary>
    public string? Locale { get; }

    /// <summary>The default decimal precision for the absolute form (web settings <c>decimal_precision</c>).</summary>
    public int? Precision { get; }

    /// <summary>
    /// Builds a context from a resolved <see cref="UnitPref"/> (the same bag the shared formatters consume) plus
    /// the active currency symbol — the bridge a host uses so <see cref="Delta"/> shares one units source with
    /// the rest of the app.
    /// </summary>
    public static DeltaUnitContext FromUnitPref(UnitPref pref, string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(pref);
        return new DeltaUnitContext(
            pref.Distance,
            pref.Speed,
            pref.Temperature,
            pref.Pressure,
            currencySymbol,
            pref.Locale,
            pref.Precision);
    }

    /// <summary>
    /// Resolve the prefix/suffix for <paramref name="unit"/> — the native port of the web <c>useUnitLabels</c>
    /// switch (web L55-L84). Distance / speed / temperature / pressure follow the user's preference; the
    /// efficiency suffix is <c>Wh/mi</c> when distance is miles and <c>Wh/km</c> otherwise (web L53). The
    /// pressure suffix follows the web <c>useUnits</c> derivation, which only ever yields <c>bar</c> or
    /// <c>psi</c> (web/src/hooks/useUnits.ts L102-L104), so a kPa preference renders as <c>bar</c>.
    /// </summary>
    public DeltaUnitLabels ResolveLabels(DeltaMetricUnit unit) => unit switch
    {
        DeltaMetricUnit.Currency => new DeltaUnitLabels(CurrencySymbol, string.Empty),
        DeltaMetricUnit.Percent => new DeltaUnitLabels(string.Empty, "%"),
        DeltaMetricUnit.Miles or DeltaMetricUnit.Kilometres => new DeltaUnitLabels(string.Empty, DistanceLabel),
        DeltaMetricUnit.KilowattHours => new DeltaUnitLabels(string.Empty, "kWh"),
        DeltaMetricUnit.WattHours => new DeltaUnitLabels(string.Empty, "Wh"),
        DeltaMetricUnit.WattHoursPerDistance => new DeltaUnitLabels(string.Empty, EfficiencyLabel),
        DeltaMetricUnit.Hours => new DeltaUnitLabels(string.Empty, "h"),
        DeltaMetricUnit.Minutes => new DeltaUnitLabels(string.Empty, "min"),
        DeltaMetricUnit.MilesPerHour or DeltaMetricUnit.KilometresPerHour => new DeltaUnitLabels(string.Empty, SpeedLabel),
        DeltaMetricUnit.Celsius or DeltaMetricUnit.Fahrenheit => new DeltaUnitLabels(string.Empty, TemperatureLabel),
        DeltaMetricUnit.Pressure => new DeltaUnitLabels(string.Empty, PressureLabel),
        _ => new DeltaUnitLabels(string.Empty, string.Empty),
    };

    private string DistanceLabel => UnitLabels.Label(Distance);

    private string SpeedLabel => UnitLabels.Label(Speed);

    private string TemperatureLabel => UnitLabels.Label(Temperature);

    // web useUnits.derivePressure yields only 'bar' | 'psi'; kPa floors to bar at the Delta display boundary.
    private string PressureLabel => Pressure == PressureUnit.Psi ? "psi" : "bar";

    // web L53: efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km'.
    private string EfficiencyLabel => Distance == DistanceUnit.Mi ? "Wh/mi" : "Wh/km";
}

/// <summary>
/// The full set of inputs for one <see cref="Delta"/> indicator — the native port of the web <c>DeltaProps</c>
/// (web/src/components/data-display/Delta.tsx L17-L38). The defaults mirror the web prop defaults
/// (<see cref="Display"/> = percent, <see cref="Size"/> = sm, <see cref="Inline"/> = true).
/// </summary>
public sealed record DeltaInput
{
    /// <summary>The resolved metric semantic (registry id or inline). Defaults to a neutral, unit-less metric.</summary>
    public DeltaMetricSemantic Metric { get; init; } = DeltaMetrics.Inline(MetricDirection.Neutral);

    /// <summary>The current-period value, in the metric's display units (web <c>current</c>). Null renders the em-dash.</summary>
    public double? Current { get; init; }

    /// <summary>The previous-period value (web <c>previous</c>). Null renders the em-dash.</summary>
    public double? Previous { get; init; }

    /// <summary>Which form to render (web <c>display</c>, default percent).</summary>
    public DeltaDisplayMode Display { get; init; } = DeltaDisplayMode.Percent;

    /// <summary>Trailing comparison label, e.g. "vs last week" (web <c>comparedTo</c>, typically <c>useCompareWindow().previousLabel</c>).</summary>
    public string? ComparedTo { get; init; }

    /// <summary>The chip / row size (web <c>size</c>, default sm).</summary>
    public DeltaSize Size { get; init; } = DeltaSize.Sm;

    /// <summary>When true render a tight inline chip; when false a stat row (web <c>inline</c>, default true).</summary>
    public bool Inline { get; init; } = true;

    /// <summary>Hide the directional arrow (web <c>hideArrow</c>).</summary>
    public bool HideArrow { get; init; }

    /// <summary>Force the loading skeleton (web <c>loading</c>).</summary>
    public bool Loading { get; init; }

    /// <summary>Override the default precision (web <c>precision</c>); null uses the per-form defaults.</summary>
    public int? Precision { get; init; }
}

/// <summary>
/// The render-ready projection of one <see cref="DeltaInput"/> — everything the WinUI view needs to draw a
/// frame without recomputing anything, so the view is a thin renderer and the projection is verified
/// headlessly. It is the native analogue of the values the web <c>Delta</c> derives in its component body
/// (web/src/components/data-display/Delta.tsx L133-L212): the <see cref="State"/> branch, the directional
/// <see cref="Arrow"/> + colour <see cref="Tone"/> (and the themed <see cref="AccentBrushKey"/>), the unsigned
/// <see cref="PrimaryText"/> (+ the parenthetical <see cref="SecondaryText"/> for the "both" form), the trailing
/// <see cref="ComparedTo"/> label, the tooltip <see cref="Title"/> and a Narrator <see cref="AccessibleName"/>.
/// </summary>
public sealed class DeltaDisplay
{
    /// <summary>The em-dash rendered for the empty state and for a percent form with a zero baseline (web <c>—</c>).</summary>
    public const string EmDash = "\u2014";

    internal DeltaDisplay(
        DeltaState state,
        DeltaSize size,
        bool inline,
        bool hasArrow,
        DeltaArrow arrow,
        DeltaTone tone,
        string accentBrushKey,
        string primaryText,
        string secondaryText,
        string comparedTo,
        string title,
        string accessibleName)
    {
        State = state;
        Size = size;
        Inline = inline;
        HasArrow = hasArrow;
        Arrow = arrow;
        Tone = tone;
        AccentBrushKey = accentBrushKey;
        PrimaryText = primaryText;
        SecondaryText = secondaryText;
        ComparedTo = comparedTo;
        Title = title;
        AccessibleName = accessibleName;
    }

    /// <summary>Which render branch this projection represents.</summary>
    public DeltaState State { get; }

    /// <summary>The chip / row size.</summary>
    public DeltaSize Size { get; }

    /// <summary>True for the tight inline chip; false for the stat row (web <c>inline</c>).</summary>
    public bool Inline { get; }

    /// <summary>True when the directional arrow should be drawn (false in the loading / hidden-arrow cases).</summary>
    public bool HasArrow { get; }

    /// <summary>The directional arrow for the sign (web Arrow icon).</summary>
    public DeltaArrow Arrow { get; }

    /// <summary>The colour tone for the change (web colour class).</summary>
    public DeltaTone Tone { get; }

    /// <summary>The themed brush key the view resolves for the arrow + value (web emerald/rose/muted/secondary).</summary>
    public string AccentBrushKey { get; }

    /// <summary>The primary value text — the unsigned magnitude, or the em-dash (web value node).</summary>
    public string PrimaryText { get; }

    /// <summary>The parenthetical percent for the "both" form, e.g. <c>(12.0%)</c>; empty otherwise (web opacity-70 span).</summary>
    public string SecondaryText { get; }

    /// <summary>The trailing comparison label (web <c>comparedTo</c>); empty when none was supplied.</summary>
    public string ComparedTo { get; }

    /// <summary>The tooltip text (web <c>title</c> attribute): the comparison detail or the no-comparison message.</summary>
    public string Title { get; }

    /// <summary>The Narrator name for the whole indicator (the visible text, since the arrow is decorative).</summary>
    public string AccessibleName { get; }

    /// <summary>True while the loading skeleton is showing.</summary>
    public bool IsLoading => State == DeltaState.Loading;

    /// <summary>True while the missing-inputs em-dash is showing.</summary>
    public bool IsEmpty => State == DeltaState.Empty;

    /// <summary>True while a resolved comparison is showing.</summary>
    public bool IsValue => State == DeltaState.Value;

    /// <summary>True when a trailing comparison label should be drawn.</summary>
    public bool HasComparedTo => !string.IsNullOrEmpty(ComparedTo);

    /// <summary>True when the parenthetical percent should be drawn (the "both" form with a defined percent).</summary>
    public bool HasSecondaryText => !string.IsNullOrEmpty(SecondaryText);
}

/// <summary>
/// Canonical metadata + localized strings for the delta surface — the native analogue of the module-level
/// identity and the two <c>t()</c> calls in the web <c>Delta</c> (web/src/components/data-display/Delta.tsx
/// L156, L201-L204). The i18n keys resolve through the shared facade (P1/S10) and exist in the catalog as
/// <c>translation.delta.noComparison</c> and <c>translation.delta.title</c>.
/// </summary>
public static class DeltaRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "Delta";

    /// <summary>i18n key for the no-comparison tooltip (web <c>delta.noComparison</c>).</summary>
    public const string NoComparisonKey = "translation.delta.noComparison";

    /// <summary>i18n key for the comparison tooltip template (web <c>delta.title</c>, tokens current/previous).</summary>
    public const string TitleKey = "translation.delta.title";

    /// <summary>i18n key for the loading announcement reused from the common catalog.</summary>
    public const string LoadingKey = "translation.common.loading";

    /// <summary>Default precision for the percent form (web <c>precision ?? 1</c>).</summary>
    public const int DefaultPercentPrecision = 1;

    /// <summary>Default precision for the absolute form and the tooltip (web global / <c>precision ?? 2</c>).</summary>
    public const int DefaultAbsolutePrecision = 2;

    /// <summary>Localized no-comparison tooltip (web <c>t('delta.noComparison', 'No comparison data')</c>).</summary>
    public static string NoComparison(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(NoComparisonKey, "No comparison data");
    }

    /// <summary>Localized loading announcement (reuses the common catalog key).</summary>
    public static string Loading(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LoadingKey, "Loading\u2026");
    }

    /// <summary>
    /// Localized comparison tooltip with the two formatted figures substituted — the native port of
    /// <c>t('delta.title', '{{current}} vs {{previous}}', { current, previous })</c> (web L201-L204). The token
    /// replacement mirrors the i18next interpolation the web relies on.
    /// </summary>
    public static string Title(ILocalizer localizer, string current, string previous)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, "{{current}} vs {{previous}}")
            .Replace("{{current}}", current, StringComparison.Ordinal)
            .Replace("{{previous}}", previous, StringComparison.Ordinal);
    }
}

/// <summary>
/// Pure, UI-thread-free projection of one <see cref="DeltaInput"/> into a render-ready <see cref="DeltaDisplay"/>
/// — the native port of the web <c>Delta</c> component body (web/src/components/data-display/Delta.tsx
/// L120-L212). It reuses the shared <see cref="DeltaLogic"/> for the sign/arrow/tone/percent maths (the same
/// engine the atomic chip uses) and the shared <see cref="NumberFormatting"/> for locale-aware grouping (the
/// native <c>fmtNumber</c>), so both the WinUI view and the unit tests share one source of truth. It performs
/// no unit math itself and touches no view framework.
/// </summary>
public static class DeltaProjection
{
    /// <summary>
    /// Project <paramref name="input"/> against the user's <paramref name="context"/>, resolving every label
    /// through <paramref name="localizer"/>. Reproduces the web branch order exactly: loading first (web
    /// L140-L146), then the missing-inputs em-dash (web L148-L162), then the populated indicator (web
    /// L164-L212).
    /// </summary>
    public static DeltaDisplay Project(DeltaInput input, DeltaUnitContext context, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(input);
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(localizer);

        string comparedTo = input.ComparedTo ?? string.Empty;

        // web L140-L146: the forced loading skeleton — no arrow, no value, no comparedTo.
        if (input.Loading)
        {
            return new DeltaDisplay(
                DeltaState.Loading,
                input.Size,
                input.Inline,
                hasArrow: false,
                DeltaArrow.Flat,
                DeltaTone.Muted,
                DeltaLogic.AccentBrushKey(DeltaTone.Muted),
                primaryText: string.Empty,
                secondaryText: string.Empty,
                comparedTo: string.Empty,
                title: string.Empty,
                accessibleName: DeltaRegistration.Loading(localizer));
        }

        var semantic = input.Metric;
        var result = DeltaLogic.Compute(input.Current, input.Previous, semantic.Direction);

        // web L148-L162: missing / non-finite inputs render an em-dash with no good/bad colour.
        if (!result.HasComparison)
        {
            string emptyTitle = DeltaRegistration.NoComparison(localizer);
            string emptyName = string.IsNullOrEmpty(comparedTo) ? emptyTitle : $"{emptyTitle} {comparedTo}";
            return new DeltaDisplay(
                DeltaState.Empty,
                input.Size,
                input.Inline,
                hasArrow: false,
                DeltaArrow.Flat,
                DeltaTone.Muted,
                DeltaLogic.AccentBrushKey(DeltaTone.Muted),
                primaryText: DeltaDisplay.EmDash,
                secondaryText: string.Empty,
                comparedTo: comparedTo,
                title: emptyTitle,
                accessibleName: emptyName);
        }

        // web L164-L212: the populated indicator.
        var labels = context.ResolveLabels(semantic.Unit);
        int absoluteDigits = input.Precision ?? context.Precision ?? DeltaRegistration.DefaultAbsolutePrecision;
        int percentDigits = input.Precision ?? DeltaRegistration.DefaultPercentPrecision;
        int titleDigits = input.Precision ?? DeltaRegistration.DefaultAbsolutePrecision;

        string absText = FormatAbsolute(result.AbsoluteDelta, labels, absoluteDigits, context.Locale);
        string? pctText = result.AbsolutePercent is { } absPct
            ? Format(absPct, percentDigits, context.Locale) + "%"
            : null;

        // web L182-L192: the value node by display mode.
        string primary;
        string secondary;
        switch (input.Display)
        {
            case DeltaDisplayMode.Absolute:
                primary = absText;
                secondary = string.Empty;
                break;
            case DeltaDisplayMode.Both:
                primary = absText;
                secondary = pctText is null ? string.Empty : $"({pctText})";
                break;
            default: // Percent — when previous=0 the percent is undefined; fall back to the em-dash.
                primary = pctText ?? DeltaDisplay.EmDash;
                secondary = string.Empty;
                break;
        }

        string title = DeltaRegistration.Title(
            localizer,
            Format(SafeValue(input.Current), titleDigits, context.Locale),
            Format(SafeValue(input.Previous), titleDigits, context.Locale));

        string visible = string.IsNullOrEmpty(secondary) ? primary : $"{primary} {secondary}";
        string accessibleName = string.IsNullOrEmpty(comparedTo) ? visible : $"{visible} {comparedTo}";

        return new DeltaDisplay(
            DeltaState.Value,
            input.Size,
            input.Inline,
            hasArrow: !input.HideArrow,
            result.Arrow,
            result.Tone,
            DeltaLogic.AccentBrushKey(result.Tone),
            primaryText: primary,
            secondaryText: secondary,
            comparedTo: comparedTo,
            title: title,
            accessibleName: accessibleName);
    }

    // web L87-L94: formatAbsolute — prefix/suffix composition around the formatted magnitude.
    private static string FormatAbsolute(double value, DeltaUnitLabels labels, int digits, string? locale)
    {
        string num = Format(value, digits, locale);
        if (!string.IsNullOrEmpty(labels.Prefix) && !string.IsNullOrEmpty(labels.Suffix))
        {
            return $"{labels.Prefix}{num} {labels.Suffix}";
        }

        if (!string.IsNullOrEmpty(labels.Prefix))
        {
            return $"{labels.Prefix}{num}";
        }

        if (labels.Suffix == "%")
        {
            return $"{num}%";
        }

        if (!string.IsNullOrEmpty(labels.Suffix))
        {
            return $"{num} {labels.Suffix}";
        }

        return num;
    }

    // Mirrors the web fmtNumber: non-finite inputs are treated as 0 (safeNumber); precision is bounded 0..20.
    private static string Format(double value, int digits, string? locale)
    {
        double safe = double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
        return NumberFormatting.Format(safe, locale, Math.Clamp(digits, 0, 20));
    }

    private static double SafeValue(double? value) =>
        value is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? v : 0.0;
}

/// <summary>
/// PII-safe diagnostics for the delta surface (P1/S11 diagnostics contract). A delta can carry sensitive
/// figures (cost, range, energy), so the collector records ONLY the operational <see cref="RecordViewOpened"/>
/// signal with the surface slug — never a value, percent or comparison label. Thread-safe; mirrors the other
/// shared-surface diagnostics collectors.
/// </summary>
public sealed class DeltaDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DeltaDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Delta</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DeltaRegistration.Slug}");
    }
}
