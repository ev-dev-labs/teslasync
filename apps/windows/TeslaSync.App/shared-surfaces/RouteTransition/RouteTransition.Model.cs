namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the <c>RouteTransition</c> shared surface — the native mirror of the web component at
/// <c>web/src/components/motion/RouteTransition.tsx</c>. The web source wraps the routed page body (the router
/// <c>&lt;Outlet /&gt;</c>) and cross-fades it on every <c>location.pathname</c> change: a 120ms ease-out fade
/// plus a 4px vertical translate, with <c>mode="wait"</c> so the outgoing page leaves before the incoming page
/// enters. It re-keys by pathname only (query/search/hash changes never re-fade), skips the very first mount
/// (<c>initial={false}</c>), collapses to a no-op under <c>prefers-reduced-motion</c>, and suppresses the fade
/// entirely for list↔detail navigations (drilling into <c>/drives/:id</c> and back) so those feel instant. The
/// surface is anonymous: it renders no visible chrome and no static copy, so there are no i18n keys to resolve
/// and no interactive elements. This holder pins the diagnostics slug, the automation id, the default fade
/// duration and translate offset, the accessibility-transparency contract and the default skip-pattern list.
/// UI-free so the metadata is asserted headlessly without a XAML runtime.
/// </summary>
public static class RouteTransitionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "RouteTransition";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component is an anonymous <c>motion.div</c>
    /// wrapper with no <c>data-testid</c>, so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "route-transition";

    /// <summary>
    /// Default cross-fade duration in milliseconds (web <c>useMotionPreference(120)</c>). The fade is subtle
    /// enough to feel polished without slowing the user down.
    /// </summary>
    public const int DefaultDurationMs = 120;

    /// <summary>
    /// Default vertical translate magnitude in pixels (web <c>y: 4</c> on enter / <c>y: -4</c> on exit). The
    /// incoming page rises into place and the outgoing page lifts away.
    /// </summary>
    public const double DefaultOffsetY = 4.0;

    /// <summary>
    /// False because the wrapper introduces no semantic node of its own (the web <c>motion.div</c> carries no
    /// ARIA role). The view keeps itself out of the Narrator control view and out of the tab order so the routed
    /// page body it hosts is announced directly, with no extra container node to step through.
    /// </summary>
    public const bool ContributesAccessibilityNode = false;

    /// <summary>
    /// The route patterns whose navigations are NOT animated (web <c>DEFAULT_SKIP_PATTERNS</c>). Drilling from a
    /// list (<c>/drives</c>) into a detail (<c>/drives/123</c>) — and back out — feels better when it is
    /// near-instant, so the cross-fade is suppressed when EITHER the previous or the new pathname matches any of
    /// these (react-router <c>matchPath</c> with <c>end: true</c>). Order does not matter — the first match wins.
    /// </summary>
    public static IReadOnlyList<string> DefaultSkipPatterns { get; } = Array.AsReadOnly(new[]
    {
        "/drives/:id",
        "/drives/:id/replay",
        "/charging/:id",
        "/vehicles/:id",
        "/vehicles/:id/access",
        "/trips/:id",
    });
}

/// <summary>
/// Pure route-pattern matcher — the native port of react-router's <c>matchPath({ path, end: true }, pathname)</c>
/// the web source calls for each skip pattern (web/src/components/motion/RouteTransition.tsx). A pattern is split
/// into <c>/</c>-separated segments; a static segment must equal the corresponding path segment
/// case-insensitively (react-router's default <c>caseSensitive: false</c>), and a <c>:param</c> segment matches
/// exactly one non-empty path segment (react-router compiles <c>/:id</c> to <c>/([^/]+)</c>). With
/// <c>end: true</c> the whole path must be consumed, so the segment counts must match; a trailing slash on either
/// side is tolerated (react-router appends <c>\/*$</c> when matching to the end). No WinUI types and no regex
/// dependency — unit-tested without a UI host.
/// </summary>
public static class RouteMatcher
{
    /// <summary>
    /// Whether <paramref name="pathname"/> matches the react-router <paramref name="pattern"/> end-to-end.
    /// </summary>
    /// <param name="pattern">A react-router path pattern (e.g. <c>/drives/:id</c>).</param>
    /// <param name="pathname">The current location path (web <c>location.pathname</c>).</param>
    public static bool Matches(string pattern, string pathname)
    {
        ArgumentNullException.ThrowIfNull(pattern);
        ArgumentNullException.ThrowIfNull(pathname);

        string[] patternSegments = Split(pattern);
        string[] pathSegments = Split(pathname);

        // end: true — the full path must be consumed, so the segment counts have to line up exactly.
        if (patternSegments.Length != pathSegments.Length)
        {
            return false;
        }

        for (int i = 0; i < patternSegments.Length; i++)
        {
            string patternSegment = patternSegments[i];

            if (patternSegment.StartsWith(':'))
            {
                // react-router /:param → /([^/]+): a dynamic segment matches exactly one non-empty segment.
                if (pathSegments[i].Length == 0)
                {
                    return false;
                }

                continue;
            }

            if (!string.Equals(patternSegment, pathSegments[i], StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Whether <paramref name="pathname"/> matches ANY of <paramref name="patterns"/> (web
    /// <c>skipPattern.some(...)</c>).
    /// </summary>
    /// <param name="patterns">The route patterns to test against.</param>
    /// <param name="pathname">The current location path.</param>
    public static bool MatchesAny(IReadOnlyList<string> patterns, string pathname)
    {
        ArgumentNullException.ThrowIfNull(patterns);
        ArgumentNullException.ThrowIfNull(pathname);

        for (int i = 0; i < patterns.Count; i++)
        {
            if (Matches(patterns[i], pathname))
            {
                return true;
            }
        }

        return false;
    }

    private static string[] Split(string path)
    {
        // Normalise the leading slash and ignore a trailing one (react-router's `^\/*` / `\/*$` handling); the
        // root path "/" yields zero segments.
        string trimmed = path.Trim('/');
        return trimmed.Length == 0 ? Array.Empty<string>() : trimmed.Split('/');
    }
}

/// <summary>
/// Pure projection of one navigation into the transition the view plays — the native port of the web component
/// body (web/src/components/motion/RouteTransition.tsx lines computing <c>skipForList</c> and
/// <c>effectiveDurationMs</c>). It decides whether the cross-fade runs (<see cref="Animate"/>), the effective
/// fade <see cref="DurationMs"/> and the vertical <see cref="OffsetY"/>, and records WHY a fade was suppressed
/// (<see cref="Reduced"/> / <see cref="SkippedForList"/>). The fade is suppressed when the user prefers reduced
/// motion OR when either the previous or the new pathname matches a skip pattern (a list↔detail navigation); in
/// both cases the duration and offset collapse to zero so the swap is instant — exactly the web
/// <c>reduce || skipForList ? 0 : durationMs</c> and the <c>initial/exit</c> branches that hold opacity and y
/// fixed. Kept static and side-effect-free so the adapter is unit-testable without a view-model or a UI thread.
/// </summary>
public readonly record struct RouteTransitionPlan
{
    private RouteTransitionPlan(bool animate, int durationMs, double offsetY, bool reduced, bool skippedForList)
    {
        Animate = animate;
        DurationMs = durationMs;
        OffsetY = offsetY;
        Reduced = reduced;
        SkippedForList = skippedForList;
    }

    /// <summary>
    /// Whether the cross-fade runs. False under reduced motion, a list↔detail skip, or a non-positive duration,
    /// where the page swap is instant (web <c>effectiveDurationMs === 0</c>).
    /// </summary>
    public bool Animate { get; }

    /// <summary>
    /// The effective fade duration in milliseconds (web <c>effectiveDurationMs</c>): the configured duration when
    /// animating, otherwise <c>0</c>.
    /// </summary>
    public int DurationMs { get; }

    /// <summary>
    /// The effective vertical translate magnitude in pixels (web <c>y: 4</c> / <c>-4</c>): the configured offset
    /// when animating, otherwise <c>0</c> (the web <c>initial/exit</c> states hold <c>y</c> at 0 when suppressed).
    /// </summary>
    public double OffsetY { get; }

    /// <summary>True when the fade was suppressed because the user prefers reduced motion.</summary>
    public bool Reduced { get; }

    /// <summary>
    /// True when the fade was suppressed because the previous or new pathname matched a skip pattern (web
    /// <c>skipForList</c>) — a list↔detail drill-in / drill-out.
    /// </summary>
    public bool SkippedForList { get; }

    /// <summary>
    /// Project a navigation from <paramref name="previousPath"/> to <paramref name="newPath"/> into its
    /// transition. <paramref name="durationMs"/> and <paramref name="offsetY"/> are clamped to be non-negative;
    /// the fade is suppressed when <paramref name="reduceMotion"/> is set or either path matches a
    /// <paramref name="skipPatterns"/> entry, mirroring the web <c>reduce || skipForList</c> guard.
    /// </summary>
    /// <param name="previousPath">The pathname being navigated away from (web <c>prevPathRef.current</c>).</param>
    /// <param name="newPath">The pathname being navigated to (web <c>location.pathname</c>).</param>
    /// <param name="reduceMotion">Whether the OS reduce-motion preference is set (web <c>reduce</c>).</param>
    /// <param name="durationMs">The configured fade duration in milliseconds (web <c>durationMs</c>).</param>
    /// <param name="skipPatterns">The list↔detail patterns that suppress the fade (web <c>skipPattern</c>).</param>
    /// <param name="offsetY">The configured vertical translate magnitude in pixels (web <c>y</c>).</param>
    public static RouteTransitionPlan Compute(
        string previousPath,
        string newPath,
        bool reduceMotion,
        int durationMs,
        IReadOnlyList<string> skipPatterns,
        double offsetY)
    {
        ArgumentNullException.ThrowIfNull(previousPath);
        ArgumentNullException.ThrowIfNull(newPath);
        ArgumentNullException.ThrowIfNull(skipPatterns);

        // web: matchesSkip(prevPath) || matchesSkip(newPath) — back-navigation (POP) is skipped too.
        bool skippedForList =
            RouteMatcher.MatchesAny(skipPatterns, previousPath) ||
            RouteMatcher.MatchesAny(skipPatterns, newPath);

        int safeDuration = durationMs < 0 ? 0 : durationMs;
        double safeOffset = offsetY < 0 ? 0 : offsetY;
        bool suppressed = reduceMotion || skippedForList;
        bool animate = !suppressed && safeDuration > 0;

        return new RouteTransitionPlan(
            animate,
            animate ? safeDuration : 0,
            animate ? safeOffset : 0,
            reduceMotion,
            skippedForList);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>RouteTransition</c> surface (P1/S11 diagnostics contract). Records only
/// operational counters with the surface slug — never the route path, which can carry fleet identifiers (a
/// <c>/charging/{id}</c> or <c>/vehicles/{id}</c> path) — so a diagnostics line can never leak where a user
/// navigates. Thread-safe.
/// </summary>
public sealed class RouteTransitionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _animated;
    private long _skipped;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">An optional operational-only line sink (no route path is ever passed).</param>
    public RouteTransitionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been mounted/opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of navigations that played the cross-fade (count only — never the path).</summary>
    public long Animated => Interlocked.Read(ref _animated);

    /// <summary>Number of navigations swapped instantly (reduced motion or a list↔detail skip).</summary>
    public long Skipped => Interlocked.Read(ref _skipped);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=RouteTransition</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RouteTransitionRegistration.Slug}");
    }

    /// <summary>Record an animated navigation, emitting <c>route.transition slug=RouteTransition</c> (no path).</summary>
    public void RecordAnimated()
    {
        Interlocked.Increment(ref _animated);
        _sink?.Invoke($"route.transition slug={RouteTransitionRegistration.Slug}");
    }

    /// <summary>Record an instant (suppressed) navigation, emitting <c>route.skipped slug=RouteTransition</c>.</summary>
    public void RecordSkipped()
    {
        Interlocked.Increment(ref _skipped);
        _sink?.Invoke($"route.skipped slug={RouteTransitionRegistration.Slug}");
    }
}
