using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The Tesla model family the visualization draws — the native mirror of the web
/// <c>TeslaModel = 'model3' | 'models' | 'modely' | 'modelx' | 'cybertruck'</c> union
/// (web/src/components/data-display/TeslaCarViz.tsx). It selects the per-model body silhouette, wheel /
/// headlight geometry and aspect ratio. Pure data so the model resolution is unit-tested without a UI host.
/// </summary>
public enum TeslaModelFamily
{
    /// <summary>web <c>'model3'</c> — the compact sport sedan (the default).</summary>
    Model3,

    /// <summary>web <c>'models'</c> — the longer, sleeker fastback.</summary>
    ModelS,

    /// <summary>web <c>'modely'</c> — the crossover with a taller greenhouse.</summary>
    ModelY,

    /// <summary>web <c>'modelx'</c> — the tall SUV with falcon-wing doors.</summary>
    ModelX,

    /// <summary>web <c>'cybertruck'</c> — the angular, geometric truck.</summary>
    Cybertruck,
}

/// <summary>
/// The render scale — the native mirror of the web <c>size = 'sm' | 'md' | 'lg'</c> prop
/// (web/src/components/data-display/TeslaCarViz.tsx). Maps to the logical pixel width the SVG canvas is drawn at
/// (the height follows from the per-model aspect ratio).
/// </summary>
public enum TeslaCarVizSize
{
    /// <summary>web <c>'sm'</c> — 180px wide.</summary>
    Small,

    /// <summary>web <c>'md'</c> — 280px wide (the default).</summary>
    Medium,

    /// <summary>web <c>'lg'</c> — 380px wide.</summary>
    Large,
}

/// <summary>
/// Which of the two public web exports to render — the full <c>&lt;TeslaCarViz&gt;</c> (the detailed,
/// state-rich schematic with the status legend) or the compact <c>&lt;TeslaCarMini&gt;</c> (the
/// card / list silhouette with just a battery bar and a charge dot), both defined in
/// web/src/components/data-display/TeslaCarViz.tsx.
/// </summary>
public enum TeslaCarVizVariant
{
    /// <summary>The full web <c>&lt;TeslaCarViz&gt;</c> export — body, wheels, lighting, indicators and status legend.</summary>
    Full,

    /// <summary>The compact web <c>&lt;TeslaCarMini&gt;</c> export — a small silhouette with a battery bar and charge dot.</summary>
    Mini,
}

/// <summary>
/// The render-time data model the <c>TeslaCarViz</c> view binds to — the native analogue of the web
/// <c>TeslaCarVizProps</c> (<c>{ batteryLevel, isCharging, isLocked, isClimateOn, sentryMode, speed, size?,
/// model? }</c> in web/src/components/data-display/TeslaCarViz.tsx). The web component is purely presentational:
/// its parent (a vehicle hero card / dashboard tile) owns any data fetching and feeds already-resolved live
/// values, so — exactly like React re-rendering the element with already-resolved props — there is no
/// fetch-driven loading / error / stale / offline branch to reproduce here. Every state the surface renders is a
/// pure function of these props (the driving / charging / locked / climate / sentry branches, the battery colour
/// thresholds and the per-model silhouette), and the surface always renders something — it never hides itself,
/// mirroring the web component which has no conditional that removes the whole tree. Pure data — no WinUI types —
/// so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="BatteryLevel">State-of-charge percentage 0-100 (web <c>batteryLevel</c>); drives the bar fill, colour and label.</param>
/// <param name="IsCharging">Whether the charge cable / plug animation and the "Charging" chip are shown (web <c>isCharging</c>).</param>
/// <param name="IsLocked">Whether the lock glyph is the locked (emerald) or unlocked (amber) variant (web <c>isLocked</c>).</param>
/// <param name="IsClimateOn">Whether the climate waves and the "Climate" chip are shown (web <c>isClimateOn</c>).</param>
/// <param name="SentryMode">Whether the sentry rings, the red ambient glow and the "Sentry" chip are shown (web <c>sentryMode</c>).</param>
/// <param name="Speed">Current speed; any value &gt; 0 puts the car into the driving state (web <c>speed</c>, <c>driving = speed &gt; 0</c>).</param>
/// <param name="Model">The model family the silhouette draws (web <c>model</c>, default <see cref="TeslaModelFamily.Model3"/>).</param>
/// <param name="Size">The render scale (web <c>size</c>, default <see cref="TeslaCarVizSize.Medium"/>).</param>
/// <param name="Variant">Which web export to render (full or mini), default <see cref="TeslaCarVizVariant.Full"/>.</param>
public sealed record TeslaCarVizModel(
    double BatteryLevel,
    bool IsCharging,
    bool IsLocked,
    bool IsClimateOn,
    bool SentryMode,
    double Speed,
    TeslaModelFamily Model = TeslaModelFamily.Model3,
    TeslaCarVizSize Size = TeslaCarVizSize.Medium,
    TeslaCarVizVariant Variant = TeslaCarVizVariant.Full)
{
    /// <summary>
    /// The initial / no-data model — an empty (0%), parked, unlocked, idle Model 3. The web component always
    /// renders, so the "no live data yet" state is this fully-formed baseline rather than a hidden surface.
    /// </summary>
    public static TeslaCarVizModel Unknown { get; } = new(
        BatteryLevel: 0,
        IsCharging: false,
        IsLocked: false,
        IsClimateOn: false,
        SentryMode: false,
        Speed: 0);

    /// <summary>True when the car is moving (web <c>driving = speed &gt; 0</c>): wheels spin, headlights come up, speed lines stream.</summary>
    public bool IsDriving => Speed > 0;

    /// <summary>
    /// Resolve a free-form vehicle model string ("Model 3 P", "Model Y", "Cybertruck") to a
    /// <see cref="TeslaModelFamily"/> — a 1:1 port of the web <c>parseModelKey</c>
    /// (web/src/components/data-display/TeslaCarViz.tsx): lower-case, strip all whitespace, then the same ordered
    /// substring tests (cybertruck / ct, then modelx / mx, modely / my, models / ms), defaulting to
    /// <see cref="TeslaModelFamily.Model3"/> when empty or unrecognised.
    /// </summary>
    /// <param name="model">The free-form model string (web <c>vehicle.model</c>); null / empty yields Model 3.</param>
    /// <returns>The matched model family, or <see cref="TeslaModelFamily.Model3"/>.</returns>
    public static TeslaModelFamily ParseModelKey(string? model)
    {
        if (string.IsNullOrEmpty(model))
        {
            return TeslaModelFamily.Model3;
        }

        // web: modelStr.toLowerCase().replace(/\s+/g, '') — invariant lower-case, then drop every whitespace run.
        string s = string.Concat(model.ToLowerInvariant().Where(c => !char.IsWhiteSpace(c)));

        if (s.Contains("cybertruck", StringComparison.Ordinal) || s.Contains("ct", StringComparison.Ordinal))
        {
            return TeslaModelFamily.Cybertruck;
        }

        if (s.Contains("modelx", StringComparison.Ordinal) || s.Contains("mx", StringComparison.Ordinal))
        {
            return TeslaModelFamily.ModelX;
        }

        if (s.Contains("modely", StringComparison.Ordinal) || s.Contains("my", StringComparison.Ordinal))
        {
            return TeslaModelFamily.ModelY;
        }

        if (s.Contains("models", StringComparison.Ordinal) || s.Contains("ms", StringComparison.Ordinal))
        {
            return TeslaModelFamily.ModelS;
        }

        return TeslaModelFamily.Model3;
    }
}

/// <summary>
/// Canonical metadata for the <c>TeslaCarViz</c> shared surface — the native analogue of the literals the web
/// source renders inline (web/src/components/data-display/TeslaCarViz.tsx): the diagnostics slug, the root
/// automation id, the SVG logical canvas dimensions and per-size widths / per-model aspect ratios, and the i18n
/// keys (each with the verbatim English fallback the web component renders as a hard-coded literal, now routed
/// through the P1/S10 facade) for the status-legend labels and the composed accessible description. UI-free so it
/// is asserted in tests.
/// </summary>
public static class TeslaCarVizRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TeslaCarViz";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "tesla-car-viz";

    /// <summary>The SVG logical viewBox width (web <c>viewBox="0 0 560 290"</c>).</summary>
    public const double LogicalWidth = 560;

    /// <summary>The SVG logical viewBox height (web <c>viewBox="0 0 560 290"</c>).</summary>
    public const double LogicalHeight = 290;

    /// <summary>The percent sign appended to the battery label (web literal <c>'%'</c>).</summary>
    public const string PercentSign = "%";

    /// <summary>The middle dot joining the parts of the composed accessible description.</summary>
    public const string Separator = ", ";

    /// <summary>i18n key for the charging chip (web literal <c>'Charging'</c>).</summary>
    public const string ChargingKey = "translation.vehicle.viz.charging";

    /// <summary>English fallback for <see cref="ChargingKey"/> — the web literal.</summary>
    public const string ChargingFallback = "Charging";

    /// <summary>i18n key for the not-charging chip (web literal <c>'Not Charging'</c>).</summary>
    public const string NotChargingKey = "translation.vehicle.viz.notCharging";

    /// <summary>English fallback for <see cref="NotChargingKey"/> — the web literal.</summary>
    public const string NotChargingFallback = "Not Charging";

    /// <summary>i18n key for the locked chip (web literal <c>'Locked'</c>).</summary>
    public const string LockedKey = "translation.vehicle.viz.locked";

    /// <summary>English fallback for <see cref="LockedKey"/> — the web literal.</summary>
    public const string LockedFallback = "Locked";

    /// <summary>i18n key for the unlocked chip (web literal <c>'Unlocked'</c>).</summary>
    public const string UnlockedKey = "translation.vehicle.viz.unlocked";

    /// <summary>English fallback for <see cref="UnlockedKey"/> — the web literal.</summary>
    public const string UnlockedFallback = "Unlocked";

    /// <summary>i18n key for the climate chip (web literal <c>'Climate'</c>).</summary>
    public const string ClimateKey = "translation.vehicle.viz.climate";

    /// <summary>English fallback for <see cref="ClimateKey"/> — the web literal.</summary>
    public const string ClimateFallback = "Climate";

    /// <summary>i18n key for the sentry chip (web literal <c>'Sentry'</c>).</summary>
    public const string SentryKey = "translation.vehicle.viz.sentry";

    /// <summary>English fallback for <see cref="SentryKey"/> — the web literal.</summary>
    public const string SentryFallback = "Sentry";

    /// <summary>i18n key for the driving fragment of the accessible description (web <c>driving</c> true).</summary>
    public const string DrivingKey = "translation.vehicle.viz.driving";

    /// <summary>English fallback for <see cref="DrivingKey"/>.</summary>
    public const string DrivingFallback = "Driving";

    /// <summary>i18n key for the parked fragment of the accessible description (web <c>driving</c> false).</summary>
    public const string ParkedKey = "translation.vehicle.viz.parked";

    /// <summary>English fallback for <see cref="ParkedKey"/>.</summary>
    public const string ParkedFallback = "Parked";

    /// <summary>i18n key for the composed accessible description template.</summary>
    public const string AriaKey = "translation.vehicle.viz.aria";

    /// <summary>English fallback for <see cref="AriaKey"/> — interpolates the model, battery and status fragments.</summary>
    public const string AriaFallback = "{{model}}, {{battery}}% battery, {{status}}";

    private const string ModelKeyPrefix = "translation.vehicle.viz.model.";

    /// <summary>The logical pixel width the canvas is drawn at for <paramref name="size"/> (web <c>sizeMap</c>).</summary>
    /// <param name="size">The render scale.</param>
    public static double Width(TeslaCarVizSize size) => size switch
    {
        TeslaCarVizSize.Small => 180,
        TeslaCarVizSize.Large => 380,
        _ => 280,
    };

    /// <summary>
    /// The width-to-height aspect ratio for <paramref name="model"/> (web <c>aspect</c>): the Cybertruck and the
    /// taller SUV / crossover are drawn slightly taller than the sedans.
    /// </summary>
    /// <param name="model">The model family.</param>
    public static double Aspect(TeslaModelFamily model) => model switch
    {
        TeslaModelFamily.Cybertruck => 0.56,
        TeslaModelFamily.ModelX or TeslaModelFamily.ModelY => 0.55,
        _ => 0.52,
    };

    /// <summary>The i18n key and English fallback (the brand name) for the model-family label.</summary>
    /// <param name="model">The model family.</param>
    public static (string Key, string Fallback) ModelLabelKey(TeslaModelFamily model) => model switch
    {
        TeslaModelFamily.ModelS => (ModelKeyPrefix + "models", "Model S"),
        TeslaModelFamily.ModelY => (ModelKeyPrefix + "modely", "Model Y"),
        TeslaModelFamily.ModelX => (ModelKeyPrefix + "modelx", "Model X"),
        TeslaModelFamily.Cybertruck => (ModelKeyPrefix + "cybertruck", "Cybertruck"),
        _ => (ModelKeyPrefix + "model3", "Model 3"),
    };

    /// <summary>Resolve the localized model-family label through the i18n facade.</summary>
    /// <param name="model">The model family.</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ModelLabel(TeslaModelFamily model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        (string key, string fallback) = ModelLabelKey(model);
        return localizer.GetString(key, fallback);
    }

    /// <summary>
    /// Stringify a percentage exactly as the web template literal does. The web source embeds the raw value
    /// (<c>${batteryLevel}%</c>) rather than passing it through the locale number formatter, so this reproduces
    /// JavaScript's <c>Number.prototype.toString</c>: the shortest round-trippable invariant representation, with
    /// no grouping and no forced decimals (78 → "78", 12.5 → "12.5").
    /// </summary>
    /// <param name="value">The finite percentage value.</param>
    public static string FormatPercent(double value) =>
        double.IsFinite(value)
            ? value.ToString(CultureInfo.InvariantCulture)
            : "0";
}

/// <summary>
/// The semantic colour mapping the <c>TeslaCarViz</c> indicators use — the native analogue of the web
/// <c>batteryColor</c> / <c>boolColor</c> helpers (web/src/lib/colors.ts) plus the fixed status hues
/// (charging emerald, climate cyan, sentry red) the web source hard-codes. Each maps to a generated design-token
/// brush key (so light / dark / high-contrast all flow from the token set) rather than an ad-hoc hex literal in
/// the control layer. UI-free so the mapping is asserted in tests.
/// </summary>
public static class TeslaCarVizColors
{
    /// <summary>The success (emerald) token — a healthy battery, an active charge, a locked car.</summary>
    public const string Success = "TsColorSuccessBrush";

    /// <summary>The warning (amber) token — a mid battery, an unlocked car.</summary>
    public const string Warning = "TsColorWarningBrush";

    /// <summary>The danger (red) token — a low battery, sentry mode.</summary>
    public const string Danger = "TsColorDangerBrush";

    /// <summary>The info (cyan) token — climate running.</summary>
    public const string Info = "TsColorInfoBrush";

    /// <summary>The muted token — an inactive status chip.</summary>
    public const string Muted = "TsColorTextMutedBrush";

    /// <summary>
    /// The token brush key for a battery level, a 1:1 port of the web <c>batteryColor</c>
    /// (web/src/lib/colors.ts): &gt; 60 emerald, &gt; 25 amber, otherwise red.
    /// </summary>
    /// <param name="level">The state-of-charge percentage.</param>
    public static string BatteryBrushKey(double level)
    {
        if (level > 60)
        {
            return Success;
        }

        return level > 25 ? Warning : Danger;
    }

    /// <summary>
    /// The token brush key for a boolean on/off state, a 1:1 port of the web <c>boolColor</c>
    /// (web/src/lib/colors.ts): emerald when active, amber when not.
    /// </summary>
    /// <param name="active">Whether the state is active.</param>
    public static string BoolBrushKey(bool active) => active ? Success : Warning;
}

/// <summary>
/// PII-safe diagnostics for the <c>TeslaCarViz</c> surface (P1/S11 diagnostics contract). The visualization
/// carries no user content (only a coarse battery percentage and boolean state flags), so the collector records
/// ONLY the operational <c>view.opened</c> event with the surface slug — never the battery level or any state —
/// so a diagnostics line can never leak fleet state. Thread-safe; mirrors the peer surfaces' collectors.
/// </summary>
public sealed class TeslaCarVizDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public TeslaCarVizDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TeslaCarViz</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TeslaCarVizRegistration.Slug}");
    }
}
