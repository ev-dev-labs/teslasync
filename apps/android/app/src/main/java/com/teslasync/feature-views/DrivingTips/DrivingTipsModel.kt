// Pure, framework-free model + projection for the DrivingTips feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/driving-dynamics/DrivingTips.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// DrivingTips is a purely presentational, prop-driven surface. The web component takes a `motorStats` object
// (or null) and a `throttleStyle` (or null) — both computed upstream by the Driving Dynamics page from the
// `/motor/...` history — and `useMemo`s an ordered list of coaching tips from them. Its only other dependency
// is `useTranslation` (the P1/S10 i18n catalog). It binds NO data hook of its own, so — exactly as the
// sibling HealthRecommendations / HighlightCard ports reason — there is no loading / error / stale / offline
// lifecycle to model here; that belongs to the owning page, and inventing it would be drift the spec does not
// have. What the web source genuinely varies is the tip list as a function of (`motorStats`, `throttleStyle`),
// and that is exactly what this projection reproduces and the tests exercise.
//
// The two web data branches are the complete state set this surface renders:
//   • an absent `motorStats` (web `if (!motorStats)`) → the single friendly "drive to start collecting" tip,
//     which is the web's own empty handling — a present, readable row, never a blank box; and
//   • a present `motorStats` → one of three power-band tip pairs (high / moderate / efficient), optionally
//     followed by the high-motor-temp thermal tip.
// The leading glyph of every row is chosen by `throttleStyle` (conservative → a reassuring shield-check,
// otherwise an alert triangle), exactly as the web does.
//
// The web `MotorStats` interface (helpers.ts) carries ten fields, but DrivingTips reads only `avgPower` and
// `maxMotorTemp`; following the sibling LiveMotorStatus precedent ("the slice it consumes"), [MotorStats] here
// mirrors just those two. The localized tip text is resolved at the Compose render boundary via the P1/S10
// i18n facade (stringResource) — never stored in this layer — so no English literal lives in the model.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DrivingTips — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling HealthRecommendations / LiveMotorStatus
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingtips

import io.teslasync.shared.core.diagnostics.Logger

/** Average drive power (kW) at or above which `getThrottleStyle` classifies the style as aggressive. */
private const val THROTTLE_AGGRESSIVE_MIN_KW: Double = 80.0

/** Average drive power (kW) below which `getThrottleStyle` classifies the style as conservative. */
private const val THROTTLE_CONSERVATIVE_MAX_KW: Double = 20.0

/** Web `motorStats.avgPower > 80` — above this the surface shows the high-power "ease off" coaching pair. */
private const val TIP_HIGH_POWER_KW: Double = 80.0

/** Web `motorStats.avgPower > 20` — above this (but not high) the surface shows the moderate-power pair. */
private const val TIP_MODERATE_POWER_KW: Double = 20.0

/** Web `motorStats.maxMotorTemp > 120` — above this the thermal-caution tip is appended. */
private const val TIP_HIGH_MOTOR_TEMP_C: Double = 120.0

/**
 * Throttle-input classification — the native analogue of the web `ThrottleStyle` union
 * (`'conservative' | 'moderate' | 'aggressive'`, from `driving-dynamics/helpers.ts`). The web value is
 * computed upstream by `getThrottleStyle(avgPower)` and threaded into DrivingTips as the `throttleStyle` prop;
 * this surface reads it only to pick each tip row's leading glyph (conservative → shield-check, otherwise
 * alert triangle).
 */
enum class ThrottleStyle {
    Conservative,
    Moderate,
    Aggressive,
    ;

    companion object {
        /**
         * Maps a raw `throttleStyle` union string to its [ThrottleStyle]. The web keys are exact lowercase; an
         * absent (`null`) or unrecognised value folds to `null`, mirroring the web prop's `ThrottleStyle | null`
         * type so an upstream gap renders the neutral (alert-triangle) glyph rather than a fabricated style.
         */
        fun fromRaw(value: String?): ThrottleStyle? =
            when (value) {
                "conservative" -> Conservative
                "moderate" -> Moderate
                "aggressive" -> Aggressive
                else -> null
            }

        /**
         * Reproduces the web `getThrottleStyle(avgPower)` derivation (helpers.ts): `< 20` → [Conservative],
         * `< 80` → [Moderate], else [Aggressive]. Exposed so the owning Driving Dynamics surface can compute the
         * `throttleStyle` prop from the same `avgPower` it feeds [MotorStats], keeping the two in lock-step.
         */
        fun fromAvgPower(avgPower: Double): ThrottleStyle =
            when {
                avgPower < THROTTLE_CONSERVATIVE_MAX_KW -> Conservative
                avgPower < THROTTLE_AGGRESSIVE_MIN_KW -> Moderate
                else -> Aggressive
            }
    }
}

/**
 * The slice of the web `MotorStats` (helpers.ts) that DrivingTips actually reads — the average drive power and
 * the peak motor temperature, both already in their display units (kW and °C, derived upstream exactly as the
 * web renders them). Modelled as the consumed slice rather than the full ten-field interface, following the
 * sibling LiveMotorStatus precedent, because these two values fully determine the tip list.
 *
 * @property avgPower average motor power in kW (web `motorStats.avgPower`) — selects the power-band tip pair.
 * @property maxMotorTemp peak motor temperature in °C (web `motorStats.maxMotorTemp`) — gates the thermal tip.
 */
data class MotorStats(
    val avgPower: Double,
    val maxMotorTemp: Double,
)

/**
 * A single coaching tip DrivingTips can emit — its stable identity ([listKey]) and its i18n key ([i18nKey]).
 * Mirrors the eight `t('dynamics.tip*', …)` strings the web component can push. The localized text is resolved
 * at the Compose boundary, never stored here, so the model holds no English literal. The constant order is the
 * canonical web emission order; [DrivingTipsProjection] selects and orders the subset shown for a given input.
 *
 * @property listKey a stable, locale-independent id used as the Compose list key and in tests (the native
 *   analogue of the web `key={i}` index, but content-stable).
 * @property i18nKey the P1/S10 catalog key whose value the composable resolves for the tip text
 *   (e.g. `dynamics.tipNoData`).
 */
enum class DrivingTip(
    val listKey: String,
    val i18nKey: String,
) {
    NoData("no-data", "dynamics.tipNoData"),
    EaseAccel("ease-accel", "dynamics.tipEaseAccel"),
    BrakeEarly("brake-early", "dynamics.tipBrakeEarly"),
    SmoothThrottle("smooth-throttle", "dynamics.tipSmoothThrottle"),
    Coast("coast", "dynamics.tipCoast"),
    Great("great", "dynamics.tipGreat"),
    Keep("keep", "dynamics.tipKeep"),
    Thermal("thermal", "dynamics.tipThermal"),
}

/**
 * Pure projection from the surface's inputs to its ordered tip list — a 1:1 port of the web component's
 * `useMemo` body. Reproduces the exact branch order:
 *
 *   1. no `motorStats` → just the "drive to start collecting" tip (the web empty handling), then stop;
 *   2. `avgPower > 80` → ease-accel + brake-early; else `avgPower > 20` → smooth-throttle + coast;
 *      else → great + keep;
 *   3. `maxMotorTemp > 120` → append the thermal-caution tip.
 *
 * so the same input always yields the same list, in the same order, as the web. Stateless and Compose-free.
 */
object DrivingTipsProjection {
    /**
     * Build the ordered tip list for [motorStats], mirroring the web `useMemo`. Returns exactly one tip when
     * [motorStats] is `null` (the friendly no-data row), otherwise two power-band tips plus an optional third
     * thermal tip — so the result is never empty and the panel is never a blank box.
     */
    fun tipsFor(motorStats: MotorStats?): List<DrivingTip> {
        if (motorStats == null) return listOf(DrivingTip.NoData)
        return buildList {
            when {
                motorStats.avgPower > TIP_HIGH_POWER_KW -> {
                    add(DrivingTip.EaseAccel)
                    add(DrivingTip.BrakeEarly)
                }
                motorStats.avgPower > TIP_MODERATE_POWER_KW -> {
                    add(DrivingTip.SmoothThrottle)
                    add(DrivingTip.Coast)
                }
                else -> {
                    add(DrivingTip.Great)
                    add(DrivingTip.Keep)
                }
            }
            if (motorStats.maxMotorTemp > TIP_HIGH_MOTOR_TEMP_C) {
                add(DrivingTip.Thermal)
            }
        }
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the motor
 * stats, the throttle style, or any tip text — so a diagnostics line can never leak vehicle state.
 */
object DrivingTipsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "DrivingTips"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
