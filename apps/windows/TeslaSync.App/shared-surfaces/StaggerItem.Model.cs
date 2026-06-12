namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the StaggerItem surface — the native analogue of the module-level constants in
/// <c>web/src/components/motion/StaggerItem.tsx</c>. The web component is a pure presentational entrance wrapper:
/// a <c>motion.div</c> that animates a single child in from a faded, slightly-below resting position
/// (<c>hidden = { opacity: 0, y: 15 }</c>) up to its final place (<c>show = { opacity: 1, y: 0 }</c>) over the
/// duration returned by <c>useMotionPreference(350)</c>. It reads no network data and renders no titles or labels
/// of its own (the child carries all semantics), so this carries only the diagnostics slug, the automation id,
/// and the geometry/timing constants the source declares (the 350&#160;ms default entrance duration and the
/// 15-pixel rise the hidden variant starts from).
/// </summary>
public static class StaggerItemRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "StaggerItem";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c>
    /// (it is an anonymous <c>motion.div</c> wrapper), so this is the native-only stable hook UI-automation tests
    /// target.
    /// </summary>
    public const string RootAutomationId = "stagger-item";

    /// <summary>
    /// Default entrance duration in milliseconds — the argument the web source passes to
    /// <c>useMotionPreference(350)</c>. Under reduced motion the effective duration collapses to zero.
    /// </summary>
    public const int DefaultDurationMs = 350;

    /// <summary>The vertical offset (in pixels) the child rises from while animating (web <c>y: 15</c>).</summary>
    public const double HiddenOffsetY = 15.0;

    /// <summary>The resting vertical offset the child settles at (web <c>y: 0</c>).</summary>
    public const double ShownOffsetY = 0.0;

    /// <summary>The child's opacity at the start of the entrance while animating (web <c>opacity: 0</c>).</summary>
    public const double HiddenOpacity = 0.0;

    /// <summary>The child's resting opacity (web <c>opacity: 1</c>).</summary>
    public const double ShownOpacity = 1.0;
}

/// <summary>
/// Pure projection of the wrapper's entrance inputs — the native port of the web component body
/// (web/src/components/motion/StaggerItem.tsx). It mirrors <c>useMotionPreference(350)</c> (the effective
/// <see cref="DurationMs"/> collapses to zero under reduced motion) and decides whether a visible entrance runs
/// (<see cref="Animate"/>), exposing the from/to opacity and vertical-offset endpoints the view animates between.
/// The hidden endpoints are tied to <see cref="Animate"/> rather than to the raw reduce-motion flag so that a
/// non-animating wrapper renders straight in its final state with no flash — the same instant-settle behaviour
/// the web variants collapse to under <c>prefers-reduced-motion</c> (where the hidden variant is itself
/// <c>{ opacity: 1, y: 0 }</c>). Kept static and side-effect-free so the adapter is unit-testable without a
/// view-model or a UI thread; the <see cref="StaggerItemViewModel"/> and the WinUI view both render from it.
/// </summary>
public readonly record struct StaggerItemProjection
{
    private StaggerItemProjection(bool animate, int durationMs, double fromOpacity, double fromOffsetY)
    {
        Animate = animate;
        DurationMs = durationMs;
        FromOpacity = fromOpacity;
        FromOffsetY = fromOffsetY;
        ToOpacity = StaggerItemRegistration.ShownOpacity;
        ToOffsetY = StaggerItemRegistration.ShownOffsetY;
    }

    /// <summary>
    /// Whether the entrance animates. False under reduced motion or a non-positive duration, where the wrapper
    /// snaps straight to its final state — the native analogue of the web <c>hidden</c> variant collapsing to
    /// <c>{ opacity: 1, y: 0 }</c> and the <c>show</c> transition reaching its end immediately.
    /// </summary>
    public bool Animate { get; }

    /// <summary>
    /// The effective entrance duration in milliseconds, after the reduce-motion collapse (web
    /// <c>useMotionPreference(350).durationMs</c>, i.e. <c>reduce ? 0 : 350</c>).
    /// </summary>
    public int DurationMs { get; }

    /// <summary>The effective entrance duration in seconds — the web <c>transition.duration</c> (<c>durationMs / 1000</c>).</summary>
    public double DurationSeconds => DurationMs / 1000.0;

    /// <summary>The opacity the entrance starts from (web hidden-variant <c>opacity</c>).</summary>
    public double FromOpacity { get; }

    /// <summary>The vertical offset (pixels) the entrance starts from (web hidden-variant <c>y</c>).</summary>
    public double FromOffsetY { get; }

    /// <summary>The opacity the child settles at (web show-variant <c>opacity: 1</c>).</summary>
    public double ToOpacity { get; }

    /// <summary>The vertical offset the child settles at (web show-variant <c>y: 0</c>).</summary>
    public double ToOffsetY { get; }

    /// <summary>
    /// Project the entrance inputs. <paramref name="defaultDurationMs"/> is clamped to be non-negative and then
    /// collapsed to zero under <paramref name="reduceMotion"/> (mirroring <c>useMotionPreference</c>);
    /// <see cref="Animate"/> is true only when motion is allowed and the effective duration is positive. The
    /// from-endpoints are the 15-pixel/zero-opacity rise when animating, or the final resting state otherwise.
    /// </summary>
    /// <param name="defaultDurationMs">The requested entrance duration in milliseconds (web <c>useMotionPreference</c> argument).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set.</param>
    public static StaggerItemProjection Project(int defaultDurationMs, bool reduceMotion)
    {
        int safeDefault = defaultDurationMs < 0 ? 0 : defaultDurationMs;
        int durationMs = reduceMotion ? 0 : safeDefault;
        bool animate = !reduceMotion && durationMs > 0;

        double fromOpacity = animate ? StaggerItemRegistration.HiddenOpacity : StaggerItemRegistration.ShownOpacity;
        double fromOffsetY = animate ? StaggerItemRegistration.HiddenOffsetY : StaggerItemRegistration.ShownOffsetY;

        return new StaggerItemProjection(animate, durationMs, fromOpacity, fromOffsetY);
    }
}

/// <summary>
/// PII-safe diagnostics for the StaggerItem surface (P1/S11 diagnostics contract). The wrapper carries no user
/// content of its own (it only hosts a caller-supplied child), so the collector records only the operational
/// <c>view.opened</c> event with the surface slug. Thread-safe.
/// </summary>
public sealed class StaggerItemDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public StaggerItemDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StaggerItem</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StaggerItemRegistration.Slug}");
    }
}
