// Pure, framework-free model + resolver + diagnostics for the OnboardingGate feature view — the native
// analogue of the redirect decision the web component owns
// (web/src/features/onboarding/components/OnboardingGate.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// OnboardingGate is a first-run redirect GUARD. The web component composes four hooks — `useOnboardingStatus`
// (the cache-then-network gate read), `useOnboardingSkip` (a persisted "skip wizard" flag), `useLocation`
// (the current path), and `useNavigate` — and runs ONE effect:
//
//     if (isLoading || isError || !data) return;   // still resolving, errored, or nothing yet → do nothing
//     if (data.is_complete) return;                 // install is set up → let the app render
//     if (isSkipped) return;                        // operator chose "Skip for now" → honour it
//     if (isAllowed(location.pathname)) return;     // allow-listed path (tesla setup, share links, …)
//     navigate('/onboarding', { replace: true });   // otherwise bounce to the first-run flow
//
// then returns `null`. The component is intentionally non-blocking: it never renders chrome, it only triggers
// a redirect via the effect, so the surrounding routes render normally for already-onboarded users.
//
// This file owns exactly that decision as the pure [OnboardingGateResolver.decide] — a single, exhaustive
// branch over the same five inputs the web effect depends on, returning either a [OnboardingGateDecision.Pass]
// (carrying which guard clause matched, so each branch is independently verifiable) or a
// [OnboardingGateDecision.Redirect] to the canonical onboarding destination. The web `ALLOW_PREFIXES` list and
// its prefix-match semantics are reproduced verbatim in [OnboardingGateResolver.isAllowed]. The redirect
// target carries both the web path (`/onboarding`, for 1:1 parity) and the Navigation-Compose [route]
// (`onboarding`) — pinned against the canonical `io.teslasync.android.navigation.Destinations` registry by
// OnboardingGateResolverTest so this port can never drift from the navigation graph.
//
// State honesty (covenant: no silent drift): unlike the synchronous Legacy*Redirect surfaces, this guard binds
// a real cache-then-network read, so loading / error / stale / offline are genuine inputs — but in the web
// source every one of them resolves to the SAME observable behaviour: the guard does nothing and renders
// `null` (only an incomplete, resolved, non-skipped, non-allow-listed gate redirects). Reproducing that means
// each of those states maps to a [OnboardingGateDecision.Pass] here; the composable then stays transparent for
// a Pass (the host renders the requested screen unobstructed) and shows a brief redirecting affordance only
// while a Redirect is in flight. Modelling those states as visible takeover chrome would invent behaviour the
// web guard does not have.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/OnboardingGate — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment is illegal in a package identifier), so the package intentionally diverges from the
// path — exactly as the sibling Legacy*Redirect / AutopilotSection surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.onboardinggate

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus

/**
 * The resolved onboarding destination the guard redirects to — the native analogue of the web
 * `navigate('/onboarding', { replace: true })` call. Pure data (no Compose/Android types) so it is fully
 * covered by the off-device unit gate; the composable emits it once and the host performs the navigation.
 *
 * It carries both the canonical web path (web `to`, for 1:1 parity) and the Navigation-Compose [route] (the
 * web path with its leading slash removed, matching the canonical
 * [io.teslasync.android.navigation.Destinations] route id `onboarding`). [replace] is `true` so Back never
 * returns to the guarded screen the user was bounced from (web `{ replace: true }`).
 *
 * @property destinationId the canonical [io.teslasync.android.navigation.Destinations] id (`onboarding`).
 * @property route the Navigation-Compose route the host navigates to (`onboarding`).
 * @property webPath the web destination path (`/onboarding`).
 * @property replace swap the back-stack entry rather than push one (web `replace`).
 */
data class OnboardingGateTarget(
    val destinationId: String = OnboardingGateResolver.ONBOARDING_DESTINATION_ID,
    val route: String = OnboardingGateResolver.ONBOARDING_ROUTE,
    val webPath: String = OnboardingGateResolver.ONBOARDING_WEB_PATH,
    val replace: Boolean = true,
)

/**
 * Why the guard let a screen render instead of redirecting — one constant per web `return` clause, so each
 * guard branch is independently asserted by the resolver test (covenant: no scope narrowing). These map 1:1 to
 * the web effect's early returns, in the same order they are evaluated.
 */
enum class OnboardingGatePassReason {
    /** Web `isLoading`: the gate read is still in flight with nothing resolved to act on. */
    Loading,

    /** Web `isError`: the gate read failed (including an offline cache-after-failure) — never trap the user. */
    Error,

    /** Web `!data`: the read resolved without a gate payload (defensive — the store defaults pessimistically). */
    NoData,

    /** Web `data.is_complete`: the install is fully set up, so the app renders normally. */
    Complete,

    /** Web `isSkipped`: the operator chose "Skip for now"; honoured across reloads/tabs. */
    Skipped,

    /** Web `isAllowed(pathname)`: the current path is allow-listed (Tesla setup, share links, settings, …). */
    AllowListed,
}

/**
 * The guard's decision — the native analogue of "the web effect either returns early or calls `navigate`".
 * Pure, exhaustive sum type so the composable renders a single, total `when` and the resolver test can pin
 * every outcome.
 */
sealed interface OnboardingGateDecision {
    /**
     * The guard takes no action: the requested screen renders unobstructed (web `return`). [reason] records
     * which guard clause matched, for diagnostics and test assertions; it carries no user data.
     */
    data class Pass(
        val reason: OnboardingGatePassReason,
    ) : OnboardingGateDecision

    /** The guard redirects to onboarding (web `navigate('/onboarding', { replace: true })`). */
    data class Redirect(
        val target: OnboardingGateTarget,
    ) : OnboardingGateDecision
}

/**
 * Resolves the onboarding redirect decision — THE logic the web component runs in its effect before either
 * returning or calling `navigate`. Reproduces the web `ALLOW_PREFIXES` allow-list and its prefix-match
 * semantics, the five short-circuit guard clauses (in order), and the single redirect target. Pure +
 * stateless so the whole gate is verified off-device.
 */
object OnboardingGateResolver {
    /** The canonical onboarding destination id (web `to` → the [io.teslasync.android.navigation.Destinations] id). */
    const val ONBOARDING_DESTINATION_ID: String = "onboarding"

    /** The Navigation-Compose route the guard redirects to — web `to: '/onboarding'` without the leading slash. */
    const val ONBOARDING_ROUTE: String = "onboarding"

    /** The web destination path the guard redirects to (web `navigate('/onboarding', …)`). */
    const val ONBOARDING_WEB_PATH: String = "/onboarding"

    /**
     * Paths that bypass the guard, matched by prefix so nested routes work without listing every variant —
     * the verbatim web `ALLOW_PREFIXES`. A trailing-slash entry (e.g. `/s/`) matches by raw `startsWith`; a
     * non-slash entry matches an exact path or a `prefix/`-rooted subtree, exactly as the web `isAllowed` does.
     */
    val ALLOW_PREFIXES: List<String> =
        listOf(
            "/onboarding",
            "/tesla-account",
            "/settings",
            "/s/",
            "/watch",
            "/login",
        )

    /**
     * Whether [pathname] bypasses the guard — the verbatim web `isAllowed`:
     * `ALLOW_PREFIXES.some(prefix => prefix.endsWith('/') ? pathname.startsWith(prefix)
     *  : pathname === prefix || pathname.startsWith(`${prefix}/`))`.
     */
    fun isAllowed(pathname: String): Boolean =
        ALLOW_PREFIXES.any { prefix ->
            if (prefix.endsWith("/")) {
                pathname.startsWith(prefix)
            } else {
                pathname == prefix || pathname.startsWith("$prefix/")
            }
        }

    /**
     * The guard decision — the web effect body expressed as one exhaustive branch over the same five inputs
     * the effect depends on (`[data, isLoading, isError, isSkipped, location.pathname]`). The clause order is
     * the web order: while the read is loading, errored, or unresolved the guard does nothing; a completed
     * gate, an honoured skip, or an allow-listed path each let the screen render; otherwise the user is
     * redirected to onboarding.
     *
     * @param isLoading web `isLoading` — the gate read is in flight with nothing resolved.
     * @param isError web `isError` — the gate read failed (a stale offline cache also surfaces here).
     * @param status web `data` — the resolved gate payload, or `null` when nothing has resolved.
     * @param isSkipped web `isSkipped` — the persisted "Skip for now" flag.
     * @param pathname web `location.pathname` — the current path, in web-path form for 1:1 allow-list parity.
     */
    fun decide(
        isLoading: Boolean,
        isError: Boolean,
        status: OnboardingStatus?,
        isSkipped: Boolean,
        pathname: String,
    ): OnboardingGateDecision =
        when {
            isLoading -> OnboardingGateDecision.Pass(OnboardingGatePassReason.Loading)
            isError -> OnboardingGateDecision.Pass(OnboardingGatePassReason.Error)
            status == null -> OnboardingGateDecision.Pass(OnboardingGatePassReason.NoData)
            status.isComplete -> OnboardingGateDecision.Pass(OnboardingGatePassReason.Complete)
            isSkipped -> OnboardingGateDecision.Pass(OnboardingGatePassReason.Skipped)
            isAllowed(pathname) -> OnboardingGateDecision.Pass(OnboardingGatePassReason.AllowListed)
            else -> OnboardingGateDecision.Redirect(OnboardingGateTarget())
        }

    /**
     * Convenience overload reading the same inputs from a lifecycle-aware [UiState] gate projection — the
     * exact shape [OnboardingGateViewModel.status] exposes. [UiState.isLoading] is the web `isLoading`,
     * [UiState.hasError] is the web `isError` (a stale offline cache surfaces here too), and [UiState.data]
     * is the web `data`. Delegates to the primitive [decide] so both share one tested decision table.
     */
    fun decide(
        status: UiState<OnboardingStatus>,
        isSkipped: Boolean,
        pathname: String,
    ): OnboardingGateDecision =
        decide(
            isLoading = status.isLoading,
            isError = status.hasError,
            status = status.data,
            isSkipped = isSkipped,
            pathname = pathname,
        )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the gate
 * anchors, the path, or the skip flag — so a diagnostics line can never leak where the user was or whether
 * their install is set up.
 */
object OnboardingGateDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "onboarding-gate"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "OnboardingGate"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
