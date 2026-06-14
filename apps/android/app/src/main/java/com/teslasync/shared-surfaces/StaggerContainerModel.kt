// Pure, framework-free model + cadence projection + diagnostics for the StaggerContainer shared surface — the
// native analogue of every decision the web component makes (web/src/components/motion/StaggerContainer.tsx)
// before Compose paints anything. No Compose, no Android, no HTTP: every declaration here runs off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a motion wrapper that
// reads the one hook it has — `useMotionPreference()` — and orchestrates the entrance of its arbitrary
// `children` through a framer-motion `staggerChildren` cadence (0.06s = 60 ms between siblings). When the user
// has requested reduced motion the cadence collapses to 0 so the children appear in their final state at once.
// It fetches nothing, has no text of its own, and is transparent when it has no children.
//
// Why the generic data-surface states (loading / error / stale / offline) are intentionally absent: this surface
// performs no query — its only input is the device motion-preference signal (P1/S8, bound at the render boundary
// by the motion atom's reduced-motion plumbing), which is always available and never "loads", "errors", goes
// "stale", or goes "offline". Inventing those states would model an async dependency the web spec does not have
// (honesty covenant: no scope narrowing, no silent drift). The surface's REAL, fully-reproduced states are the
// cadence the entrance plays in: an animated stagger (motion enabled, ≥2 children), the collapsed immediate
// state (reduced motion or 0-1 children), and the transparent empty pass-through (no children). Each is reduced
// here by [staggerPlan] and asserted off-device, doubling as the per-state snapshot. The owning screen that DOES
// fetch renders its own data surface — with those states — inside this container.
//
// The cadence math is composed from the component-library motion atom's tested [staggerDelayMs] primitive
// (ADR-005) rather than re-derived, so the surface and the atom can never drift on what "60 ms per sibling"
// means; this model only projects that primitive across an item count into the full per-index plan callers need
// to know when the entrance has settled.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/StaggerContainer — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling SectionErrorBoundary / StatusBar surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.staggercontainer

import io.teslasync.android.components.motion.MotionDefaults
import io.teslasync.android.components.motion.staggerDelayMs
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no child content and no user
 * data — only this constant identifier — so a diagnostics line can never leak what was staggered into view.
 */
const val STAGGER_CONTAINER_SLUG: String = "StaggerContainer"

/**
 * Canonical registry metadata for the StaggerContainer surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`StaggerContainer`).
 */
object StaggerContainerRegistration {
    /** Stable surface id. */
    const val ID: String = "stagger-container"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = STAGGER_CONTAINER_SLUG
}

/**
 * Cadence between consecutive siblings — the native mirror of the web `staggerChildren: 0.06` (60 ms). Sourced
 * from the motion-token atom so the surface and the atom share one source of truth for the inter-item delay.
 */
const val DEFAULT_STAGGER_STEP_MS: Int = MotionDefaults.STAGGER_STEP_MS

/** Default per-child entrance length (the web child fade/slide), again sourced from the motion-token atom. */
const val DEFAULT_ITEM_DURATION_MS: Int = MotionDefaults.ITEM_MS

/**
 * The resolved entrance plan for a container of [delaysMs]`.size` children: the per-index start delay each child
 * waits before animating, the per-child animation length, and the active reduced-motion flag. Pure data so the
 * cadence is asserted off-device and the composable stays a thin render layer over it.
 */
data class StaggerPlan(
    val delaysMs: List<Int>,
    val itemDurationMs: Int,
    val reduce: Boolean,
) {
    /** Number of children the plan was built for. */
    val itemCount: Int
        get() = delaysMs.size

    /** True when there are no children — the container is a transparent pass-through (web empty `motion.div`). */
    val isEmpty: Boolean
        get() = delaysMs.isEmpty()

    /** True when at least one child waits before entering — i.e. a visible stagger plays (false when reduced). */
    val animates: Boolean
        get() = delaysMs.any { it > 0 }

    /** When the last child has finished entering, measured from the container's first frame (0 when reduced/empty). */
    val totalDurationMs: Int
        get() = if (isEmpty) 0 else (delaysMs.maxOrNull() ?: 0) + itemDurationMs
}

/**
 * Project [itemCount] children into the full entrance [StaggerPlan] at [stepMs] cadence and [itemDurationMs]
 * per-child length. The per-index delay is the motion atom's tested [staggerDelayMs] (index 0 and every child
 * under [reduce] start immediately); a negative count is clamped to empty. Under [reduce] the per-child duration
 * also collapses to 0 so the whole entrance is instant — the native mirror of the web `staggerChildren: 0`.
 */
fun staggerPlan(
    itemCount: Int,
    reduce: Boolean,
    stepMs: Int = DEFAULT_STAGGER_STEP_MS,
    itemDurationMs: Int = DEFAULT_ITEM_DURATION_MS,
): StaggerPlan {
    val count = itemCount.coerceAtLeast(0)
    val delays = (0 until count).map { index -> staggerDelayMs(index = index, stepMs = stepMs, reduce = reduce) }
    val duration = if (reduce) 0 else itemDurationMs.coerceAtLeast(0)
    return StaggerPlan(delaysMs = delays, itemDurationMs = duration, reduce = reduce)
}

/**
 * The PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant surface
 * [SLUG] — no child content, no count, no user data — so observability can never leak what was staggered into
 * view. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object StaggerContainerDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = STAGGER_CONTAINER_SLUG

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
