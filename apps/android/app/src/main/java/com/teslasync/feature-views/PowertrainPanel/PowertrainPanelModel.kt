// Pure, framework-free model + projection for the PowertrainPanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/telemetry-panels/PowertrainPanel.tsx). No Compose, no Android
// framework, no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer. The web component receives a `MotorSnapshot` prop and,
// when it is present, renders a shift-state badge, a centered ±300 kW power meter, Front/Rear RPM and
// Front/Rear Torque `MetricCard`s, the peak Motor temperature, the Inverter temperature, and the Regen
// power; when the snapshot is null it renders a friendly "No motor data available" empty state. The readers
// below pull the typed SI fields (`shift_state`, `power_kw`, `motor_rpm_front/rear`, `torque_nm_front/rear`,
// `motor_temp_c_front/rear`, `inverter_temp_c`, `regen_kw`) and narrow each exactly as the web's typed
// contract does (a field that is absent or of the wrong JSON kind reads as missing). The SI→display
// temperature conversion is applied through the shared [UnitFormatter] (web `useUnits().formatTemperature`),
// keeping the SI source unconverted (Phase-48 SI-canonical rule; ADR-013); the power/torque/rpm/regen plain
// numbers are formatted through the shared golden-pinned [ChartFormat.number] at the user's display
// locale + precision (web `fmtNumber` / `fmtInt` globals).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/PowertrainPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ClimatePanel / GForcePanel surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.powertrainpanel

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or any
 * powertrain payload, so a diagnostics line can never leak the vehicle's identity or movement.
 */
const val POWERTRAIN_PANEL_SLUG: String = "PowertrainPanel"

/** Em dash shown for a missing reading — the web `value != null ? … : '—'` fallback and [ChartFormat.EMPTY]. */
internal const val EM_DASH: String = "\u2014"

/**
 * The hard-coded `kW` power unit — the web hard-codes the ` kW` suffix on the power + regen readings
 * (`power_kw` / `regen_kw` are already kilowatts; never converted by `useUnits`), so it is a non-key display
 * literal, exactly as the sibling GForcePanel hard-codes its `g` suffix and the web hard-codes `RPM` / `Nm`.
 */
const val POWER_UNIT: String = "kW"

/** The hard-coded `RPM` subtitle on the two motor-speed cards — the web `subtitle="RPM"` literal. */
const val RPM_UNIT: String = "RPM"

/** The hard-coded `Nm` subtitle on the two torque cards — the web `subtitle="Nm"` literal. */
const val TORQUE_UNIT: String = "Nm"

/** Full-scale magnitude of the centered power meter — the web `/ 300` divisor (±300 kW). */
internal const val POWER_SCALE_MAX_KW: Double = 300.0

/** Peak-motor-temperature threshold above which the reading turns red — the web `> 80` guard (°C, SI). */
internal const val MOTOR_TEMP_HOT_THRESHOLD_C: Double = 80.0

/** Default fraction digits for the power/torque/regen plain numbers — the web `fmtNumber` global default. */
internal const val DEFAULT_NUMBER_DECIMALS: Int = 2

/** RPM is rendered as a whole number — the web `fmtInt` (`fmtNumber(v, 0)`). */
internal const val RPM_DECIMALS: Int = 0

// The typed SI panel fields the web reads off the `MotorSnapshot` prop. Temperatures are °C, power/regen are
// kilowatts, torque is newton-metres, RPM is revolutions per minute; the readers narrow each with the web's
// typed `number | string | null` contract.
private const val FIELD_SHIFT_STATE = "shift_state"
private const val FIELD_POWER_KW = "power_kw"
private const val FIELD_RPM_FRONT = "motor_rpm_front"
private const val FIELD_RPM_REAR = "motor_rpm_rear"
private const val FIELD_TORQUE_FRONT = "torque_nm_front"
private const val FIELD_TORQUE_REAR = "torque_nm_rear"
private const val FIELD_MOTOR_TEMP_FRONT = "motor_temp_c_front"
private const val FIELD_MOTOR_TEMP_REAR = "motor_temp_c_rear"
private const val FIELD_INVERTER_TEMP = "inverter_temp_c"
private const val FIELD_REGEN_KW = "regen_kw"

// The shift-state sentinels the web colors distinctly; anything else (P, null, unknown) is the muted tone.
private const val SHIFT_DRIVE = "D"
private const val SHIFT_REVERSE = "R"
private const val SHIFT_NEUTRAL = "N"

/**
 * Which accent tone the shift-state badge carries — the render layer resolves its color from this. Mirrors
 * the web `shift_state === 'D' ? green : 'R' ? red : 'N' ? amber : muted` ladder.
 */
enum class ShiftTone {
    /** Drive (web `'D'`) — a green badge. */
    Drive,

    /** Reverse (web `'R'`) — a red badge. */
    Reverse,

    /** Neutral (web `'N'`) — an amber badge. */
    Neutral,

    /** Park / unknown / any other state (web else branch) — a muted badge. */
    Other,
}

/**
 * The motor readings this surface consumes — the native mirror of the typed `MotorSnapshot` fields the web
 * component reads. Pure data so the projection stays unit-testable off-device. Temperatures are SI °C
 * (converted to the user's unit only at the render boundary); a `null` means the field was absent or not of
 * its expected JSON kind.
 */
data class MotorReading(
    val shiftState: String?,
    val powerKw: Double?,
    val rpmFront: Double?,
    val rpmRear: Double?,
    val torqueFront: Double?,
    val torqueRear: Double?,
    val motorTempFrontC: Double?,
    val motorTempRearC: Double?,
    val inverterTempC: Double?,
    val regenKw: Double?,
) {
    /**
     * The peak motor temperature in SI °C — the web `Math.max(front ?? -Infinity, rear ?? -Infinity)`. When
     * both axle temps are absent the result is non-finite, so the projection renders the em dash; when one is
     * present the max collapses to that single reading.
     */
    val peakMotorTempC: Double?
        get() =
            if (motorTempFrontC == null && motorTempRearC == null) {
                null
            } else {
                max(
                    motorTempFrontC ?: Double.NEGATIVE_INFINITY,
                    motorTempRearC ?: Double.NEGATIVE_INFINITY,
                )
            }

    companion object {
        /** The all-absent reading used for a non-object snapshot (the web null-prop branch). */
        val EMPTY: MotorReading =
            MotorReading(
                shiftState = null,
                powerKw = null,
                rpmFront = null,
                rpmRear = null,
                torqueFront = null,
                torqueRear = null,
                motorTempFrontC = null,
                motorTempRearC = null,
                inverterTempC = null,
                regenKw = null,
            )
    }
}

/**
 * The fully projected, render-ready view of the motor snapshot — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly. When [hasData] is false the surface renders its empty state (web `motorData == null`); otherwise
 * it renders the shift badge, the power meter, the RPM/torque cards, the temperatures, and the regen reading.
 *
 * @property hasData whether a motor snapshot object was decoded (web `motorData` truthy).
 * @property shiftStateText the shift state, or the localized "Unknown" when absent (web `shift_state ?? t(...)`).
 * @property shiftTone the badge accent for the current shift state (web color ladder).
 * @property powerText the power reading with its ` kW` suffix — `"— kW"` when absent (web `{… : '—'} kW`).
 * @property powerHasValue whether a power reading is present (web `power_kw != null`) — gates the meter fill.
 * @property powerPositive whether power is non-negative (web `power_kw >= 0`) — selects the fill side + color.
 * @property powerFraction the meter fill as a fraction of its half (0..1) — web `min(|power| / 300, 1)`.
 * @property rpmFrontText front motor speed (web `fmtInt`) or the em dash.
 * @property rpmRearText rear motor speed (web `fmtInt`) or the em dash.
 * @property torqueFrontText front axle torque (web `fmtNumber`) or the em dash.
 * @property torqueRearText rear axle torque (web `fmtNumber`) or the em dash.
 * @property motorTempText localized peak motor temperature, or the em dash (web `formatTemperature` / `'—'`).
 * @property motorTempHot whether the peak exceeds the hot threshold (web `> 80`) — turns the reading red.
 * @property inverterTempText localized inverter temperature (web `formatTemperature(inverter_temp_c)`).
 * @property regenText the regen reading with its ` kW` suffix, or the em dash (web `{… ? \`… kW\` : '—'}`).
 */
data class PowertrainPanelDisplay(
    val hasData: Boolean,
    val shiftStateText: String,
    val shiftTone: ShiftTone,
    val powerText: String,
    val powerHasValue: Boolean,
    val powerPositive: Boolean,
    val powerFraction: Float,
    val rpmFrontText: String,
    val rpmRearText: String,
    val torqueFrontText: String,
    val torqueRearText: String,
    val motorTempText: String,
    val motorTempHot: Boolean,
    val inverterTempText: String,
    val regenText: String,
) {
    companion object {
        /** The no-snapshot projection (web `motorData == null`): the surface shows its empty state. */
        fun empty(unknownLabel: String): PowertrainPanelDisplay =
            PowertrainPanelDisplay(
                hasData = false,
                shiftStateText = unknownLabel,
                shiftTone = ShiftTone.Other,
                powerText = "$EM_DASH $POWER_UNIT",
                powerHasValue = false,
                powerPositive = true,
                powerFraction = 0f,
                rpmFrontText = EM_DASH,
                rpmRearText = EM_DASH,
                torqueFrontText = EM_DASH,
                torqueRearText = EM_DASH,
                motorTempText = EM_DASH,
                motorTempHot = false,
                inverterTempText = EM_DASH,
                regenText = EM_DASH,
            )
    }
}

/**
 * The localized strings the panel renders — the native mirror of every `t('…')` call the web component
 * makes, resolved once at the Compose boundary (P1/S10) and passed in so the projection stays framework-free
 * yet fully localized. [snapshotLabel] personalizes the error surface's retry copy.
 */
data class PowertrainPanelStrings(
    val title: String,
    val shiftState: String,
    val unknown: String,
    val power: String,
    val rpmFront: String,
    val rpmRear: String,
    val torqueFront: String,
    val torqueRear: String,
    val motorTemp: String,
    val inverterTemp: String,
    val regen: String,
    val noData: String,
    val snapshotLabel: String = title,
)

/**
 * Pure projection from the motor snapshot to the panel's render state — a 1:1 port of the web component's
 * field reads, null guards, peak-temperature `Math.max`, power-meter math, and shift-state color ladder.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings + the live [UnitFormatter] / display locale + precision and draws what these
 * return.
 */
object PowertrainPanelProjection {
    /**
     * The readings the web derives from the snapshot. The shift state uses the string guard (a numeric field
     * reads as `null`, matching the web's typed contract); every numeric field uses the typed `number` guard
     * (a quoted-string field reads as `null`).
     */
    fun parse(snapshot: JsonElement?): MotorReading {
        val obj = snapshot as? JsonObject ?: return MotorReading.EMPTY
        return MotorReading(
            shiftState = obj.stringOrNull(FIELD_SHIFT_STATE),
            powerKw = obj.numberOrNull(FIELD_POWER_KW),
            rpmFront = obj.numberOrNull(FIELD_RPM_FRONT),
            rpmRear = obj.numberOrNull(FIELD_RPM_REAR),
            torqueFront = obj.numberOrNull(FIELD_TORQUE_FRONT),
            torqueRear = obj.numberOrNull(FIELD_TORQUE_REAR),
            motorTempFrontC = obj.numberOrNull(FIELD_MOTOR_TEMP_FRONT),
            motorTempRearC = obj.numberOrNull(FIELD_MOTOR_TEMP_REAR),
            inverterTempC = obj.numberOrNull(FIELD_INVERTER_TEMP),
            regenKw = obj.numberOrNull(FIELD_REGEN_KW),
        )
    }

    /**
     * True when [snapshot] carries no motor object (web `motorData` falsy) → render the empty state. A
     * present-but-empty object still renders the content body (all em dashes), exactly as the web `motorData ?
     * … : <EmptyState/>` truthy-object gate does. Used by the view-model to classify the cache-then-network
     * feed onto [io.teslasync.android.data.UiPhase.Empty].
     */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /** The shift-badge accent for [shiftState] — the web `'D' → green / 'R' → red / 'N' → amber / else muted`. */
    fun shiftToneOf(shiftState: String?): ShiftTone =
        when (shiftState) {
            SHIFT_DRIVE -> ShiftTone.Drive
            SHIFT_REVERSE -> ShiftTone.Reverse
            SHIFT_NEUTRAL -> ShiftTone.Neutral
            else -> ShiftTone.Other
        }

    /**
     * The power-meter fill as a fraction of its half-track (0..1) — the web `Math.min(|power| / 300, 1)`
     * (the web multiplies by 50 to land a percentage of the full bar; each half is 50%, so the fraction of
     * the half is the un-scaled value). A `null` power yields `0` (no fill is drawn).
     */
    fun powerFraction(powerKw: Double?): Float {
        if (powerKw == null || !powerKw.isFinite()) return 0f
        val fraction = abs(powerKw) / POWER_SCALE_MAX_KW
        return fraction.coerceIn(0.0, 1.0).toFloat()
    }

    /**
     * Projects [snapshot] onto the render-ready [PowertrainPanelDisplay] using [formatter] for the SI→display
     * temperature boundary (web `useUnits().formatTemperature`), [locale] + [precision] for the plain
     * power/torque/regen numbers (web `fmtNumber` globals), and [strings] for every label. A
     * `null`/`JsonNull`/non-object snapshot yields [PowertrainPanelDisplay.empty] (the web null-prop branch);
     * otherwise every field is read + formatted exactly as the web component does.
     */
    fun project(
        snapshot: JsonElement?,
        formatter: UnitFormatter,
        strings: PowertrainPanelStrings,
        locale: Locale,
        precision: Int,
    ): PowertrainPanelDisplay {
        if (snapshot !is JsonObject) return PowertrainPanelDisplay.empty(strings.unknown)
        val reading = parse(snapshot)
        val peak = reading.peakMotorTempC
        val peakShown = peak != null && peak.isFinite()
        return PowertrainPanelDisplay(
            hasData = true,
            shiftStateText = reading.shiftState ?: strings.unknown,
            shiftTone = shiftToneOf(reading.shiftState),
            powerText = "${ChartFormat.number(reading.powerKw, precision, locale)} $POWER_UNIT",
            powerHasValue = reading.powerKw != null,
            powerPositive = (reading.powerKw ?: 0.0) >= 0.0,
            powerFraction = powerFraction(reading.powerKw),
            rpmFrontText = ChartFormat.number(reading.rpmFront, RPM_DECIMALS, locale),
            rpmRearText = ChartFormat.number(reading.rpmRear, RPM_DECIMALS, locale),
            torqueFrontText = ChartFormat.number(reading.torqueFront, precision, locale),
            torqueRearText = ChartFormat.number(reading.torqueRear, precision, locale),
            motorTempText = if (peakShown) formatter.temperature(peak) else EM_DASH,
            motorTempHot = peak != null && peak.isFinite() && peak > MOTOR_TEMP_HOT_THRESHOLD_C,
            inverterTempText = formatter.temperature(reading.inverterTempC),
            regenText =
                if (reading.regenKw != null) {
                    "${ChartFormat.number(reading.regenKw, precision, locale)} $POWER_UNIT"
                } else {
                    EM_DASH
                },
        )
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [POWERTRAIN_PANEL_SLUG] (P1/S11). Carries
 * no powertrain value or vehicle id, so a diagnostics line can never leak fleet telemetry. Kept free of
 * Compose so it is unit-tested with a recording [Logger]; the view-model calls it from the composable's
 * first-composition effect.
 */
fun recordPowertrainPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to POWERTRAIN_PANEL_SLUG))
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to en-US when blank/absent (web `fmtNumber` default). */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/** A JSON number field as a [Double], or `null` when absent or not a JSON number (web typed `number`). */
private fun JsonObject.numberOrNull(key: String): Double? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return if (primitive.isString) null else primitive.doubleOrNull
}

/** A JSON string field, or `null` when absent / not a quoted string (web typed `string`). */
private fun JsonObject.stringOrNull(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
