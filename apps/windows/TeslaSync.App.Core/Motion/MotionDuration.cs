namespace TeslaSync.App.Core.Motion;

/// <summary>
/// Pure reduced-motion gating (port of the web <c>useMotionPreference</c>). The
/// WinUI motion controls read the OS "show animations" setting and pass it here so
/// the duration/enabled policy stays headless and unit-tested. When reduced motion
/// is requested every animation collapses to a zero-duration no-op and components
/// render straight in their final state.
/// </summary>
public static class MotionDuration
{
    /// <summary>Default entrance/transition duration in milliseconds.</summary>
    public const int DefaultMs = 250;

    /// <summary>
    /// Resolve the effective animation duration. Returns 0 when
    /// <paramref name="reduce"/> is true, otherwise <paramref name="defaultMs"/>.
    /// </summary>
    public static int Resolve(bool reduce, int defaultMs = DefaultMs) =>
        reduce ? 0 : Math.Max(0, defaultMs);

    /// <summary>
    /// Whether an entrance animation should run at all. False under reduced motion
    /// (so callers can set the final state immediately, mirroring framer-motion's
    /// <c>initial={false}</c>).
    /// </summary>
    public static bool ShouldAnimate(bool reduce) => !reduce;

    /// <summary>
    /// Effective per-child stagger delay in milliseconds. Collapses to 0 under
    /// reduced motion (matches the web <c>StaggerContainer</c> 60ms cadence).
    /// </summary>
    public static int StaggerStepMs(bool reduce, int stepMs = 60) =>
        reduce ? 0 : Math.Max(0, stepMs);
}
