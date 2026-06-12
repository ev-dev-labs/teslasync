// Pure, framework-free model + projection for the *driving-dynamics* LiveMotorStatus feature view — the
// native analogue of everything the web component derives before returning JSX
// (web/src/features/driving/components/driving-dynamics/LiveMotorStatus.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer (the same split the sibling drivetrain-health LiveMotorStatus port and
// the HeroGauges family established).
//
// ── Surface-name collision (read before editing) ───────────────────────────────────────────────────
// The web tree has TWO distinct components named `LiveMotorStatus`, one per driving sub-feature, both mapped
// to the one native surface directory com/teslasync/feature-views/LiveMotorStatus:
//   • features/driving/components/drivetrain-health/LiveMotorStatus.tsx → P3 prompt A-0157 (summary tiles +
//     nine inline metrics; `drivetrain.*` i18n; `useTranslation` + `useUnits`)              — SHIPPED
//   • features/driving/components/driving-dynamics/LiveMotorStatus.tsx  → P3 prompt A-0170 (this file: three
//     RadialGauges + a shift-state Badge; `dynamics.*` i18n; `useTranslation`)
// A-0157 already occupies package `io.teslasync.android.featureviews.livemotorstatus` with the public name
// `LiveMotorStatus`; this driving-dynamics port lives in the `.drivingdynamics` sub-package with
// `DrivingDynamics`-prefixed names. Both surfaces coexist — A-0157 is a committed predecessor and is left
// untouched (honesty covenant #7, no predecessor bypass). This port deliberately REUSES the predecessor's
// shared, public surface assets — the [MotorLive] snapshot model (both web surfaces read the same
// `MotorSnapshot`), [LiveMotorStatusProjection.formatNumber] (the web `fmtNumber` port), and the Cog glyph —
// rather than duplicating them (DRY).
//
// ── Web parity ─────────────────────────────────────────────────────────────────────────────────────
// The web component is purely presentational: the owning Driving-Dynamics page owns the `/motor/latest`
// query and threads its `motorLatest` snapshot (plus the temperature display preference) in as props. So,
// exactly like the sibling drivetrain-health port, this surface binds no data fetch; its only web data
// source is `useTranslation` (the i18n catalog, P1/S10), and the cache-then-network lifecycle states
// (loading / error / stale / offline) live on the owning page. The two branches the web source itself
// defines are the complete state set this surface renders:
//   • a present `motorLatest` (web `motorLatest != null`) → the four-cell grid (Torque / Front RPM / Motor
//     temperature RadialGauges + the Shift-State Badge), and
//   • an absent `motorLatest` → a friendly empty state ("Awaiting live motor data"), never a blank box (web
//     `<EmptyState/>`), which doubles as the offline-cached-empty surface.
// A skeleton loading branch is offered behind an opt-in `loading` flag the owning page threads while its
// query is first in flight — the same convention the sibling surfaces use — defaulting to the web's
// no-loading contract.
//
// The three gauge values are the web derivations verbatim: torque is `(torque_nm_front ?? 0) +
// (torque_nm_rear ?? 0)` over a 1000 Nm axis, front RPM is `motor_rpm_front ?? 0` over an 18000 RPM axis,
// and the motor temperature is `max(motor_temp_c_front ?? -Inf, motor_temp_c_rear ?? -Inf)` — SI degrees
// Celsius — converted to the user's display unit at this single render-boundary seam (Phase-48 SI-canonical
// rule; web `toTemperatureDisplay`) over a 200° axis, falling back to the "Awaiting data" caption when no
// temperature has reported. Each gauge's centered value renders at the web RadialGauge's
// `Number.isInteger(clamped) ? 0 : getGlobalPrecision()` fraction-digit rule; the caption below it reproduces
// the web `fmtNumber` calls (the user precision for torque, zero digits for RPM, one digit for temperature).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveMotorStatus — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livemotorstatus.drivingdynamics

import io.teslasync.android.featureviews.livemotorstatus.LiveMotorStatusProjection
import io.teslasync.android.featureviews.livemotorstatus.MotorLive
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max

/** Torque gauge axis ceiling — the web `<RadialGauge max={1000}>` (newton-metres). */
private const val TORQUE_GAUGE_MAX: Double = 1000.0

/** Front-RPM gauge axis ceiling — the web `<RadialGauge max={18000}>`. */
private const val RPM_GAUGE_MAX: Double = 18000.0

/** Motor-temperature gauge axis ceiling — the web `<RadialGauge max={200}>` (display degrees). */
private const val TEMP_GAUGE_MAX: Double = 200.0

/** Torque unit suffix — the web literal `unit="Nm"`. */
internal const val NM_UNIT: String = "Nm"

/** Front-RPM unit suffix — the web literal `unit="RPM"`. */
internal const val RPM_UNIT: String = "RPM"

/** Front-RPM caption precision — the web `fmtNumber(rpmFront, 0)`. */
private const val RPM_CAPTION_DECIMALS: Int = 0

/** Motor-temperature caption precision — the web `fmtNumber(toTemperatureDisplay(motorTempC), 1)`. */
private const val TEMP_CAPTION_DECIMALS: Int = 1

/** Web `fmtNumber`'s global precision default — the user's `decimal_precision`, 2 when unset. */
private const val DEFAULT_DECIMAL_PRECISION: Int = 2

/** The shift-state value the web styles as a `success` badge (`shift_state === 'D'`); all others are neutral. */
private const val DRIVE_SHIFT_STATE: String = "D"

/**
 * Which design-token accent a gauge carries (the web `<RadialGauge color>` hex), resolved to a Color in the
 * composable so no hex literal leaks into the view. [Torque] is the web blue `#3b82f6`, [Rpm] the purple
 * `#a855f7`, and [Temp] the amber `#f59e0b`.
 */
enum class MotorGaugeAccent { Torque, Rpm, Temp }

/**
 * One fully resolved radial gauge — the native analogue of a single web `<RadialGauge>` invocation plus its
 * caption span. Pure data (no Compose types) so the whole projection is asserted off-device.
 *
 * @property label the localized gauge label (web `label={t('dynamics.*')}`).
 * @property value the centered display value, already clamped to `[0, max]` exactly as the web RadialGauge
 *   clamps it, so the shared Android RadialGauge renders it verbatim at [decimals] digits.
 * @property max the gauge denominator — the web `max={...}`.
 * @property unit the unit suffix shown beside the centered value (web `unit={...}`).
 * @property decimals the centered value's fraction-digit count — the web RadialGauge
 *   `Number.isInteger(clamped) ? 0 : getGlobalPrecision()` rule.
 * @property caption the pre-formatted caption shown below the gauge — the web `<span>` (the raw, un-clamped
 *   value at the web caption precision, or the "Awaiting data" string for an absent temperature).
 * @property accent the design-token accent slot.
 */
data class MotorGauge(
    val label: String,
    val value: Double,
    val max: Double,
    val unit: String,
    val decimals: Int,
    val caption: String,
    val accent: MotorGaugeAccent,
)

/**
 * The shift-state tile — the web fourth cell: a Badge (gear glyph + the shift state) over a "Shift State"
 * caption. Pure data; the view maps [isDrive] onto the success/neutral badge variant.
 *
 * @property label the localized "Shift State" caption (web `t('dynamics.shiftState')`).
 * @property value the gear state itself, or the localized "Unknown" fallback (web `shift_state ??
 *   t('dynamics.unknown')`).
 * @property isDrive whether the gear is Drive (web `shift_state === 'D'`); selects the success badge variant,
 *   otherwise neutral.
 */
data class MotorShiftTile(
    val label: String,
    val value: String,
    val isDrive: Boolean,
)

/**
 * The localized strings this surface resolves once (P1/S10) and threads through the projection + view.
 * Keeping them injectable lets the stateless content composable be exercised in a UI test without a resources
 * host and keeps the projection free of any English literal. Keys map 1:1 to the web `t('dynamics.*')` calls
 * (plus the shared `a11y.loading` for the skeleton announcement).
 *
 * @property title web `dynamics.liveMotor` ("Live Motor Status").
 * @property torque web `dynamics.torque` ("Torque").
 * @property rpmFront web `dynamics.rpmFront` ("Front RPM").
 * @property motorTemp web `dynamics.motorTemp` ("Motor").
 * @property shiftState web `dynamics.shiftState` ("Shift State").
 * @property awaiting web `dynamics.awaiting` ("Awaiting data") — the absent-temperature caption.
 * @property unknown web `dynamics.unknown` ("Unknown") — the absent shift-state value.
 * @property noData web `dynamics.noLiveMotor` ("Awaiting live motor data") — the empty-state message.
 * @property loadingLabel shared `a11y.loading` ("Loading") — the skeleton's TalkBack announcement.
 */
data class DrivingDynamicsLiveMotorStatusStrings(
    val title: String,
    val torque: String,
    val rpmFront: String,
    val motorTemp: String,
    val shiftState: String,
    val awaiting: String,
    val unknown: String,
    val noData: String,
    val loadingLabel: String,
)

/**
 * The fully projected, render-ready view — everything the web component computes before returning JSX. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host and each per-state instance
 * doubles as the surface's snapshot.
 *
 * @property loading whether the owning query is still in flight; the surface renders skeleton chrome while
 *   true (the opt-in branch the owning page threads; default false is the web's no-loading contract).
 * @property hasData whether a motor snapshot is present (web `motorLatest != null`); when false the surface
 *   renders the empty state instead of the grid.
 * @property gauges the three RadialGauges (Torque, Front RPM, Motor temperature), in web order; empty when
 *   [hasData] is false.
 * @property shift the Shift-State tile, or `null` when [hasData] is false.
 */
data class DrivingDynamicsLiveMotorStatusDisplay(
    val loading: Boolean,
    val hasData: Boolean,
    val gauges: List<MotorGauge>,
    val shift: MotorShiftTile?,
)

/**
 * Pure projection from the surface's props to its render-ready [DrivingDynamicsLiveMotorStatusDisplay] — a
 * 1:1 port of the derivations the web component performs: the `motorLatest != null` presence gate, the
 * torque sum, the front-RPM read, the SI → display temperature conversion (with the "Awaiting data"
 * fallback), each gauge's clamp + fraction-digit rule, and the shift-state success/neutral selection. A null
 * snapshot yields no gauges (empty state); a present snapshot yields the three gauges and the shift tile,
 * exactly like the web nullish handling.
 */
object DrivingDynamicsLiveMotorStatusProjection {
    /**
     * Selects the render-ready view for the given [motor] snapshot, the localized [strings], the user display
     * [prefs] (web `useUnits().unitPrefs`: the temperature unit + decimal precision, the native binding of the
     * `toTemperatureDisplay` / `tempUnit` props the owning page threads in), the grouping/separator [locale]
     * (web `fmtNumber`'s active locale), and the [loading] flag.
     */
    fun project(
        motor: MotorLive?,
        strings: DrivingDynamicsLiveMotorStatusStrings,
        prefs: UnitPref,
        locale: Locale,
        loading: Boolean,
    ): DrivingDynamicsLiveMotorStatusDisplay {
        if (motor == null) {
            return DrivingDynamicsLiveMotorStatusDisplay(loading = loading, hasData = false, gauges = emptyList(), shift = null)
        }
        val precision = (prefs.precision ?: DEFAULT_DECIMAL_PRECISION).coerceAtLeast(0)
        return DrivingDynamicsLiveMotorStatusDisplay(
            loading = loading,
            hasData = true,
            gauges =
                listOf(
                    torqueGauge(motor, strings, precision, locale),
                    rpmGauge(motor, strings, precision, locale),
                    tempGauge(motor, strings, prefs.temperature, precision, locale),
                ),
            shift = shiftTile(motor, strings),
        )
    }

    /** Torque gauge — web `(torque_nm_front ?? 0) + (torque_nm_rear ?? 0)` over a 1000 Nm axis. */
    private fun torqueGauge(
        motor: MotorLive,
        strings: DrivingDynamicsLiveMotorStatusStrings,
        precision: Int,
        locale: Locale,
    ): MotorGauge {
        val total = (motor.torqueNmFront ?: 0.0) + (motor.torqueNmRear ?: 0.0)
        val clamped = clampForGauge(total, TORQUE_GAUGE_MAX)
        return MotorGauge(
            label = strings.torque,
            value = clamped,
            max = TORQUE_GAUGE_MAX,
            unit = NM_UNIT,
            decimals = decimalsFor(clamped, precision),
            caption = "${LiveMotorStatusProjection.formatNumber(total, precision, locale)} $NM_UNIT",
            accent = MotorGaugeAccent.Torque,
        )
    }

    /** Front-RPM gauge — web `motor_rpm_front ?? 0` over an 18000 RPM axis. */
    private fun rpmGauge(
        motor: MotorLive,
        strings: DrivingDynamicsLiveMotorStatusStrings,
        precision: Int,
        locale: Locale,
    ): MotorGauge {
        val rpm = motor.motorRpmFront ?: 0.0
        val clamped = clampForGauge(rpm, RPM_GAUGE_MAX)
        return MotorGauge(
            label = strings.rpmFront,
            value = clamped,
            max = RPM_GAUGE_MAX,
            unit = RPM_UNIT,
            decimals = decimalsFor(clamped, precision),
            caption = "${LiveMotorStatusProjection.formatNumber(rpm, RPM_CAPTION_DECIMALS, locale)} $RPM_UNIT",
            accent = MotorGaugeAccent.Rpm,
        )
    }

    /**
     * Motor-temperature gauge — web `max(motor_temp_c_front ?? -Inf, motor_temp_c_rear ?? -Inf)`, converted
     * from SI Celsius to the display unit over a 200° axis. When neither temperature has reported the value
     * is the web `0` and the caption is the localized "Awaiting data".
     */
    private fun tempGauge(
        motor: MotorLive,
        strings: DrivingDynamicsLiveMotorStatusStrings,
        tempUnit: TemperatureUnitPref,
        precision: Int,
        locale: Locale,
    ): MotorGauge {
        val tempLabel = tempUnit.label
        val celsius = max(motor.motorTempCFront ?: Double.NEGATIVE_INFINITY, motor.motorTempCRear ?: Double.NEGATIVE_INFINITY)
        val hasTemp = celsius.isFinite()
        val display = if (hasTemp) convertTempFromSI(celsius, tempUnit) else 0.0
        val caption =
            if (hasTemp) {
                "${LiveMotorStatusProjection.formatNumber(display, TEMP_CAPTION_DECIMALS, locale)}$tempLabel"
            } else {
                strings.awaiting
            }
        val clamped = clampForGauge(display, TEMP_GAUGE_MAX)
        return MotorGauge(
            label = strings.motorTemp,
            value = clamped,
            max = TEMP_GAUGE_MAX,
            unit = tempLabel,
            decimals = decimalsFor(clamped, precision),
            caption = caption,
            accent = MotorGaugeAccent.Temp,
        )
    }

    /** Shift-state tile — web `<Badge variant={shift === 'D' ? 'success' : 'neutral'}>` with the gear glyph. */
    private fun shiftTile(
        motor: MotorLive,
        strings: DrivingDynamicsLiveMotorStatusStrings,
    ): MotorShiftTile {
        val shift = motor.shiftState
        return MotorShiftTile(
            label = strings.shiftState,
            value = shift ?: strings.unknown,
            isDrive = shift == DRIVE_SHIFT_STATE,
        )
    }

    /**
     * Clamps a gauge's raw value into its `[0, max]` track exactly as the web RadialGauge does
     * (`Math.max(0, Math.min(value, max))`), coercing a non-finite value to 0 so the arc never renders `NaN`.
     */
    private fun clampForGauge(
        rawValue: Double,
        max: Double,
    ): Double = if (rawValue.isFinite()) rawValue.coerceIn(0.0, max) else 0.0

    /** Web RadialGauge `decimals ?? (Number.isInteger(clamped) ? 0 : getGlobalPrecision())`. */
    private fun decimalsFor(
        clamped: Double,
        precision: Int,
    ): Int = if (clamped == floor(clamped)) 0 else precision
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a torque,
 * RPM, temperature, or shift reading — so a diagnostics line can never leak fleet telemetry.
 */
object DrivingDynamicsLiveMotorStatusDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (the prompt's surface slug). */
    const val SLUG: String = "LiveMotorStatus"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
