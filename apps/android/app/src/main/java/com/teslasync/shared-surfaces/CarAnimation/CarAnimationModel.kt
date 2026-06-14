// Pure, framework-free model + battery-fill projection + diagnostics for the CarAnimation shared surface — the
// native analogue of every decision the web component file makes (web/src/components/motion/CarAnimation.tsx)
// before Compose paints a single illustration. No Compose, no Android, no HTTP: every declaration here runs
// off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE behaviour this surface reproduces): a file of four brand
// motion illustrations — CarAnimation (a Tesla silhouette that draws + scales in, then holds), ChargingBolt (a
// charging bolt that fades + pulses in), WheelSpin (a continuous loading wheel) and BatteryFillAnimation (a
// battery gauge whose fill animates to a level and is colored by it). The only inputs the file reads are the
// device motion preference (useMotionPreference, honored so reduced motion renders the final frame with no
// entry, draw-in or loop) and three i18n labels (useTranslation: carAnimation.tesla / .charging / .loading).
// It fetches nothing and owns no data of its own.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface performs no query — its inputs are the always-available motion-preference signal (P1/S8, bound
// at the render boundary by the motion atom's reduced-motion plumbing) and caller-supplied parameters, which
// never "load", "error", go "stale" or go "offline". Inventing those states would model an async dependency the
// web spec does not have (honesty covenant: no scope narrowing, no silent drift). The surface's REAL,
// fully-reproduced states are the ones the web file defines: the animated entrance vs. the reduced-motion final
// frame for each illustration, the WheelSpin loop vs. its static wheel, and the battery's three fill buckets
// (good / warn / bad) with its level clamp — the one genuine data-driven branch, projected by [batteryFillPlan]
// and asserted off-device so each bucket doubles as a per-state snapshot.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/CarAnimation — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling StaggerContainer / Spinner surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.caranimation

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no level, size or label —
 * only this constant identifier — so a diagnostics line can never leak what was drawn into view.
 */
const val CAR_ANIMATION_SLUG: String = "CarAnimation"

/**
 * Canonical registry metadata for the CarAnimation surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`CarAnimation`).
 */
object CarAnimationRegistration {
    /** Stable surface id. */
    const val ID: String = "car-animation"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = CAR_ANIMATION_SLUG
}

/**
 * The battery state-of-charge band the web `BatteryFillAnimation` colors its fill by
 * (`level >= 60 ? GOOD : level >= 30 ? WARN : BAD`). Pure data so the banding is asserted off-device; the
 * composable maps each band to the matching semantic theme token (success / warning / danger).
 */
enum class BatteryFillBucket {
    /** Web `COLOR.GOOD` — a healthy charge (>= [BATTERY_GOOD_MIN_PERCENT]). */
    Good,

    /** Web `COLOR.WARN` — a low charge (>= [BATTERY_WARN_MIN_PERCENT], below good). */
    Warn,

    /** Web `COLOR.BAD` — a critically low charge (below [BATTERY_WARN_MIN_PERCENT]). */
    Bad,
}

/** Web `level >= 60` good threshold — at or above this the gauge fills with the success color. */
const val BATTERY_GOOD_MIN_PERCENT: Int = 60

/** Web `level >= 30` warn threshold — at or above this (but below good) the gauge fills with the warning color. */
const val BATTERY_WARN_MIN_PERCENT: Int = 30

/**
 * The resolved render state of the battery gauge for a requested charge level — the native analogue of the web
 * `BatteryFillAnimation` derivation (`fillWidth = (barWidth - 4) * min(level, 100) / 100`, plus the
 * good/warn/bad color pick). Pure data so it is a unit-tested per-state snapshot.
 *
 * @property levelPercent the requested level clamped to 0..100 (the web `Math.min(level, 100)`, also floored at
 *   0 so a negative level never paints a negative-width fill).
 * @property fillFraction the proportion of the gauge to fill, 0f..1f (the clamped level / 100).
 * @property bucket the color band the fill is drawn in.
 */
data class BatteryFillPlan(
    val levelPercent: Int,
    val fillFraction: Float,
    val bucket: BatteryFillBucket,
)

/**
 * Project a requested battery [levelPercent] into the render-ready [BatteryFillPlan]: the level is clamped into
 * 0..100, the fill fraction is that clamped level / 100, and the color band follows the web thresholds
 * ([BATTERY_GOOD_MIN_PERCENT] / [BATTERY_WARN_MIN_PERCENT]). A 1:1 port of the web `BatteryFillAnimation`
 * derivation, kept free of Compose so the composable only has to draw the result (and so callers can read the
 * band/fill without re-deriving it — the drawing motion atom encodes the same thresholds privately).
 */
fun batteryFillPlan(levelPercent: Int): BatteryFillPlan {
    val clamped = levelPercent.coerceIn(0, 100)
    val bucket =
        when {
            clamped >= BATTERY_GOOD_MIN_PERCENT -> BatteryFillBucket.Good
            clamped >= BATTERY_WARN_MIN_PERCENT -> BatteryFillBucket.Warn
            else -> BatteryFillBucket.Bad
        }
    return BatteryFillPlan(levelPercent = clamped, fillFraction = clamped / PERCENT_FULL, bucket = bucket)
}

/** 100% expressed as a float divisor, so the fill fraction lands in 0f..1f. */
private const val PERCENT_FULL: Float = 100f

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). The `view.opened` event carries only the constant
 * surface [SLUG] — no level, size or label — so observability can never leak what was drawn into view. Kept
 * free of Compose so it is unit-tested with a recording [Logger].
 */
object CarAnimationDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = CAR_ANIMATION_SLUG

    /** The one-shot event emitted once when a surface illustration opens. */
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
