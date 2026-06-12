using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="RouteTransition"/> view — the native port of the web
/// component body (web/src/components/motion/RouteTransition.tsx). The web component reads <c>useLocation()</c>
/// and <c>useMotionPreference(120)</c>, tracks the previous pathname in a ref, and on every render decides whether
/// the page cross-fade should run. This holder reproduces that exactly:
/// <list type="bullet">
/// <item><description>
/// it subscribes to the <see cref="IRouteLocationSource"/> seam (web <c>useLocation</c>) and, on each pathname
/// change, projects the navigation through <see cref="RouteTransitionPlan.Compute"/> and raises
/// <see cref="TransitionRequested"/> so the view plays (or skips) the fade;
/// </description></item>
/// <item><description>
/// the very first mount is NOT a transition — no event is raised until the first real navigation (the web
/// <c>initial={false}</c> / <c>AnimatePresence</c> behaviour that skips the entry animation on cold load);
/// </description></item>
/// <item><description>
/// it re-keys on pathname only — a change that leaves the pathname identical (a query / search / hash change)
/// raises nothing, so filters and anchors never trigger a re-fade (web re-key by <c>location.pathname</c>);
/// </description></item>
/// <item><description>
/// it tracks the reduce-motion flag from the <see cref="IMotionPreferenceSource"/> seam (web
/// <c>useMotionPreference</c>); a runtime toggle updates the flag used by the NEXT navigation but never fires a
/// fade on its own, exactly like the web component which only re-evaluates on a route change.
/// </description></item>
/// </list>
/// Because the surface reads no network data, there is no loading / error / stale / offline branch to model (the
/// web source has none); the only outcomes are an animated navigation, an instant (reduced-motion or list↔detail)
/// navigation, and the no-op mount / same-pathname render. The view performs no navigation, timing or I/O itself —
/// it observes <see cref="TransitionRequested"/> and animates its content host. Drive it from one confinement (the
/// UI thread); it is not internally synchronised. <see cref="Dispose"/> unsubscribes from both seams (the web
/// effect cleanup).
/// </summary>
public sealed class RouteTransitionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IRouteLocationSource _location;
    private readonly IDisposable _motionSubscription;
    private readonly RouteTransitionDiagnostics _diagnostics;
    private readonly int _durationMs;
    private readonly double _offsetY;
    private readonly IReadOnlyList<string> _skipPatterns;

    private bool _reduceMotion;
    private string _previousPath;
    private string _currentPathKey;
    private RouteTransitionPlan _currentPlan;
    private bool _hasNavigated;
    private bool _started;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over the location + reduce-motion seams (P1/S8), with optional fade duration, skip
    /// patterns, translate offset and diagnostics. The reduce-motion source is observed immediately so the flag
    /// the first navigation reads is current; the location seam is subscribed by <see cref="Start"/>.
    /// </summary>
    /// <param name="location">The current-location port (web <c>useLocation</c> seam).</param>
    /// <param name="motion">The reduce-motion preference source (web <c>useMotionPreference</c> seam).</param>
    /// <param name="durationMs">The fade duration in milliseconds (web <c>useMotionPreference(120)</c>).</param>
    /// <param name="skipPatterns">The list↔detail patterns whose navigations are not animated; null uses <see cref="RouteTransitionRegistration.DefaultSkipPatterns"/>.</param>
    /// <param name="offsetY">The vertical translate magnitude in pixels (web <c>y: 4</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the surface counters.</param>
    public RouteTransitionViewModel(
        IRouteLocationSource location,
        IMotionPreferenceSource motion,
        int durationMs = RouteTransitionRegistration.DefaultDurationMs,
        IReadOnlyList<string>? skipPatterns = null,
        double offsetY = RouteTransitionRegistration.DefaultOffsetY,
        RouteTransitionDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(location);
        ArgumentNullException.ThrowIfNull(motion);

        _location = location;
        _durationMs = durationMs;
        _offsetY = offsetY;
        _skipPatterns = skipPatterns ?? RouteTransitionRegistration.DefaultSkipPatterns;
        _diagnostics = diagnostics ?? new RouteTransitionDiagnostics();

        // The mount establishes the baseline pathname WITHOUT animating (web initial={false}); the first real
        // navigation away from it is the first thing this surface fades.
        _previousPath = location.Path;
        _currentPathKey = location.Path;
        _reduceMotion = motion.ReduceMotion;
        _motionSubscription = motion.Observe(OnReduceMotionChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised on every pathname change (web re-key on <c>location.pathname</c>) with the projected plan. The view
    /// plays the cross-fade when <see cref="RouteTransitionPlan.Animate"/> is set, or snaps to the settled state
    /// otherwise. Never raised on mount or on a query/hash-only change.
    /// </summary>
    public event EventHandler<RouteTransitionPlan>? TransitionRequested;

    /// <summary>The canonical surface slug (<c>RouteTransition</c>).</summary>
    public static string Slug => RouteTransitionRegistration.Slug;

    /// <summary>The plan for the most recent navigation; the struct default (no-op) until the first navigation.</summary>
    public RouteTransitionPlan CurrentPlan => _currentPlan;

    /// <summary>The current location pathname the content is keyed by (web <c>location.pathname</c>).</summary>
    public string CurrentPathKey => _currentPathKey;

    /// <summary>Whether the user currently prefers reduced motion (web <c>reduce</c>).</summary>
    public bool ReduceMotion => _reduceMotion;

    /// <summary>True once at least one real navigation (a pathname change) has occurred since mount.</summary>
    public bool HasNavigated => _hasNavigated;

    /// <summary>The configured fade duration in milliseconds.</summary>
    public int DurationMs => _durationMs;

    /// <summary>The configured vertical translate magnitude in pixels.</summary>
    public double OffsetY => _offsetY;

    /// <summary>The effective list↔detail skip patterns (web <c>skipPattern</c>).</summary>
    public IReadOnlyList<string> SkipPatterns => _skipPatterns;

    /// <summary>
    /// Begin responding to route changes (web component mount): emit the <c>view.opened</c> diagnostic and
    /// subscribe to the location seam. The mount itself is not animated (web <c>initial={false}</c>). Idempotent —
    /// a second call is a no-op.
    /// </summary>
    public void Start()
    {
        if (_started || _disposed)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _location.Changed += OnLocationChanged;
    }

    /// <summary>Stop responding, detach from both seams (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_started)
        {
            _location.Changed -= OnLocationChanged;
        }

        _motionSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnLocationChanged(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        string newPath = _location.Path;

        // web re-keys by pathname only: a change that leaves the pathname identical (query / search / hash) must
        // never re-fade, so there is nothing to do.
        if (string.Equals(newPath, _previousPath, StringComparison.Ordinal))
        {
            return;
        }

        RouteTransitionPlan plan = RouteTransitionPlan.Compute(
            _previousPath,
            newPath,
            _reduceMotion,
            _durationMs,
            _skipPatterns,
            _offsetY);

        // Track the previous path AFTER computing the plan so a back-navigation's skip check sees the correct
        // prev (web updates prevPathRef.current after reading it).
        _previousPath = newPath;
        _currentPathKey = newPath;
        _currentPlan = plan;
        _hasNavigated = true;

        Raise(nameof(CurrentPathKey));
        Raise(nameof(CurrentPlan));
        Raise(nameof(HasNavigated));

        TransitionRequested?.Invoke(this, plan);

        if (plan.Animate)
        {
            _diagnostics.RecordAnimated();
        }
        else
        {
            _diagnostics.RecordSkipped();
        }
    }

    private void OnReduceMotionChanged(bool reduceMotion)
    {
        if (_disposed || _reduceMotion == reduceMotion)
        {
            return;
        }

        // A runtime reduce-motion toggle changes the flag the NEXT navigation reads; it does not fade on its own
        // (the web component only re-evaluates the transition on a route change).
        _reduceMotion = reduceMotion;
        Raise(nameof(ReduceMotion));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
