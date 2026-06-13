// Pure, framework-free model + projection for the ProgressRing shared surface — the native analogue of
// everything the web component derives before returning its SVG
// (web/src/components/data-display/ProgressRing.tsx). No Compose, no Android, no HTTP: every declaration
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// ProgressRing is a purely presentational surface — the web component takes its `value` (and the geometry
// props `max` / `size` / `strokeWidth` / `color`, plus the optional `label` / `centerLabel` /
// `centerSubLabel`) from whichever page owns the data; it binds NO hook of its own and resolves NO i18n
// key (the only text it shows is caller-supplied). As in the sibling AchievementBadge / shared-surface
// ports, the cache-then-network lifecycle (loading / error / stale / offline) lives on the owning page,
// not here; modelling those states would invent behaviour the source does not have. The branches the web
// source actually defines are the complete state set this surface renders, and each is projected here:
//   - the progress fill — `clamped = max(0, min(value, max))`, drawn as a fraction of the full ring, so an
//     empty/zero value shows only the track, a partial value a partial arc, and a full/over-max value the
//     complete ring (the web clamps, so a value past `max` never overdraws);
//   - the proportional centre text sizing — `mainSize = max(10, round(size * 0.32))` and
//     `subSize = max(8, round(size * 0.18))`, so the centre label reads like a real gauge at any ring size;
//   - whether any centre text is shown at all — `hasCenter = centerLabel != null || centerSubLabel != null`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/ProgressRing — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.progressring

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.roundToInt

/**
 * The fully projected, render-ready geometry — the native analogue of everything the web component
 * computes before drawing its two SVG circles. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host.
 *
 * @property fraction the clamped progress as a `0f..1f` fraction of the full ring (web `clamped / max`);
 *   the animated sweep target and the value handed to the progress accessibility semantics.
 * @property percent the whole-number progress percentage (`round(fraction * 100)`) used for the spoken
 *   accessibility announcement.
 * @property sweepAngleDegrees the swept angle of the progress arc, `360 * fraction` (web fills the ring
 *   clockwise from the top, i.e. from [ProgressRingProjection.START_ANGLE_DEGREES]).
 * @property centerLabelSp the proportional centre-label text size in sp (web `mainSize`).
 * @property centerSubLabelSp the proportional centre-sub-label text size in sp (web `subSize`).
 */
data class ProgressRingGeometry(
    val fraction: Float,
    val percent: Int,
    val sweepAngleDegrees: Float,
    val centerLabelSp: Int,
    val centerSubLabelSp: Int,
)

/**
 * Pure projection of the web `ProgressRing` derivations — a 1:1 port of the geometry and text-sizing the
 * web component computes from its props before returning JSX.
 */
object ProgressRingProjection {
    /** Web `max = 100` default — the value that maps to a full ring. */
    const val DEFAULT_MAX: Double = 100.0

    /** A full revolution; the progress arc spans `FULL_SWEEP_DEGREES * fraction`. */
    const val FULL_SWEEP_DEGREES: Float = 360f

    /** Web `-rotate-90`: the ring fills clockwise starting from the twelve-o'clock position. */
    const val START_ANGLE_DEGREES: Float = -90f

    private const val MAIN_LABEL_RATIO = 0.32
    private const val SUB_LABEL_RATIO = 0.18
    private const val MIN_MAIN_LABEL_SP = 10
    private const val MIN_SUB_LABEL_SP = 8
    private const val PERCENT_SCALE = 100

    /**
     * The clamped progress fraction in `0f..1f` — web `clamped / max` where
     * `clamped = max(0, min(value, max))`. A non-positive or non-finite [max] (the web divide-by-zero /
     * `NaN` edge) and a non-finite [value] fold to `0f` so the arc is simply empty rather than undefined.
     */
    fun fraction(
        value: Double,
        max: Double,
    ): Float {
        if (!value.isFinite() || !max.isFinite() || max <= 0.0) return 0f
        return (value.coerceIn(0.0, max) / max).toFloat()
    }

    /** The swept angle of the progress arc, `360 * fraction` (web fills clockwise from the top). */
    fun sweepAngle(
        value: Double,
        max: Double,
    ): Float = FULL_SWEEP_DEGREES * fraction(value, max)

    /**
     * The whole-number progress percentage, `round(fraction * 100)`. Kotlin's [roundToInt] rounds halves
     * towards positive infinity, matching JavaScript's `Math.round`.
     */
    fun percent(
        value: Double,
        max: Double,
    ): Int = (fraction(value, max) * PERCENT_SCALE).roundToInt()

    /**
     * The centre-label text size in sp — web `mainSize = Math.max(10, Math.round(size * 0.32))`. Keeping it
     * proportional to the ring [sizeDp] lets a caller size the gauge without retuning the label.
     */
    fun centerLabelSp(sizeDp: Double): Int = maxOf(MIN_MAIN_LABEL_SP, (sizeDp * MAIN_LABEL_RATIO).roundToInt())

    /** The centre-sub-label text size in sp — web `subSize = Math.max(8, Math.round(size * 0.18))`. */
    fun centerSubLabelSp(sizeDp: Double): Int = maxOf(MIN_SUB_LABEL_SP, (sizeDp * SUB_LABEL_RATIO).roundToInt())

    /** Web `hasCenter`: whether any centre text is drawn inside the ring. */
    fun hasCenter(
        centerLabel: String?,
        centerSubLabel: String?,
    ): Boolean = centerLabel != null || centerSubLabel != null

    /**
     * Project the render-ready [ProgressRingGeometry] for a [value] out of [max] on a ring [sizeDp] across.
     * Pure — the composable consumes the result without recomputing any of the web derivations.
     */
    fun project(
        value: Double,
        sizeDp: Double,
        max: Double = DEFAULT_MAX,
    ): ProgressRingGeometry {
        val clampedFraction = fraction(value, max)
        return ProgressRingGeometry(
            fraction = clampedFraction,
            percent = (clampedFraction * PERCENT_SCALE).roundToInt(),
            sweepAngleDegrees = FULL_SWEEP_DEGREES * clampedFraction,
            centerLabelSp = centerLabelSp(sizeDp),
            centerSubLabelSp = centerSubLabelSp(sizeDp),
        )
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * progress value or any caller-supplied label — so a diagnostics line can never leak what the ring shows.
 */
object ProgressRingDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "ProgressRing"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emit the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
