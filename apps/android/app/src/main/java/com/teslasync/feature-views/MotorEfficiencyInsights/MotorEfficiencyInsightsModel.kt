// Pure, framework-free model + projection for the MotorEfficiencyInsights feature view — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/driving/components/driving-dynamics/MotorEfficiencyInsights.tsx). No Compose, no Android,
// no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// MotorEfficiencyInsights is a presentational surface — the web component receives its `motorStats` and
// `throttleStyle` already computed from its parent (the driving-dynamics tab, which owns the motor-history
// query) plus a `toTemperatureDisplay` converter and the `tempUnit` label from `useUnits`. It renders a
// three-column grid of GlassPanels — Torque Distribution, Throttle Behavior, Motor Thermal — and, inside
// EACH panel, swaps to a friendly "No motor data recorded yet" empty state when `motorStats` is null. So the
// two branches the web source defines per panel (content / empty) are the complete render set this surface
// reproduces; the cache-then-network lifecycle (loading / error / stale / offline) is carried by the shared
// state-holder layer (P1/S8) the host threads in as a [UiState], exactly as the sibling feature views do.
//
// Per readout the web renders `fmtNumber(value, 1)` plus a fixed unit suffix: torque as " Nm", high-torque
// time as "%", power as " kW", and motor temperature as `fmtNumber(toTemperatureDisplay(v), 1) + tempUnit`
// (no space — the degree label already carries its symbol). This module reproduces that exactly: the shared
// `convertTempFromSI` performs the SI-Celsius -> display conversion (the backend serves SI; conversion is
// display-only, Phase-48), and [number] mirrors the web `fmtNumber` —
// `Number.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })` with the
// ECMAScript `halfExpand` rounding and the implicit `safeNumber` (null / NaN / infinite -> 0) it applies.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/MotorEfficiencyInsights — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.motorefficiencyinsights

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** Web `fmtNumber(value, 1)` — every readout in this surface renders with exactly one fractional digit. */
private const val READOUT_FRACTION_DIGITS: Int = 1

/** Unit suffix the web appends to the two torque readouts (`{fmtNumber(_, 1)} Nm`). */
private const val TORQUE_SUFFIX: String = " Nm"

/** Unit suffix the web appends to the high-torque-time readout (`{fmtNumber(_, 1)}%`). */
private const val PERCENT_SUFFIX: String = "%"

/** Unit suffix the web appends to the average-power readout (`{fmtNumber(_, 1)} kW`). */
private const val POWER_SUFFIX: String = " kW"

/** Web `MetricBar max={200}` — the throttle power bar saturates at 200 kW. */
private const val POWER_BAR_MAX_KW: Double = 200.0

/** Web thermal threshold: a max motor temperature (raw SI °C) below this is "Thermal: Good". */
private const val THERMAL_GOOD_CEILING_C: Double = 100.0

/** Web thermal threshold: a max motor temperature (raw SI °C) below this (but >= good) is "Thermal: Warm". */
private const val THERMAL_WARM_CEILING_C: Double = 140.0

/**
 * The shared accent a Throttle/Thermal chip + the throttle power bar resolve at the Compose boundary —
 * the native mirror of the web `success` / `warning` / `danger` Badge variant and the
 * `#22c55e` / `#eab308` / `#ef4444` bar color. Kept Android-free so the projection stays unit-testable.
 */
enum class MotorAccentLevel { Good, Caution, Alert }

/**
 * The user's driving style the web threads in as the `throttleStyle` prop. Each carries its
 * [MotorAccentLevel] so the badge variant and the power-bar color are derived once, here, rather than
 * re-branched at the Compose boundary.
 */
enum class ThrottleStyle(
    val level: MotorAccentLevel,
) {
    Conservative(MotorAccentLevel.Good),
    Moderate(MotorAccentLevel.Caution),
    Aggressive(MotorAccentLevel.Alert),
}

/**
 * The motor-thermal verdict the web derives from the raw (SI Celsius) max motor temperature. Each carries
 * its [MotorAccentLevel] so the thermal badge variant is derived once, here.
 */
enum class ThermalStatus(
    val level: MotorAccentLevel,
) {
    Good(MotorAccentLevel.Good),
    Warm(MotorAccentLevel.Caution),
    Hot(MotorAccentLevel.Alert),
}

/**
 * The native slice of the web `MotorStats` (web driving-dynamics `helpers.ts`) this surface consumes — the
 * six fields the component actually reads. All are SI: torque in newton-metres, the high-torque share as a
 * percentage, average power in kilowatts, and the two motor temperatures in degrees Celsius. The web's
 * `computeMotorStats` always yields finite values, but [MotorEfficiencyInsightsProjection.number] still
 * coerces a non-finite reading to 0 to match the web `fmtNumber` -> `safeNumber` contract.
 *
 * @property avgTorque mean combined axle torque (Nm).
 * @property maxTorque peak combined axle torque (Nm).
 * @property highTorquePct share of readings above the high-torque threshold (%).
 * @property avgPower mean motor power (kW) — also the throttle bar's value.
 * @property avgMotorTemp mean motor temperature (SI °C).
 * @property maxMotorTemp peak motor temperature (SI °C) — drives the thermal verdict.
 */
data class MotorStats(
    val avgTorque: Double,
    val maxTorque: Double,
    val highTorquePct: Double,
    val avgPower: Double,
    val avgMotorTemp: Double,
    val maxMotorTemp: Double,
)

/**
 * The two inputs the web component receives as props and which the host supplies through the shared
 * state-holder layer. A null [motorStats] drives every panel's empty state (web `motorStats ? … : noData`);
 * a null [throttleStyle] is treated as [ThrottleStyle.Aggressive], reproducing the web's terminal `: danger`
 * / `: 'Aggressive'` / `: '#ef4444'` fall-through when the prop is absent.
 *
 * @property motorStats the consumed motor-statistics slice, or `null` when no motor data has been recorded.
 * @property throttleStyle the parent-computed driving style, or `null` (then rendered as Aggressive).
 */
data class MotorEfficiencySnapshot(
    val motorStats: MotorStats?,
    val throttleStyle: ThrottleStyle?,
)

/** The render-ready Torque Distribution panel — three already-formatted "{value}{unit}" readouts. */
data class TorquePanelData(
    val avgTorque: String,
    val maxTorque: String,
    val highTorqueTime: String,
)

/**
 * The render-ready Throttle Behavior panel: the formatted average-power readout, the [style] (which selects
 * the badge label, variant, and bar color), and the raw power-bar [powerBarValue] / [powerBarMax].
 */
data class ThrottlePanelData(
    val avgPower: String,
    val style: ThrottleStyle,
    val powerBarValue: Double,
    val powerBarMax: Double,
)

/** The render-ready Motor Thermal panel — the two formatted temperature readouts and the [status] verdict. */
data class ThermalPanelData(
    val avgMotorTemp: String,
    val maxMotorTemp: String,
    val status: ThermalStatus,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 * When [hasData] is false every panel slot is `null` and the composable renders each panel's empty state.
 *
 * @property hasData whether a motor-statistics slice exists (web `motorStats != null`).
 * @property torque the Torque Distribution panel data, or `null` when there is no motor data.
 * @property throttle the Throttle Behavior panel data, or `null` when there is no motor data.
 * @property thermal the Motor Thermal panel data, or `null` when there is no motor data.
 */
data class MotorEfficiencyDisplay(
    val hasData: Boolean,
    val torque: TorquePanelData?,
    val throttle: ThrottlePanelData?,
    val thermal: ThermalPanelData?,
)

/**
 * Pure projection from the surface's inputs to its render-ready shapes — a 1:1 port of the derivations the
 * web component performs: the per-panel `motorStats ? … : noData` presence test, the
 * `fmtNumber(value, 1)` + fixed-unit readouts, the `convertTempFromSI` display conversion, the raw-Celsius
 * thermal verdict, and the `throttleStyle ?? Aggressive` fall-through. Stateless and side-effect-free so it
 * is fully covered off-device; the composable only resolves localized strings, glyphs, and accents.
 */
object MotorEfficiencyInsightsProjection {
    /**
     * Maps the panel's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a snapshot carrying motor stats renders [UiPhase.Content], and an
     * absent slice renders [UiPhase.Empty] (the per-panel no-data state). The host's stateful binding can
     * additionally carry refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: MotorEfficiencySnapshot?,
        isLoading: Boolean,
    ): UiState<MotorEfficiencySnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot?.motorStats != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty, data = snapshot)
        }

    /**
     * Project the [snapshot] onto its render-ready [MotorEfficiencyDisplay] for the user's display [prefs]
     * (web `useUnits`). A null motor slice yields the empty display (every panel slot `null`); otherwise each
     * panel is formatted exactly as the web renders it.
     */
    fun project(
        snapshot: MotorEfficiencySnapshot?,
        prefs: UnitPref,
    ): MotorEfficiencyDisplay {
        val stats = snapshot?.motorStats ?: return MotorEfficiencyDisplay(hasData = false, torque = null, throttle = null, thermal = null)
        val locale = resolveDisplayLocale(prefs.locale)
        val tempUnit = prefs.temperature
        return MotorEfficiencyDisplay(
            hasData = true,
            torque =
                TorquePanelData(
                    avgTorque = number(stats.avgTorque, locale) + TORQUE_SUFFIX,
                    maxTorque = number(stats.maxTorque, locale) + TORQUE_SUFFIX,
                    highTorqueTime = number(stats.highTorquePct, locale) + PERCENT_SUFFIX,
                ),
            throttle =
                ThrottlePanelData(
                    avgPower = number(stats.avgPower, locale) + POWER_SUFFIX,
                    style = snapshot.throttleStyle ?: ThrottleStyle.Aggressive,
                    powerBarValue = safe(stats.avgPower),
                    powerBarMax = POWER_BAR_MAX_KW,
                ),
            thermal =
                ThermalPanelData(
                    avgMotorTemp = temperature(stats.avgMotorTemp, tempUnit, locale),
                    maxMotorTemp = temperature(stats.maxMotorTemp, tempUnit, locale),
                    status = thermalStatus(stats.maxMotorTemp),
                ),
        )
    }

    /**
     * The web thermal verdict: `maxMotorTemp < 100 ? Good : maxMotorTemp < 140 ? Warm : Hot`. Reads the RAW
     * SI-Celsius [maxMotorTempCelsius] (the comparison runs before any display conversion, exactly as the
     * web does), so a non-finite reading falls through to [ThermalStatus.Hot] just like the web `NaN < n`.
     */
    fun thermalStatus(maxMotorTempCelsius: Double): ThermalStatus =
        when {
            maxMotorTempCelsius < THERMAL_GOOD_CEILING_C -> ThermalStatus.Good
            maxMotorTempCelsius < THERMAL_WARM_CEILING_C -> ThermalStatus.Warm
            else -> ThermalStatus.Hot
        }

    /**
     * One temperature readout: the web `fmtNumber(toTemperatureDisplay(v), 1) + tempUnit`. Converts raw SI
     * Celsius to the display unit first (so a non-finite input is coerced to 0 by [number] AFTER conversion,
     * matching the web `fmtNumber` -> `safeNumber` order), then appends the degree label with no space.
     */
    private fun temperature(
        celsius: Double,
        unit: TemperatureUnitPref,
        locale: Locale,
    ): String = number(convertTempFromSI(celsius, unit), locale) + unit.label

    /**
     * Coerce a reading to a finite number, returning 0 for a null / NaN / infinite input — a verbatim port
     * of the web `safeNumber(v) = typeof v === 'number' && isFinite(v) ? v : 0` the formatters apply.
     */
    fun safe(value: Double): Double = if (value.isFinite()) value else 0.0

    /**
     * Format a value the way the web `fmtNumber(value, 1)` does:
     * `safeNumber(value).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })`
     * with grouping separators and ECMAScript `halfExpand` rounding (round half away from zero, so
     * 18.25 -> "18.3"). A signed zero is normalized to positive zero so a converted `-0.0` renders "0.0".
     */
    fun number(
        value: Double,
        locale: Locale,
    ): String {
        val coerced = safe(value)
        val normalized = if (coerced == 0.0) 0.0 else coerced
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = READOUT_FRACTION_DIGITS
                maximumFractionDigits = READOUT_FRACTION_DIGITS
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a torque,
 * power, or temperature value, the driving style, or the unit preference — so a diagnostics line can never
 * leak fleet telemetry.
 */
object MotorEfficiencyInsightsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "MotorEfficiencyInsights"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
