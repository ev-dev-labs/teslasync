using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the CarAnimation surface — the native analogue of the module-level constants,
/// geometry and default <c>t()</c> calls in <c>web/src/components/motion/CarAnimation.tsx</c>. The web module
/// exports four pure presentational SVG illustrations used for loading states and hero sections —
/// <c>CarAnimation</c> (an animated Tesla silhouette), <c>ChargingBolt</c> (a pulsing charge icon),
/// <c>BatteryFillAnimation</c> (a fill gauge) and <c>WheelSpin</c> (a spinning wheel) — each of which honours
/// <c>prefers-reduced-motion</c> by rendering its final state with no entry / draw-in / pulsing loop. None of
/// them read network data (their only inputs are caller props plus the CSS motion preference), so this carries
/// the diagnostics slug, the per-control automation ids, the ARIA role the image illustrations declare
/// (<c>role="img"</c>), the three i18n keys the source references (the <c>aria-label</c>s), the exact SVG
/// geometry (the path data, viewBoxes, circle / ellipse / rect specs and wheel-spoke angles) and the animation
/// timeline values (durations, delays and the pulse keyframes). UI-free so every value is asserted headlessly;
/// the WinUI views build their shapes and Storyboards from it.
/// </summary>
public static class CarAnimationRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "CarAnimation";

    /// <summary>
    /// ARIA role the three image illustrations declare (web <c>role="img"</c>). The battery gauge is decorative
    /// in the web source (no role / label) and therefore exposes no name.
    /// </summary>
    public const string ImageRole = "img";

    // ── automation ids (the web source declares no data-testid; these are the native-only stable hooks) ──────

    /// <summary>Root automation id for the <see cref="CarAnimation"/> silhouette control.</summary>
    public const string CarAutomationId = "car-animation";

    /// <summary>Root automation id for the <see cref="ChargingBolt"/> control.</summary>
    public const string ChargingBoltAutomationId = "car-animation-charging-bolt";

    /// <summary>Root automation id for the <see cref="BatteryFillAnimation"/> control.</summary>
    public const string BatteryFillAutomationId = "car-animation-battery-fill";

    /// <summary>Root automation id for the <see cref="WheelSpin"/> control.</summary>
    public const string WheelSpinAutomationId = "car-animation-wheel-spin";

    // ── i18n (translation-namespaced keys; fallbacks are the web second args, verbatim) ──────────────────────

    /// <summary>i18n key for the silhouette label (web <c>t('carAnimation.tesla', 'Tesla vehicle illustration')</c>).</summary>
    public const string TeslaLabelKey = "translation.carAnimation.tesla";

    /// <summary>English fallback for <see cref="TeslaLabelKey"/> (web second arg, verbatim).</summary>
    public const string TeslaLabelFallback = "Tesla vehicle illustration";

    /// <summary>i18n key for the charging-bolt label (web <c>t('carAnimation.charging', 'Charging')</c>).</summary>
    public const string ChargingLabelKey = "translation.carAnimation.charging";

    /// <summary>English fallback for <see cref="ChargingLabelKey"/> (web second arg, verbatim).</summary>
    public const string ChargingLabelFallback = "Charging";

    /// <summary>i18n key for the spinning-wheel label (web <c>t('carAnimation.loading', 'Loading')</c>).</summary>
    public const string LoadingLabelKey = "translation.carAnimation.loading";

    /// <summary>English fallback for <see cref="LoadingLabelKey"/> (web second arg, verbatim).</summary>
    public const string LoadingLabelFallback = "Loading";

    // ── default sizes (web prop defaults) ────────────────────────────────────────────────────────────────────

    /// <summary>Default <see cref="CarAnimation"/> width in pixels (web <c>size = 120</c>).</summary>
    public const double CarDefaultSize = 120;

    /// <summary>The silhouette's height multiplier (web <c>h = size * 0.4</c>).</summary>
    public const double CarHeightRatio = 0.4;

    /// <summary>Default <see cref="ChargingBolt"/> size in pixels (web <c>size = 32</c>).</summary>
    public const double ChargingBoltDefaultSize = 32;

    /// <summary>Default <see cref="BatteryFillAnimation"/> size in pixels (web <c>size = 48</c>).</summary>
    public const double BatteryDefaultSize = 48;

    /// <summary>The gauge's height multiplier (web <c>height={size * 0.5}</c>).</summary>
    public const double BatteryHeightRatio = 0.5;

    /// <summary>Default <see cref="BatteryFillAnimation"/> level percentage (web <c>level = 80</c>).</summary>
    public const double BatteryDefaultLevel = 80;

    /// <summary>Default <see cref="WheelSpin"/> size in pixels (web <c>size = 24</c>).</summary>
    public const double WheelSpinDefaultSize = 24;

    // ── viewBoxes (the authoring coordinate spaces) ──────────────────────────────────────────────────────────

    /// <summary>The silhouette authoring width (web <c>viewBox="0 0 240 96"</c>).</summary>
    public const double CarViewBoxWidth = 240;

    /// <summary>The silhouette authoring height (web <c>viewBox="0 0 240 96"</c>).</summary>
    public const double CarViewBoxHeight = 96;

    /// <summary>The charging-bolt authoring side (web <c>viewBox="0 0 24 24"</c>).</summary>
    public const double ChargingBoltViewBox = 24;

    /// <summary>The battery-gauge authoring width (web <c>viewBox="0 0 48 24"</c>).</summary>
    public const double BatteryViewBoxWidth = 48;

    /// <summary>The battery-gauge authoring height (web <c>viewBox="0 0 48 24"</c>).</summary>
    public const double BatteryViewBoxHeight = 24;

    /// <summary>The wheel authoring side (web <c>viewBox="0 0 24 24"</c>).</summary>
    public const double WheelSpinViewBox = 24;

    // ── silhouette geometry (web 240×96 space) ───────────────────────────────────────────────────────────────

    /// <summary>The car-body outline path (web first <c>motion.path</c> <c>d</c>).</summary>
    public const string BodyPathData =
        "M30 60 Q30 40 50 35 L80 28 Q100 20 130 20 Q160 20 180 28 L210 35 Q230 40 230 60 L230 65 Q230 70 225 70 L35 70 Q30 70 30 65 Z";

    /// <summary>The windshield path (web second <c>motion.path</c> <c>d</c>).</summary>
    public const string WindshieldPathData = "M85 30 Q100 22 130 22 Q155 22 170 28 L155 42 Q140 44 120 44 Q100 44 90 42 Z";

    /// <summary>The rear-window path (web third <c>motion.path</c> <c>d</c>).</summary>
    public const string RearWindowPathData = "M55 38 L82 30 L88 42 Q78 44 68 42 Z";

    /// <summary>
    /// The dash length, in 240×96 user units, used to draw the car-body outline (web <c>pathLength: 0 -&gt; 1</c>).
    /// Framer-motion normalises the stroke draw against the geometry's measured length; the WinUI stroke-dash draw
    /// needs that length up front and a parsed Bézier <c>Geometry</c> does not expose it, so this is a measured
    /// over-estimate of the body perimeter (~450 units) with a small margin so the outline is fully hidden at the
    /// start of the sweep and fully drawn by the end.
    /// </summary>
    public const double BodyOutlineDrawUnits = 480;

    /// <summary>The shared vertical centre of both wheels (web <c>cy="70"</c>).</summary>
    public const double WheelCenterY = 70;

    /// <summary>The front wheel's horizontal centre (web <c>cx="70"</c>).</summary>
    public const double FrontWheelCenterX = 70;

    /// <summary>The rear wheel's horizontal centre (web <c>cx="190"</c>).</summary>
    public const double RearWheelCenterX = 190;

    /// <summary>The tyre (outer circle) radius (web <c>r="14"</c>).</summary>
    public const double WheelTyreRadius = 14;

    /// <summary>The hub (inner circle) radius (web <c>r="6"</c>).</summary>
    public const double WheelHubRadius = 6;

    /// <summary>The headlight glow ellipse (web <c>cx=228 cy=55 rx=4 ry=6</c>).</summary>
    public static EllipseSpec Headlight { get; } = new(228, 55, 4, 6);

    /// <summary>The taillight rectangle (web <c>x=28 y=50 w=4 h=12 rx=2</c>).</summary>
    public static RectSpec Taillight { get; } = new(28, 50, 4, 12, 2);

    /// <summary>The ground-shadow ellipse (web <c>cx=130 cy=86 rx=90 ry=4</c>).</summary>
    public static EllipseSpec GroundShadow { get; } = new(130, 86, 90, 4);

    // ── charging-bolt geometry (web 24×24 space) ─────────────────────────────────────────────────────────────

    /// <summary>The charging-bolt path (web <c>d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"</c>).</summary>
    public const string BoltPathData = "M13 2L3 14h9l-1 8 10-12h-9l1-8z";

    // ── battery geometry (web 48×24 space) ───────────────────────────────────────────────────────────────────

    /// <summary>The battery outline rectangle (web <c>x=2 y=4 w=38 h=16 rx=3</c>).</summary>
    public static RectSpec BatteryOutline { get; } = new(2, 4, 38, 16, 3);

    /// <summary>The battery terminal nub (web <c>x=40 y=8 w=4 h=8 rx=1</c>).</summary>
    public static RectSpec BatteryTerminal { get; } = new(40, 8, 4, 8, 1);

    /// <summary>The battery fill rectangle's fixed left edge (web <c>x="4"</c>).</summary>
    public const double BatteryFillX = 4;

    /// <summary>The battery fill rectangle's fixed top edge (web <c>y="6"</c>).</summary>
    public const double BatteryFillY = 6;

    /// <summary>The battery fill rectangle's fixed height (web <c>height="12"</c>).</summary>
    public const double BatteryFillHeight = 12;

    /// <summary>The battery fill rectangle's corner radius (web <c>rx="1.5"</c>).</summary>
    public const double BatteryFillCornerRadius = 1.5;

    /// <summary>The battery-fill threshold (inclusive) at or above which the gauge reads healthy (web <c>level &gt;= 60</c>).</summary>
    public const double BatteryGoodThreshold = 60;

    /// <summary>The battery-fill threshold (inclusive) at or above which the gauge reads warning (web <c>level &gt;= 30</c>).</summary>
    public const double BatteryWarnThreshold = 30;

    /// <summary>Healthy fill colour (web <c>COLOR.GOOD</c>).</summary>
    public const string BatteryGoodHex = "#10B981";

    /// <summary>Warning fill colour (web <c>COLOR.WARN</c>).</summary>
    public const string BatteryWarnHex = "#F59E0B";

    /// <summary>Critical fill colour (web <c>COLOR.BAD</c>).</summary>
    public const string BatteryCriticalHex = "#EF4444";

    // ── wheel-spin geometry (web 24×24 space) ────────────────────────────────────────────────────────────────

    /// <summary>The wheel's shared centre (web <c>cx=cy=12</c>).</summary>
    public const double WheelSpinCenter = 12;

    /// <summary>The wheel tyre (outer circle) radius (web <c>r="10"</c>).</summary>
    public const double WheelSpinTyreRadius = 10;

    /// <summary>The wheel hub (inner circle) radius (web <c>r="4"</c>).</summary>
    public const double WheelSpinHubRadius = 4;

    /// <summary>A spoke's inner end (web <c>y1="5"</c>).</summary>
    public const double WheelSpinSpokeInner = 5;

    /// <summary>A spoke's outer end (web <c>y2="8"</c>).</summary>
    public const double WheelSpinSpokeOuter = 8;

    /// <summary>The five spoke rotation angles in degrees (web <c>[0, 72, 144, 216, 288]</c>).</summary>
    public static IReadOnlyList<double> WheelSpinSpokeAngles { get; } = new double[] { 0, 72, 144, 216, 288 };

    // ── taillight (a semantic literal red in the web source, not a theme token) ──────────────────────────────

    /// <summary>The taillight colour (web literal <c>#ef4444</c>, intentionally not theme-derived).</summary>
    public const string TaillightHex = "#EF4444";

    // ── stroke widths & opacities (web inline props) ─────────────────────────────────────────────────────────

    /// <summary>Car-body stroke width (web <c>strokeWidth="1.5"</c>).</summary>
    public const double BodyStrokeWidth = 1.5;

    /// <summary>Windshield stroke width (web <c>strokeWidth="0.8"</c>).</summary>
    public const double WindshieldStrokeWidth = 0.8;

    /// <summary>Windshield fill opacity (web <c>fillOpacity={0.15}</c>).</summary>
    public const double WindshieldFillOpacity = 0.15;

    /// <summary>Windshield stroke opacity (web <c>strokeOpacity={0.5}</c>).</summary>
    public const double WindshieldStrokeOpacity = 0.5;

    /// <summary>Rear-window stroke width (web <c>strokeWidth="0.6"</c>).</summary>
    public const double RearWindowStrokeWidth = 0.6;

    /// <summary>Rear-window fill opacity (web <c>fillOpacity={0.1}</c>).</summary>
    public const double RearWindowFillOpacity = 0.1;

    /// <summary>Rear-window stroke opacity (web <c>strokeOpacity={0.3}</c>).</summary>
    public const double RearWindowStrokeOpacity = 0.3;

    /// <summary>Wheel-tyre stroke width (web <c>strokeWidth="2"</c>).</summary>
    public const double WheelTyreStrokeWidth = 2;

    /// <summary>Wheel-hub stroke width (web <c>strokeWidth="1"</c>).</summary>
    public const double WheelHubStrokeWidth = 1;

    /// <summary>Headlight glow opacity at rest / peak (web <c>fillOpacity={0.8}</c>).</summary>
    public const double HeadlightOpacity = 0.8;

    /// <summary>Taillight opacity at rest / peak (web <c>fillOpacity={0.7}</c>).</summary>
    public const double TaillightOpacity = 0.7;

    /// <summary>Ground-shadow opacity (web <c>fillOpacity={0.15}</c>).</summary>
    public const double GroundShadowOpacity = 0.15;

    /// <summary>Charging-bolt stroke width (web <c>strokeWidth="1.5"</c>).</summary>
    public const double BoltStrokeWidth = 1.5;

    /// <summary>Charging-bolt fill opacity at rest (web <c>fillOpacity={0.2}</c>).</summary>
    public const double BoltFillOpacity = 0.2;

    /// <summary>Battery outline stroke width (web <c>strokeWidth="1.5"</c>).</summary>
    public const double BatteryOutlineStrokeWidth = 1.5;

    /// <summary>Battery terminal fill opacity (web <c>fillOpacity={0.4}</c>).</summary>
    public const double BatteryTerminalOpacity = 0.4;

    /// <summary>Wheel-spin tyre stroke width (web <c>strokeWidth="1.5"</c>).</summary>
    public const double WheelSpinTyreStrokeWidth = 1.5;

    /// <summary>Wheel-spin hub stroke width (web <c>strokeWidth="1"</c>).</summary>
    public const double WheelSpinHubStrokeWidth = 1;

    /// <summary>Wheel-spin spoke stroke width (web <c>strokeWidth="1.5"</c>).</summary>
    public const double WheelSpinSpokeStrokeWidth = 1.5;

    // ── animation timeline (web framer-motion transition values, in milliseconds) ────────────────────────────

    /// <summary>Car-body draw-in duration (web <c>duration: 1.5</c>).</summary>
    public const int BodyDrawDurationMs = 1500;

    /// <summary>Windshield fade-in delay / duration (web <c>delay: 0.8, duration: 0.6</c>).</summary>
    public const int WindshieldDelayMs = 800;

    /// <summary>Windshield fade-in duration (web <c>duration: 0.6</c>).</summary>
    public const int WindshieldDurationMs = 600;

    /// <summary>Rear-window fade-in delay (web <c>delay: 1</c>).</summary>
    public const int RearWindowDelayMs = 1000;

    /// <summary>Rear-window fade-in duration (web <c>duration: 0.5</c>).</summary>
    public const int RearWindowDurationMs = 500;

    /// <summary>Front-wheel tyre pop-in delay (web <c>delay: 0.3</c>).</summary>
    public const int FrontTyreDelayMs = 300;

    /// <summary>Front-wheel hub pop-in delay (web <c>delay: 0.5</c>).</summary>
    public const int FrontHubDelayMs = 500;

    /// <summary>Rear-wheel tyre pop-in delay (web <c>delay: 0.4</c>).</summary>
    public const int RearTyreDelayMs = 400;

    /// <summary>Rear-wheel hub pop-in delay (web <c>delay: 0.6</c>).</summary>
    public const int RearHubDelayMs = 600;

    /// <summary>Wheel pop-in duration (the native stand-in for the web <c>type: 'spring'</c> pop).</summary>
    public const int WheelPopDurationMs = 400;

    /// <summary>Headlight pulse delay (web <c>delay: 1.2</c>).</summary>
    public const int HeadlightPulseDelayMs = 1200;

    /// <summary>Headlight / taillight pulse cycle length (web <c>duration: 2</c>).</summary>
    public const int LightPulseDurationMs = 2000;

    /// <summary>Taillight pulse delay (web <c>delay: 1.4</c>).</summary>
    public const int TaillightPulseDelayMs = 1400;

    /// <summary>Ground-shadow grow delay (web <c>delay: 0.5</c>).</summary>
    public const int GroundShadowDelayMs = 500;

    /// <summary>Ground-shadow grow duration (web <c>duration: 0.8</c>).</summary>
    public const int GroundShadowDurationMs = 800;

    /// <summary>Charging-bolt entry duration (web <c>duration: 0.5</c>).</summary>
    public const int BoltEntryDurationMs = 500;

    /// <summary>Charging-bolt entry rise (web <c>y: -4</c>).</summary>
    public const double BoltEntryRise = -4;

    /// <summary>Charging-bolt pulse cycle length (web <c>duration: 1.5</c>).</summary>
    public const int BoltPulseDurationMs = 1500;

    /// <summary>Battery entry duration (web <c>duration: 0.4</c>).</summary>
    public const int BatteryEntryDurationMs = 400;

    /// <summary>Battery fill grow delay (web <c>delay: 0.3</c>).</summary>
    public const int BatteryFillDelayMs = 300;

    /// <summary>Battery fill grow duration (web <c>duration: 1.2</c>).</summary>
    public const int BatteryFillDurationMs = 1200;

    /// <summary>Wheel-spin full revolution duration (web <c>duration: 2</c>).</summary>
    public const int WheelSpinDurationMs = 2000;

    /// <summary>Headlight pulse opacity keyframes (web <c>opacity: [0, 0.8, 0.4, 0.8]</c>).</summary>
    public static IReadOnlyList<double> HeadlightPulse { get; } = new double[] { 0, 0.8, 0.4, 0.8 };

    /// <summary>Taillight pulse opacity keyframes (web <c>opacity: [0, 0.7, 0.3, 0.7]</c>).</summary>
    public static IReadOnlyList<double> TaillightPulse { get; } = new double[] { 0, 0.7, 0.3, 0.7 };

    /// <summary>Charging-bolt pulse fill-opacity keyframes (web <c>fillOpacity: [0.1, 0.3, 0.1]</c>).</summary>
    public static IReadOnlyList<double> BoltPulse { get; } = new double[] { 0.1, 0.3, 0.1 };

    /// <summary>Resolve the silhouette label (web <c>'Tesla vehicle illustration'</c>) through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveTeslaLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TeslaLabelKey, TeslaLabelFallback);
    }

    /// <summary>Resolve the charging-bolt label (web <c>'Charging'</c>) through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveChargingLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ChargingLabelKey, ChargingLabelFallback);
    }

    /// <summary>Resolve the spinning-wheel label (web <c>'Loading'</c>) through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveLoadingLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LoadingLabelKey, LoadingLabelFallback);
    }

    /// <summary>
    /// Classify a battery level into its fill band (web ternary
    /// <c>level &gt;= 60 ? GOOD : level &gt;= 30 ? WARN : BAD</c>). The raw, unclamped level is used so the band
    /// matches the web exactly for out-of-range inputs.
    /// </summary>
    /// <param name="level">The battery level percentage.</param>
    public static BatteryFillBand ClassifyBattery(double level) =>
        level >= BatteryGoodThreshold ? BatteryFillBand.Good
        : level >= BatteryWarnThreshold ? BatteryFillBand.Warning
        : BatteryFillBand.Critical;

    /// <summary>Resolve the fill colour hex for a battery <paramref name="band"/>.</summary>
    /// <param name="band">The classified fill band.</param>
    public static string ResolveBatteryColorHex(BatteryFillBand band) => band switch
    {
        BatteryFillBand.Good => BatteryGoodHex,
        BatteryFillBand.Warning => BatteryWarnHex,
        _ => BatteryCriticalHex,
    };
}

/// <summary>An axis-aligned ellipse in a viewBox space (centre + radii). UI-free so geometry is unit-testable.</summary>
/// <param name="CenterX">The horizontal centre.</param>
/// <param name="CenterY">The vertical centre.</param>
/// <param name="RadiusX">The horizontal radius.</param>
/// <param name="RadiusY">The vertical radius.</param>
public readonly record struct EllipseSpec(double CenterX, double CenterY, double RadiusX, double RadiusY);

/// <summary>A rounded rectangle in a viewBox space. UI-free so geometry is unit-testable.</summary>
/// <param name="X">The left edge.</param>
/// <param name="Y">The top edge.</param>
/// <param name="Width">The width.</param>
/// <param name="Height">The height.</param>
/// <param name="CornerRadius">The corner radius.</param>
public readonly record struct RectSpec(double X, double Y, double Width, double Height, double CornerRadius);

/// <summary>The battery gauge's three fill bands — the native analogue of the web <c>COLOR.GOOD/WARN/BAD</c> ternary.</summary>
public enum BatteryFillBand
{
    /// <summary>web <c>COLOR.BAD</c> — below the warning threshold.</summary>
    Critical,

    /// <summary>web <c>COLOR.WARN</c> — at or above the warning threshold, below healthy.</summary>
    Warning,

    /// <summary>web <c>COLOR.GOOD</c> — at or above the healthy threshold.</summary>
    Good,
}

/// <summary>
/// Pure projection of the <see cref="CarAnimation"/> silhouette's render inputs — the native port of the web
/// component body (the <c>w</c>/<c>h</c> sizing, the reduced-motion short-circuit and the resolved
/// <c>aria-label</c>). Static and side-effect-free so the adapter is unit-testable without a view-model or a UI
/// thread; the view-model and the WinUI view both render from it.
/// </summary>
public readonly record struct CarAnimationProjection
{
    private CarAnimationProjection(double width, double height, bool animate, string accessibleName)
    {
        Width = width;
        Height = height;
        Animate = animate;
        AccessibleName = accessibleName;
        Role = CarAnimationRegistration.ImageRole;
    }

    /// <summary>The rendered width in pixels (web <c>w = size</c>).</summary>
    public double Width { get; }

    /// <summary>The rendered height in pixels (web <c>h = size * 0.4</c>).</summary>
    public double Height { get; }

    /// <summary>
    /// Whether the illustration animates (body draw-in, wheel pop-in, light pulse, shadow grow). False under
    /// reduced motion, where every element renders in its final state (web <c>reduce ? false : …</c>).
    /// </summary>
    public bool Animate { get; }

    /// <summary>The accessible name (web <c>aria-label={t('carAnimation.tesla', …)}</c>).</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA role the surface exposes (always <see cref="CarAnimationRegistration.ImageRole"/>).</summary>
    public string Role { get; }

    /// <summary>Project the silhouette's render inputs, reproducing the web component body.</summary>
    /// <param name="size">The requested width (web <c>size</c>; defaults to 120).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>useMotionPreference</c>).</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static CarAnimationProjection Project(double size, bool reduceMotion, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        double width = Math.Max(0, size);
        return new CarAnimationProjection(
            width,
            width * CarAnimationRegistration.CarHeightRatio,
            animate: !reduceMotion,
            accessibleName: CarAnimationRegistration.ResolveTeslaLabel(localizer));
    }
}

/// <summary>
/// Pure projection of the <see cref="ChargingBolt"/> render inputs — the native port of the web component body
/// (the square sizing, the reduced-motion short-circuit on the entry + pulse, and the resolved
/// <c>aria-label</c>). UI-free and side-effect-free.
/// </summary>
public readonly record struct ChargingBoltProjection
{
    private ChargingBoltProjection(double size, bool animate, string accessibleName)
    {
        Size = size;
        Animate = animate;
        AccessibleName = accessibleName;
        Role = CarAnimationRegistration.ImageRole;
    }

    /// <summary>The rendered square side in pixels (web <c>size</c>).</summary>
    public double Size { get; }

    /// <summary>
    /// Whether the bolt animates (entry slide-in + the pulsing fill loop). False under reduced motion, where the
    /// bolt renders statically at its rest fill opacity (web <c>reduce ? false : …</c> / <c>{ fillOpacity: 0.2 }</c>).
    /// </summary>
    public bool Animate { get; }

    /// <summary>The accessible name (web <c>aria-label={t('carAnimation.charging', …)}</c>).</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA role the surface exposes (always <see cref="CarAnimationRegistration.ImageRole"/>).</summary>
    public string Role { get; }

    /// <summary>Project the charging-bolt's render inputs, reproducing the web component body.</summary>
    /// <param name="size">The requested size (web <c>size</c>; defaults to 32).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>useMotionPreference</c>).</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static ChargingBoltProjection Project(double size, bool reduceMotion, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new ChargingBoltProjection(
            Math.Max(0, size),
            animate: !reduceMotion,
            accessibleName: CarAnimationRegistration.ResolveChargingLabel(localizer));
    }
}

/// <summary>
/// Pure projection of the <see cref="BatteryFillAnimation"/> render inputs — the native port of the web
/// component body (the <c>barWidth</c> / <c>fillWidth</c> arithmetic, the colour ternary and the reduced-motion
/// short-circuit on the fill grow). The gauge is decorative in the web source (no role / label), so this carries
/// no accessible name. UI-free and side-effect-free.
/// </summary>
public readonly record struct BatteryFillProjection
{
    private BatteryFillProjection(double size, double width, double height, double fillWidth, BatteryFillBand band, string fillColorHex, bool animate)
    {
        Size = size;
        Width = width;
        Height = height;
        FillWidth = fillWidth;
        Band = band;
        FillColorHex = fillColorHex;
        Animate = animate;
    }

    /// <summary>The requested gauge size (web <c>size</c>).</summary>
    public double Size { get; }

    /// <summary>The rendered width in pixels (web <c>width={size}</c>).</summary>
    public double Width { get; }

    /// <summary>The rendered height in pixels (web <c>height={size * 0.5}</c>).</summary>
    public double Height { get; }

    /// <summary>
    /// The fill rectangle's target width in the 48×24 viewBox space — the web
    /// <c>fillWidth * (38 / (48 * 0.6 - 4))</c> where <c>fillWidth = (size * 0.6 - 4) * min(level, 100) / 100</c>.
    /// Clamped to a non-negative value (a Rectangle width cannot be negative); for the default 48px gauge this is
    /// simply <c>38 * clamp(level, 0, 100) / 100</c>.
    /// </summary>
    public double FillWidth { get; }

    /// <summary>The classified fill band (web <c>COLOR.GOOD/WARN/BAD</c> ternary).</summary>
    public BatteryFillBand Band { get; }

    /// <summary>The fill colour hex for <see cref="Band"/>.</summary>
    public string FillColorHex { get; }

    /// <summary>
    /// Whether the gauge animates (entry fade + the fill grow). False under reduced motion, where the fill jumps
    /// straight to <see cref="FillWidth"/> (web <c>reduce ? false : …</c>).
    /// </summary>
    public bool Animate { get; }

    /// <summary>Project the gauge's render inputs, reproducing the web component body.</summary>
    /// <param name="level">The battery level percentage (web <c>level</c>; defaults to 80).</param>
    /// <param name="size">The requested size (web <c>size</c>; defaults to 48).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>useMotionPreference</c>).</param>
    public static BatteryFillProjection Project(double level, double size, bool reduceMotion)
    {
        double renderSize = Math.Max(0, size);

        // web: barWidth = size*0.6; fillWidth = (barWidth-4) * min(level,100)/100; rectWidth = fillWidth * 38/(48*0.6-4).
        double clampedLevel = Math.Clamp(level, 0, 100);
        double barWidth = renderSize * 0.6;
        double fillWidth = (barWidth - 4) * clampedLevel / 100;
        double scale = 38.0 / ((CarAnimationRegistration.BatteryViewBoxWidth * 0.6) - 4);
        double rectWidth = Math.Max(0, fillWidth * scale);

        BatteryFillBand band = CarAnimationRegistration.ClassifyBattery(level);

        return new BatteryFillProjection(
            renderSize,
            renderSize,
            renderSize * CarAnimationRegistration.BatteryHeightRatio,
            rectWidth,
            band,
            CarAnimationRegistration.ResolveBatteryColorHex(band),
            animate: !reduceMotion);
    }
}

/// <summary>
/// Pure projection of the <see cref="WheelSpin"/> render inputs — the native port of the web component body (the
/// square sizing, the reduced-motion short-circuit on the continuous spin, and the resolved <c>aria-label</c>).
/// UI-free and side-effect-free.
/// </summary>
public readonly record struct WheelSpinProjection
{
    private WheelSpinProjection(double size, bool animate, string accessibleName)
    {
        Size = size;
        Animate = animate;
        AccessibleName = accessibleName;
        Role = CarAnimationRegistration.ImageRole;
    }

    /// <summary>The rendered square side in pixels (web <c>size</c>).</summary>
    public double Size { get; }

    /// <summary>
    /// Whether the wheel spins. False under reduced motion, where the wheel renders static (web
    /// <c>reduce ? { rotate: 0 } : { rotate: 360 }</c>).
    /// </summary>
    public bool Animate { get; }

    /// <summary>The accessible name (web <c>aria-label={t('carAnimation.loading', …)}</c>).</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA role the surface exposes (always <see cref="CarAnimationRegistration.ImageRole"/>).</summary>
    public string Role { get; }

    /// <summary>Project the wheel's render inputs, reproducing the web component body.</summary>
    /// <param name="size">The requested size (web <c>size</c>; defaults to 24).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>useMotionPreference</c>).</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static WheelSpinProjection Project(double size, bool reduceMotion, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new WheelSpinProjection(
            Math.Max(0, size),
            animate: !reduceMotion,
            accessibleName: CarAnimationRegistration.ResolveLoadingLabel(localizer));
    }
}

/// <summary>
/// PII-safe diagnostics for the CarAnimation surface (P1/S11 diagnostics contract). The illustrations carry no
/// user content (only static, caller-supplied sizes / levels), so the collector records only the operational
/// <c>view.opened</c> event with the surface slug. Thread-safe; mirrors the peer surfaces' collectors.
/// </summary>
public sealed class CarAnimationDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public CarAnimationDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CarAnimation</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CarAnimationRegistration.Slug}");
    }
}
