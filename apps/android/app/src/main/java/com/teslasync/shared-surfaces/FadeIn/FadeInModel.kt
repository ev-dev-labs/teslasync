// Pure, framework-free model + entrance projection + diagnostics for the FadeIn shared surface — the native
// analogue of every decision the web component makes (web/src/components/motion/FadeIn.tsx) before Compose paints
// anything. No Compose, no Android, no HTTP: every declaration here runs off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer over it.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a motion wrapper that
// reads the one hook it has — `useMotionPreference(400)` — and fades its arbitrary `children` in from
// `{ opacity: 0, y: 12 }` to `{ opacity: 1, y: 0 }` over the resolved duration, honouring an optional `delay`
// for stagger orchestration. When the user has requested reduced motion the web sets `initial={false}` so the
// element renders in its final state with no entry animation and the delay is ignored. It fetches nothing, has no
// text of its own, and is a transparent wrapper around whatever it is handed.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// performs no query — its only input is the device motion-preference signal (P1/S8, bound at the render boundary
// by the motion atom's reduced-motion plumbing), which is always available and never "loads", "errors", goes
// "stale", or goes "offline". Inventing those states would model an async dependency the web spec does not have
// (honesty covenant: no scope narrowing, no silent drift). The surface's REAL, fully-reproduced states are the
// way the entrance resolves: the animated reveal (motion enabled — fade + slide-up), the immediate final state
// (reduced motion, the web `initial={false}` branch), and the transparent empty wrapper (no content). Each is
// reduced here by [fadePlan] and asserted off-device, doubling as the per-state snapshot. The owning screen that
// DOES fetch renders its own data surface — with those states — inside this wrapper.
//
// The duration collapse is composed from the component-library motion atom's tested [effectiveDurationMs]
// primitive (ADR-005) rather than re-derived, so the surface and the atom can never drift on what "reduced motion
// means zero duration" means; this model only projects that primitive — plus the delay and slide offset — into
// the full entrance plan callers need to know when the reveal has settled.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/FadeIn — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges
// from the path — exactly as the sibling StaggerContainer / StatusBar surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.fadein

import io.teslasync.android.components.motion.MotionDefaults
import io.teslasync.android.components.motion.effectiveDurationMs
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no child content and no user
 * data — only this constant identifier — so a diagnostics line can never leak what was faded into view.
 */
const val FADE_IN_SLUG: String = "FadeIn"

/**
 * Canonical registry metadata for the FadeIn surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`FadeIn`).
 */
object FadeInRegistration {
    /** Stable surface id. */
    const val ID: String = "fade-in"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = FADE_IN_SLUG
}

/**
 * Default reveal length (the web `useMotionPreference(400)` duration), sourced from the motion-token atom so the
 * surface and the atom share one source of truth for how long a fade plays.
 */
const val DEFAULT_FADE_DURATION_MS: Int = MotionDefaults.FADE_MS

/** Default entrance delay — the web `delay = 0` default; callers raise it to hand-stagger a few siblings. */
const val DEFAULT_FADE_DELAY_MS: Int = 0

/** Default slide-up distance the element travels while fading in (the web `y: 12`), again from the token atom. */
const val DEFAULT_FADE_SLIDE_DP: Int = MotionDefaults.SLIDE_DP

/**
 * The resolved entrance plan for one fade: the reveal duration, the start delay, the slide-up offset the element
 * travels through, and the active reduced-motion flag. Pure data so the entrance is asserted off-device and the
 * composable stays a thin render layer over it. Mirrors the web `initial` / `animate` / `transition` triple.
 */
data class FadePlan(
    val durationMs: Int,
    val delayMs: Int,
    val slideDp: Int,
    val reduce: Boolean,
) {
    /** True when an entry animation plays — the element starts hidden and reveals (false under reduced motion). */
    val animates: Boolean
        get() = !reduce

    /** The element's opacity on the first frame: hidden (0) while animating, already final (1) when reduced. */
    val initialAlpha: Float
        get() = if (animates) 0f else 1f

    /** The element's slide-up offset on the first frame (the web `y`); 0 when reduced (renders in place). */
    val initialOffsetDp: Int
        get() = slideDp

    /** When the reveal has fully settled, measured from the wrapper's first frame (0 when reduced/instant). */
    val totalDurationMs: Int
        get() = delayMs + durationMs

    /** True when the content appears in its final state at once — reduced motion, or a zero-length zero-delay reveal. */
    val isInstant: Boolean
        get() = totalDurationMs == 0
}

/**
 * Project a single fade into the full entrance [FadePlan] at [durationMs] reveal length, [delayMs] start delay,
 * and [slideDp] slide-up offset. The duration is collapsed by the motion atom's tested [effectiveDurationMs]
 * (0 under [reduce]); under [reduce] the delay and the slide offset also collapse to 0 so the content renders in
 * its final state immediately — the native mirror of the web `initial={false}` / `delay: reduce ? 0 : delay`
 * branch. Negative inputs are clamped to 0.
 */
fun fadePlan(
    reduce: Boolean,
    durationMs: Int = DEFAULT_FADE_DURATION_MS,
    delayMs: Int = DEFAULT_FADE_DELAY_MS,
    slideDp: Int = DEFAULT_FADE_SLIDE_DP,
): FadePlan {
    val resolvedDuration = effectiveDurationMs(reduce = reduce, requestedMs = durationMs)
    val resolvedDelay = if (reduce) 0 else delayMs.coerceAtLeast(0)
    val resolvedSlide = if (reduce) 0 else slideDp.coerceAtLeast(0)
    return FadePlan(
        durationMs = resolvedDuration,
        delayMs = resolvedDelay,
        slideDp = resolvedSlide,
        reduce = reduce,
    )
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — no child content, no timing, no user data — so observability can never leak what was faded into view.
 * Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object FadeInDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = FADE_IN_SLUG

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
