using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the Spinner surface — the native analogue of the module-level constants in
/// <c>web/src/components/feedback/Spinner.tsx</c>. The web component is a pure presentational loading mark: a
/// lightning bolt that draws itself like a strike, fills to solid, holds, then fades and redraws, with a
/// cyan/emerald electrical glow that tracks the active theme (<c>--theme-primary</c> / <c>--theme-accent</c>).
/// It reads no network data and renders no titles of its own, so this carries the diagnostics slug, the
/// automation id, the ARIA role/live contract (web <c>role="status"</c>), the single i18n key behind the default
/// <c>aria-label</c> (web <c>label ?? 'Loading'</c>), the bolt geometry + its measured path length, the size map
/// (web <c>sizeMap</c>), the glow colours, and the self-drawing animation timeline (web <c>@keyframes boltDraw</c>).
/// UI-free so every value is asserted headlessly.
/// </summary>
public static class SpinnerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Spinner";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c>
    /// (it is an anonymous status wrapper), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "spinner";

    /// <summary>ARIA role the surface exposes — a read-only status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the surface declares — a status region is polite.</summary>
    public const string LiveSetting = "polite";

    /// <summary>
    /// i18n key behind the default accessible label (web <c>aria-label={label ?? 'Loading'}</c>). The fallback is
    /// the web literal verbatim; the key already exists in the P1/S10 catalogue under <c>translation.global.loading</c>.
    /// </summary>
    public const string DefaultLabelKey = "translation.global.loading";

    /// <summary>English fallback for <see cref="DefaultLabelKey"/> — the web default <c>'Loading'</c>, verbatim.</summary>
    public const string DefaultLabelFallback = "Loading";

    /// <summary>The SVG path of the bolt mark (web <c>d="M112 30L62 108h34L78 170l58-82h-34z"</c>), for reference.</summary>
    public const string BoltPathData = "M112 30L62 108h34L78 170l58-82h-34z";

    /// <summary>The side of the square coordinate space the bolt is authored in (web <c>viewBox 0 0 200 200</c>).</summary>
    public const double ViewBoxSize = 200;

    /// <summary>The default tween cycle length (web <c>animation: boltDraw 2s …</c>).</summary>
    public const int DrawDurationMs = 2000;

    /// <summary>Cyan glow colour — the web <c>--theme-primary</c> drop-shadow default (<c>#22d3ee</c>).</summary>
    public const string GlowPrimaryHex = "#22D3EE";

    /// <summary>Emerald glow colour — the web <c>--theme-accent</c> drop-shadow default (<c>#10b981</c>).</summary>
    public const string GlowAccentHex = "#10B981";

    /// <summary>
    /// The bolt outline as absolute vertices in the 200×200 space (the web relative path resolved to points:
    /// M112 30 → L62 108 → h34 → L78 170 → l58 -82 → h-34 → close). The view builds a closed, filled
    /// <c>PathGeometry</c> from these and the draw maths read <see cref="BoltPathLength"/> from them.
    /// </summary>
    public static IReadOnlyList<BoltPoint> BoltVertices { get; } = new[]
    {
        new BoltPoint(112, 30),
        new BoltPoint(62, 108),
        new BoltPoint(96, 108),
        new BoltPoint(78, 170),
        new BoltPoint(136, 88),
        new BoltPoint(102, 88),
    };

    /// <summary>
    /// The closed perimeter of the bolt in the 200×200 space (~384.5 units). This is the native analogue of the
    /// web <c>pathLength={100}</c> normalisation: the stroke dash that "draws" the bolt spans exactly this length,
    /// so the view sets the dash array to <c>BoltPathLength / strokeWidth</c> (dash units are multiples of the
    /// stroke thickness) and animates the offset across it.
    /// </summary>
    public static double BoltPathLength { get; } = MeasureClosedPerimeter(BoltVertices);

    /// <summary>
    /// The self-drawing timeline — the native port of the web <c>@keyframes boltDraw</c> (web/src/index.css).
    /// Each frame carries the normalised dash progress (1 = undrawn start, 0 = fully drawn, -1 = drawn off the
    /// far end), the fill opacity (web <c>fill-opacity</c>) and the overall opacity (web <c>opacity</c>). The view
    /// scales the dash progress by <c>BoltPathLength / strokeWidth</c> to get the platform stroke-dash offset.
    /// </summary>
    public static IReadOnlyList<SpinnerKeyframe> DrawKeyframes { get; } = new[]
    {
        new SpinnerKeyframe(0.00, DashProgress: 1, FillOpacity: 0, Opacity: 0.15),
        new SpinnerKeyframe(0.30, DashProgress: 0, FillOpacity: 0, Opacity: 1.00),
        new SpinnerKeyframe(0.55, DashProgress: 0, FillOpacity: 1, Opacity: 1.00),
        new SpinnerKeyframe(0.80, DashProgress: 0, FillOpacity: 1, Opacity: 0.90),
        new SpinnerKeyframe(1.00, DashProgress: -1, FillOpacity: 0, Opacity: 0.00),
    };

    /// <summary>
    /// Resolve a size to its rendered pixel box and stroke width — the native port of the web <c>sizeMap</c>
    /// (sm 24px/stroke 22, md 48px/stroke 14, lg 80px/stroke 10). The stroke width is expressed in the 200×200
    /// authoring space (the web <c>strokeWidth</c>), so the view scales it down with the bolt.
    /// </summary>
    /// <param name="size">The requested size (web <c>size</c> prop).</param>
    public static SpinnerMetrics Resolve(SpinnerSize size) => size switch
    {
        SpinnerSize.Small => new SpinnerMetrics(24, 22),
        SpinnerSize.Large => new SpinnerMetrics(80, 10),
        _ => new SpinnerMetrics(48, 14),
    };

    /// <summary>Resolve the default accessible label (web <c>'Loading'</c>) through the i18n facade.</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveDefaultLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DefaultLabelKey, DefaultLabelFallback);
    }

    private static double MeasureClosedPerimeter(IReadOnlyList<BoltPoint> vertices)
    {
        double total = 0;
        for (var i = 0; i < vertices.Count; i++)
        {
            BoltPoint a = vertices[i];
            BoltPoint b = vertices[(i + 1) % vertices.Count];
            double dx = b.X - a.X;
            double dy = b.Y - a.Y;
            total += Math.Sqrt((dx * dx) + (dy * dy));
        }

        return total;
    }
}

/// <summary>
/// A vertex of the bolt outline in the 200×200 authoring space. Kept UI-free (no <c>Windows.Foundation.Point</c>)
/// so the geometry maths and the perimeter are unit-testable without a XAML runtime.
/// </summary>
/// <param name="X">The horizontal coordinate (0..200).</param>
/// <param name="Y">The vertical coordinate (0..200).</param>
public readonly record struct BoltPoint(double X, double Y);

/// <summary>
/// One frame of the bolt's self-drawing animation — the native port of a <c>@keyframes boltDraw</c> stop.
/// Pure data so the timeline is asserted without building a Storyboard.
/// </summary>
/// <param name="Time">The normalised time of the frame (0..1 across the cycle).</param>
/// <param name="DashProgress">Normalised stroke-dash offset (1 undrawn, 0 drawn, -1 drawn off the far end).</param>
/// <param name="FillOpacity">The bolt fill opacity at this frame (web <c>fill-opacity</c>).</param>
/// <param name="Opacity">The overall mark opacity at this frame (web <c>opacity</c>).</param>
public readonly record struct SpinnerKeyframe(double Time, double DashProgress, double FillOpacity, double Opacity);

/// <summary>The rendered geometry of a spinner size — pixel box and (200-space) stroke width.</summary>
/// <param name="Pixels">The rendered side of the square bolt box in device-independent pixels (web <c>pixels</c>).</param>
/// <param name="StrokeWidth">The bolt stroke width in the 200×200 authoring space (web <c>stroke</c>).</param>
public readonly record struct SpinnerMetrics(int Pixels, double StrokeWidth);

/// <summary>
/// The size variants of the loading mark — the native analogue of the web <c>size</c> prop (<c>'sm' | 'md' | 'lg'</c>).
/// </summary>
public enum SpinnerSize
{
    /// <summary>web <c>'sm'</c> — 24px box, 22-unit stroke.</summary>
    Small,

    /// <summary>web <c>'md'</c> — 48px box, 14-unit stroke. The default.</summary>
    Medium,

    /// <summary>web <c>'lg'</c> — 80px box, 10-unit stroke.</summary>
    Large,
}

/// <summary>
/// Pure projection of the spinner's render inputs — the native port of the web component body
/// (web/src/components/feedback/Spinner.tsx). It resolves the <see cref="Size"/> to its
/// <see cref="Pixels"/> / <see cref="StrokeWidth"/>, decides whether the bolt draws itself (<see cref="Animate"/>
/// is false under reduced motion, where the web renders the bolt fully filled with no draw cycle), captures the
/// reduced-motion static render values (<see cref="FillOpacity"/> = web <c>fillOpacity={reduce?1:0}</c>,
/// <see cref="StrokeDashed"/> = web <c>strokeDasharray={reduce?'none':100}</c>,
/// <see cref="InitialDashProgress"/> = web <c>strokeDashoffset={reduce?0:100}</c> normalised), exposes the
/// optional visible <see cref="Label"/> (web <c>{label &amp;&amp; …}</c>) and the <see cref="AccessibleName"/>
/// (web <c>aria-label={label ?? 'Loading'}</c>, the default resolved through i18n). Kept static and
/// side-effect-free so the adapter is unit-testable without a view-model or a UI thread.
/// </summary>
public readonly record struct SpinnerProjection
{
    private SpinnerProjection(
        SpinnerSize size,
        int pixels,
        double strokeWidth,
        bool animate,
        bool hasLabel,
        string label,
        string accessibleName,
        double fillOpacity,
        bool strokeDashed,
        double initialDashProgress)
    {
        Size = size;
        Pixels = pixels;
        StrokeWidth = strokeWidth;
        Animate = animate;
        HasLabel = hasLabel;
        Label = label;
        AccessibleName = accessibleName;
        FillOpacity = fillOpacity;
        StrokeDashed = strokeDashed;
        InitialDashProgress = initialDashProgress;
    }

    /// <summary>The requested size (web <c>size</c> prop; defaults to <see cref="SpinnerSize.Medium"/>).</summary>
    public SpinnerSize Size { get; }

    /// <summary>The rendered side of the square bolt box in pixels (web <c>pixels</c>).</summary>
    public int Pixels { get; }

    /// <summary>The bolt stroke width in the 200×200 authoring space (web <c>stroke</c>).</summary>
    public double StrokeWidth { get; }

    /// <summary>
    /// Whether the bolt draws itself. False under reduced motion, where the bolt snaps to a solid filled mark
    /// (web: <c>prefers-reduced-motion</c> renders <c>fillOpacity=1</c>, no dash, no draw cycle).
    /// </summary>
    public bool Animate { get; }

    /// <summary>Whether a visible caption is shown beneath the bolt (web <c>{label &amp;&amp; …}</c>).</summary>
    public bool HasLabel { get; }

    /// <summary>The visible caption text, or empty when none is shown (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>
    /// The accessible name the status region announces (web <c>aria-label={label ?? 'Loading'}</c>): the
    /// caller's label when supplied, otherwise the i18n default ("Loading").
    /// </summary>
    public string AccessibleName { get; }

    /// <summary>The static bolt fill opacity (web <c>fillOpacity={reduce ? 1 : 0}</c>).</summary>
    public double FillOpacity { get; }

    /// <summary>Whether the bolt stroke is dashed for the draw effect (web <c>strokeDasharray={reduce ? 'none' : 100}</c>).</summary>
    public bool StrokeDashed { get; }

    /// <summary>
    /// The normalised starting dash offset (web <c>strokeDashoffset={reduce ? 0 : 100}</c> over a
    /// <c>pathLength</c> of 100): 0 when reduced (fully drawn), 1 when animating (undrawn, about to strike in).
    /// </summary>
    public double InitialDashProgress { get; }

    /// <summary>
    /// Project the render inputs, reproducing the web component body. A null/blank <paramref name="label"/> hides
    /// the visible caption and falls back to the i18n default for the accessible name (the web
    /// <c>label ?? 'Loading'</c> / <c>{label &amp;&amp; …}</c> pair; blank is treated as absent so the status
    /// region always has a meaningful name for Narrator).
    /// </summary>
    /// <param name="size">The requested size (web <c>size</c>).</param>
    /// <param name="label">The caller-supplied caption, or null/blank for none (web <c>label</c>).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>useMotionPreference</c>).</param>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    public static SpinnerProjection Project(SpinnerSize size, string? label, bool reduceMotion, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        SpinnerMetrics metrics = SpinnerRegistration.Resolve(size);
        bool hasLabel = !string.IsNullOrWhiteSpace(label);
        string visibleLabel = hasLabel ? label!.Trim() : string.Empty;
        string accessibleName = hasLabel ? visibleLabel : SpinnerRegistration.ResolveDefaultLabel(localizer);

        return new SpinnerProjection(
            size,
            metrics.Pixels,
            metrics.StrokeWidth,
            animate: !reduceMotion,
            hasLabel: hasLabel,
            label: visibleLabel,
            accessibleName: accessibleName,
            fillOpacity: reduceMotion ? 1.0 : 0.0,
            strokeDashed: !reduceMotion,
            initialDashProgress: reduceMotion ? 0.0 : 1.0);
    }
}

/// <summary>
/// PII-safe diagnostics for the Spinner surface (P1/S11 diagnostics contract). The loading mark carries no user
/// content beyond an optional caller-supplied caption, so the collector records only the operational
/// <c>view.opened</c> event with the surface slug — never the label. Thread-safe; mirrors the peer surfaces'
/// diagnostics collectors.
/// </summary>
public sealed class SpinnerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public SpinnerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Spinner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SpinnerRegistration.Slug}");
    }
}
