// Pure, framework-free model + entrance projection + diagnostics for the StaggerItem shared surface — the native
// analogue of every decision the web component makes (web/src/components/motion/StaggerItem.tsx) before Compose
// paints anything. No Compose, no Android, no HTTP: every declaration here runs off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a single child of a
// StaggerContainer that animates into place. It reads the one hook it has — `useMotionPreference(350)` — and
// defines two framer-motion variants: `hidden` (the entry frame) and `show` (the resting frame). When motion is
// enabled `hidden` is { opacity: 0, y: 15 } so the child fades up from 15 px below over the 350 ms `durationMs`;
// `show` is { opacity: 1, y: 0 }. When the user has requested reduced motion `hidden` collapses to the final
// frame ({ opacity: 1, y: 0 }) and `durationMs` is 0, so the child appears in place with no fade or slide. The
// inter-sibling delay itself is owned by the parent StaggerContainer's `staggerChildren`; on native, where there
// is no parent-orchestrated clock, the delay is derived per item from its ordinal by the tested [staggerDelayMs].
// The item fetches nothing, renders no text of its own, and is transparent when it has no content.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface performs no query — its only input is the device motion-preference signal (P1/S8, bound at the render
// boundary by the motion atom's reduced-motion plumbing), which is always available and never "loads", "errors",
// goes "stale", or goes "offline". Inventing those states would model an async dependency the web spec does not
// have (honesty covenant: no scope narrowing, no silent drift). The surface's REAL, fully-reproduced states are
// the two variants the web source plays — the animated entrance (motion enabled: fades + slides up from the
// offset) and the collapsed immediate frame (reduced motion: the web `hidden = show` branch) — plus the first
// item's zero-delay entrance and the transparent empty pass-through. Each is reduced here by [staggerItemPlan]
// and asserted off-device, doubling as the per-state snapshot.
//
// The cadence + duration math is composed from the component-library motion atom's tested [staggerDelayMs] and
// [effectiveDurationMs] primitives (ADR-005) rather than re-derived, so the surface and the atom can never drift
// on what "60 ms per sibling" or "collapse to 0 under reduced motion" means; this model only projects those
// primitives into the per-item entrance plan callers and tests read.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/StaggerItem — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling StaggerContainer / CarAnimation surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.staggeritem

import io.teslasync.android.components.motion.MotionDefaults
import io.teslasync.android.components.motion.effectiveDurationMs
import io.teslasync.android.components.motion.staggerDelayMs
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no child content and no
 * index — only this constant identifier — so a diagnostics line can never leak what was animated into view.
 */
const val STAGGER_ITEM_SLUG: String = "StaggerItem"

/**
 * Canonical registry metadata for the StaggerItem surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`StaggerItem`).
 */
object StaggerItemRegistration {
    /** Stable surface id. */
    const val ID: String = "stagger-item"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = STAGGER_ITEM_SLUG
}

/**
 * Cadence between consecutive siblings — the native mirror of the web parent's `staggerChildren: 0.06` (60 ms).
 * Sourced from the motion-token atom so the item and its container share one source of truth for the delay.
 */
const val DEFAULT_STAGGER_STEP_MS: Int = MotionDefaults.STAGGER_STEP_MS

/**
 * Default entrance length for the child's `show` transition (the web `durationMs` from `useMotionPreference(350)`,
 * mapped to the native motion-`normal` token so timing comes from P1/S9 rather than a ported literal).
 */
const val DEFAULT_ITEM_DURATION_MS: Int = MotionDefaults.ITEM_MS

/**
 * Default slide-up distance the child travels while fading in — the native mirror of the web `hidden` `y: 15`,
 * sourced from the motion-token atom (`SLIDE_DP`) so the offset is a platform token, not a ported pixel value.
 */
const val DEFAULT_SLIDE_DP: Int = MotionDefaults.SLIDE_DP

private const val FULLY_VISIBLE: Float = 1f
private const val FULLY_HIDDEN: Float = 0f

/**
 * The resolved entrance state of a single staggered child — the native analogue of the web `StaggerItem`
 * `hidden`/`show` variants. Pure data so the entrance is asserted off-device and the composable stays a thin
 * render layer over it.
 *
 * @property index the child's ordinal within its container (clamped to >= 0); drives the [delayMs].
 * @property delayMs how long the child waits before animating, from its [index] at the stagger cadence (web
 *   `staggerChildren`); 0 for the first child and for every child under reduced motion.
 * @property durationMs the `show` transition length (web `durationMs`); 0 under reduced motion.
 * @property startOffsetDp the child's starting vertical offset (web `hidden` `y`); 0 under reduced motion.
 * @property startAlpha the child's starting opacity (web `hidden` `opacity`); 1 under reduced motion (final frame).
 * @property reduce the active reduced-motion preference.
 */
data class StaggerItemPlan(
    val index: Int,
    val delayMs: Int,
    val durationMs: Int,
    val startOffsetDp: Int,
    val startAlpha: Float,
    val reduce: Boolean,
) {
    /** True when the child visibly transitions in (motion enabled with a non-zero duration). */
    val animates: Boolean
        get() = !reduce && durationMs > 0

    /** True when the child begins below its final opacity — the web `hidden` ≠ `show` case (motion enabled). */
    val startsHidden: Boolean
        get() = startAlpha < FULLY_VISIBLE

    /** When the child has finished entering, measured from the container's first frame (0 when reduced). */
    val totalDurationMs: Int
        get() = delayMs + durationMs
}

/**
 * Project a child at [index] into its render-ready [StaggerItemPlan] at [stepMs] cadence, [itemDurationMs]
 * `show` length and [slideDp] starting offset. The per-index delay is the motion atom's tested [staggerDelayMs]
 * (index 0 and every child under [reduce] start immediately); the duration is [effectiveDurationMs] (collapsed to
 * 0 under [reduce]); and under [reduce] the starting offset and opacity collapse to the final frame (web
 * `hidden = { opacity: 1, y: 0 }`). A negative [index] is clamped to the first item and a negative [slideDp] to 0.
 */
fun staggerItemPlan(
    index: Int,
    reduce: Boolean,
    stepMs: Int = DEFAULT_STAGGER_STEP_MS,
    itemDurationMs: Int = DEFAULT_ITEM_DURATION_MS,
    slideDp: Int = DEFAULT_SLIDE_DP,
): StaggerItemPlan {
    val safeIndex = index.coerceAtLeast(0)
    return StaggerItemPlan(
        index = safeIndex,
        delayMs = staggerDelayMs(index = safeIndex, stepMs = stepMs, reduce = reduce),
        durationMs = effectiveDurationMs(reduce = reduce, requestedMs = itemDurationMs),
        startOffsetDp = if (reduce) 0 else slideDp.coerceAtLeast(0),
        startAlpha = if (reduce) FULLY_VISIBLE else FULLY_HIDDEN,
        reduce = reduce,
    )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant
 * surface [SLUG] — no child content, no index, no user data — so observability can never leak what was animated
 * into view. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object StaggerItemDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = STAGGER_ITEM_SLUG

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
