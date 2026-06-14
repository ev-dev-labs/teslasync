// Pure, framework-free model + transition projection + diagnostics for the RouteTransition shared surface — the
// native analogue of every decision the web component makes (web/src/components/motion/RouteTransition.tsx)
// before Compose paints a frame. No Compose, no Android, no HTTP: every declaration here runs off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a motion wrapper placed
// around the routed page body (`<Outlet />`) that cross-fades the content whenever the location pathname changes
// (a 120 ms ease-out fade + 4 px y-translate, `mode="wait"` so the outgoing page unmounts before the incoming
// mounts). The two inputs it reads are `useLocation()` (it re-keys by the pathname ONLY — query/search/hash
// changes such as filters, sort or anchors never re-fade) and `useMotionPreference(120)`. It collapses the fade
// to an instant swap in two cases: when the user has requested reduced motion, and when EITHER the previous or
// the next pathname matches a list↔detail skip pattern (`/drives/:id`, `/charging/:id`, …) so a drill-in and the
// matching drill-back-out both feel snappy. `initial={false}` means the very first render never animates.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface performs no query. Its only inputs are the current location key (the nav layer, P1/S8) and the device
// motion preference (P1/S8, bound at the render boundary by the motion atom's reduced-motion plumbing) — both
// always available, neither ever "loads", "errors", goes "stale" or goes "offline". It wraps arbitrary page
// content and is transparent to it; the wrapped page owns its own data states and renders them inside this
// container. Inventing those states here would model an async dependency the web spec does not have (honesty
// covenant: no scope narrowing, no silent drift). The surface's REAL, fully-reproduced states are the transition
// branches the web file plays — the animated cross-fade (a non-skip page-to-page navigation with motion
// enabled), and the instant swap (reduced motion, OR a list↔detail navigation in either direction) — each
// projected by [transitionPlan] and asserted off-device so every branch doubles as a per-state snapshot.
//
// The skip-pattern matching + the reduced/skip duration collapse are composed from the component-library motion
// atom's tested primitives (ADR-005: shouldSkipTransition + effectiveDurationMs) rather than re-derived, so the
// surface and the atom can never drift on what "skip a list↔detail fade" means; this model only projects those
// primitives into the full per-navigation plan callers need to know whether a navigation animates.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/RouteTransition — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling StaggerContainer / ScrollRestoration surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routetransition

import io.teslasync.android.components.motion.DEFAULT_SKIP_ROUTE_PATTERNS
import io.teslasync.android.components.motion.MotionDefaults
import io.teslasync.android.components.motion.effectiveDurationMs
import io.teslasync.android.components.motion.shouldSkipTransition
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no route, no page content and
 * no user data — only this constant identifier — so a diagnostics line can never leak which screen was shown.
 */
const val ROUTE_TRANSITION_SLUG: String = "RouteTransition"

/**
 * Canonical registry metadata for the RouteTransition surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`RouteTransition`).
 */
object RouteTransitionRegistration {
    /** Stable surface id. */
    const val ID: String = "route-transition"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = ROUTE_TRANSITION_SLUG
}

/**
 * Base page-transition length — the native mirror of the web `useMotionPreference(120)` 120 ms cross-fade.
 * Sourced from the motion-token atom ([MotionDefaults.TRANSITION_MS], the design-system `fast` duration) so the
 * surface and the atom share one source of truth for how long a page cross-fade runs.
 */
const val DEFAULT_TRANSITION_DURATION_MS: Int = MotionDefaults.TRANSITION_MS

/**
 * The route patterns whose list↔detail navigations skip the cross-fade — re-exported from the motion atom's
 * [DEFAULT_SKIP_ROUTE_PATTERNS] (the native mirror of the web `DEFAULT_SKIP_PATTERNS`) so callers can read the
 * default set without reaching into the atom package, and so there is a single source of truth for it.
 */
val DEFAULT_ROUTE_SKIP_PATTERNS: List<String> = DEFAULT_SKIP_ROUTE_PATTERNS

/**
 * The resolved render decision for a single navigation from [previousRoute] to a new route — the native analogue
 * of the web component's per-render computation (`skipForList = matchesSkip(prev) || matchesSkip(next)` then
 * `effectiveDurationMs = reduce || skipForList ? 0 : durationMs`). Pure data so the decision is asserted
 * off-device and the composable stays a thin render layer over it.
 *
 * @property effectiveDurationMs how long the cross-fade runs for this navigation; 0 means an instant swap.
 * @property skippedForListDetail true when this is a list↔detail navigation (drill-in or back-out) that suppresses
 *   the fade regardless of the motion preference.
 * @property reduce the active reduced-motion preference that fed the decision.
 */
data class RouteTransitionPlan(
    val effectiveDurationMs: Int,
    val skippedForListDetail: Boolean,
    val reduce: Boolean,
) {
    /** True when the navigation plays a visible cross-fade (i.e. the effective duration is non-zero). */
    val animates: Boolean
        get() = effectiveDurationMs > 0

    /** True when the navigation is an instant swap — reduced motion, a skipped list↔detail hop, or both. */
    val instant: Boolean
        get() = effectiveDurationMs == 0
}

/**
 * Project a navigation from [previousRoute] to [nextRoute] into the render-ready [RouteTransitionPlan]. The fade
 * is suppressed (duration 0) when [reduce] is set OR when either path matches a [skipPatterns] entry — the native
 * mirror of the web `reduce || skipForList ? 0 : durationMs`. A 1:1 port that composes the motion atom's tested
 * [shouldSkipTransition] + [effectiveDurationMs] so the surface and the atom can never disagree on what animates.
 *
 * @param previousRoute the pathname the user is leaving (the web `prevPathRef.current`).
 * @param nextRoute the pathname being navigated to (the web `location.pathname`).
 * @param reduce the active reduced-motion preference (the web `useMotionPreference().reduce`).
 * @param durationMs the base cross-fade length when the navigation does animate (web `durationMs`, default 120 ms).
 * @param skipPatterns the list↔detail patterns that suppress the fade in either direction.
 */
fun transitionPlan(
    previousRoute: String,
    nextRoute: String,
    reduce: Boolean,
    durationMs: Int = DEFAULT_TRANSITION_DURATION_MS,
    skipPatterns: List<String> = DEFAULT_ROUTE_SKIP_PATTERNS,
): RouteTransitionPlan {
    val skipForList = shouldSkipTransition(previousRoute, nextRoute, skipPatterns)
    val effective = effectiveDurationMs(reduce = reduce || skipForList, requestedMs = durationMs)
    return RouteTransitionPlan(
        effectiveDurationMs = effective,
        skippedForListDetail = skipForList,
        reduce = reduce,
    )
}

/**
 * The cross-fade key for a location — the native analogue of the web `key={location.pathname}`. Re-keys by the
 * [pathname] ONLY; the [search] string (query parameters / hash — filters, sort, anchors) is deliberately
 * excluded so those changes never trigger a re-fade, exactly as the web component documents. Exposed so a binding
 * layer that observes the whole location can hand the surface a correct, search-insensitive key.
 */
@Suppress("UnusedParameter")
fun routeTransitionKey(
    pathname: String,
    search: String,
): String = pathname

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant
 * surface [SLUG] — never the route, the page content or any user data — so observability can never leak which
 * screen a user navigated to. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object RouteTransitionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = ROUTE_TRANSITION_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on the diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
