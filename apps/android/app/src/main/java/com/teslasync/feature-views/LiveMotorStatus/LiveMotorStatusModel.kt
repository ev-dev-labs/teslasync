// Pure, framework-free model + projection for the LiveMotorStatus feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/drivetrain-health/LiveMotorStatus.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// LiveMotorStatus is a presentational surface — the web component takes its `motorLatest` snapshot and the
// `isolationResistance` figure as props from the Drivetrain Health page (which owns the `/motor/latest`
// query and its loading / error / stale / offline handling). So, exactly like the sibling LiveVehicleState /
// DrivingTemperatureStats ports, this surface binds no data fetch; its two web data sources are
// `useTranslation` (the i18n catalog, P1/S10) and `useUnits` (the temperature display preference, P1/S8),
// and the cache-then-network lifecycle states live on the owning page, not here. The two branches the web
// source itself defines are the complete state set this surface renders:
//   • a present `motorLatest` (web `hasData = motorLatest != null`) → the two metric grids, and
//   • an absent `motorLatest` → a friendly empty state ("No live motor telemetry yet"), never a blank box
//     (web `<EmptyState/>`), which doubles as the offline-cached-empty surface.
// A skeleton loading branch is offered behind an opt-in `loading` flag the owning page threads while its
// query is first in flight — the same convention the sibling surfaces use — defaulting to the web's
// no-loading contract.
//
// The web reads a `MotorSnapshot` (web/src/api/types.ts); [MotorLive] mirrors the slice it consumes in
// snake_case (matching the Go JSON tags served verbatim, no camelCaseKeys transform in the shared layer),
// so the projection runs straight off the cached API JSON. Power / regen arrive already in kW (the backend
// `injectDerivedMotorPower` derivation the web renders verbatim); the four temperatures arrive as SI degrees
// Celsius and are converted to the user's display unit here, at the single render-boundary seam
// (Phase-48 SI-canonical rule; web `convertTempFromSI` + `useUnits`). `fmtNumber` mirrors the web global
// precision (the user's `decimal_precision`, default 2) and `fmtInt` the zero-decimal RPM read.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/LiveMotorStatus — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livemotorstatus

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** The em-dash the web renders for any null / absent value (`'—'`). */
internal const val DASH: String = "\u2014"

/** Web `fmtNumber`'s global precision default — the user's `decimal_precision`, 2 when unset. */
internal const val DEFAULT_DECIMAL_PRECISION: Int = 2

/** RPM renders as a whole number (web `fmtInt(motor_rpm_*)`). */
private const val RPM_DECIMALS: Int = 0

/** Power / regen unit suffix (web literal `'kW'`). */
internal const val KW_UNIT: String = "kW"

/** Torque unit suffix (web literal `'Nm'`). */
internal const val NM_UNIT: String = "Nm"

/** Axle-speed unit suffix (web literal `'RPM'`). */
internal const val RPM_UNIT: String = "RPM"

/** HV-isolation unit suffix (web literal `'kΩ'`). */
internal const val ISOLATION_UNIT: String = "k\u03A9"

/** HV-isolation healthy threshold — web `isolationResistance >= 500` → green. */
private const val ISOLATION_GOOD_MIN: Double = 500.0

/** HV-isolation caution threshold — web `isolationResistance >= 100` → amber (else red). */
private const val ISOLATION_WARN_MIN: Double = 100.0

// Raw `/motor/latest` (MotorSnapshot) document keys read by the surface — snake_case, served verbatim by the
// Go handler (no camelCaseKeys transform in the shared layer), so the native reads match the wire contract.
private const val FIELD_SHIFT_STATE = "shift_state"
private const val FIELD_POWER_KW = "power_kw"
private const val FIELD_REGEN_KW = "regen_kw"
private const val FIELD_SOURCE = "source"
private const val FIELD_MOTOR_RPM_FRONT = "motor_rpm_front"
private const val FIELD_MOTOR_RPM_REAR = "motor_rpm_rear"
private const val FIELD_TORQUE_NM_FRONT = "torque_nm_front"
private const val FIELD_TORQUE_NM_REAR = "torque_nm_rear"
private const val FIELD_MOTOR_TEMP_C_FRONT = "motor_temp_c_front"
private const val FIELD_MOTOR_TEMP_C_REAR = "motor_temp_c_rear"
private const val FIELD_INVERTER_TEMP_C = "inverter_temp_c"
private const val FIELD_BATTERY_TEMP_C = "battery_temp_c"

/**
 * The slice of `/motor/latest` this surface reads — the native mirror of the `MotorSnapshot` fields the web
 * `LiveMotorStatus` consumes (web/src/api/types.ts). Field names keep their snake_case wire form so the
 * projection runs directly off the cached API JSON, and every field is nullable because the backend omits a
 * reading whenever the underlying telemetry has not reported (the web reads each as `… != null ? … : '—'`).
 *
 * Power / regen are already kW (the backend `injectDerivedMotorPower` derivation, web `power_kw` / `regen_kw`)
 * and the four temperatures are SI degrees Celsius (converted at the render boundary by the projection); the
 * axle speeds are rpm and the torques newton-metres, both rendered verbatim as the web does.
 */
data class MotorLive(
    val shiftState: String?,
    val powerKw: Double?,
    val regenKw: Double?,
    val source: String?,
    val motorRpmFront: Double?,
    val motorRpmRear: Double?,
    val torqueNmFront: Double?,
    val torqueNmRear: Double?,
    val motorTempCFront: Double?,
    val motorTempCRear: Double?,
    val inverterTempC: Double?,
    val batteryTempC: Double?,
) {
    companion object {
        /**
         * Decode a `/motor/latest` body into a tolerant snapshot, or `null` when the body is absent / not a
         * JSON object — web parity: `motorLatest` is `MotorSnapshot | null` and the `hasData = motorLatest
         * != null` gate then renders the empty state. A present object — even one whose fields are all null —
         * decodes to a snapshot so the grids render with the web `'—'` fallbacks, mirroring the web `!= null`
         * truthiness check on the snapshot itself.
         */
        fun fromJson(element: JsonElement?): MotorLive? {
            val obj = element as? JsonObject ?: return null
            return MotorLive(
                shiftState = obj.stringField(FIELD_SHIFT_STATE),
                powerKw = obj.doubleField(FIELD_POWER_KW),
                regenKw = obj.doubleField(FIELD_REGEN_KW),
                source = obj.stringField(FIELD_SOURCE),
                motorRpmFront = obj.doubleField(FIELD_MOTOR_RPM_FRONT),
                motorRpmRear = obj.doubleField(FIELD_MOTOR_RPM_REAR),
                torqueNmFront = obj.doubleField(FIELD_TORQUE_NM_FRONT),
                torqueNmRear = obj.doubleField(FIELD_TORQUE_NM_REAR),
                motorTempCFront = obj.doubleField(FIELD_MOTOR_TEMP_C_FRONT),
                motorTempCRear = obj.doubleField(FIELD_MOTOR_TEMP_C_REAR),
                inverterTempC = obj.doubleField(FIELD_INVERTER_TEMP_C),
                batteryTempC = obj.doubleField(FIELD_BATTERY_TEMP_C),
            )
        }
    }
}

/**
 * The semantic accent each cell tints with — the native analogue of the web per-element Tailwind color
 * (`text-cyan-400`, `text-purple-400`, …). The render layer resolves each to a design token so no hex
 * literal leaks into the view; [Primary] is the foreground default (web `text-[var(--text-primary)]`) and
 * [Muted] the disabled foreground (web's null HV-isolation tint).
 */
enum class MotorAccent { Cyan, Purple, Green, Amber, Red, Muted, Primary }

/** Stable identity of each summary tile, in the order the web top grid emits them. */
enum class MotorSummaryKey { ShiftState, Power, Regen, Source }

/**
 * One projected summary tile — the web top-grid cell (a label over a bold, accent-colored value). Pure data
 * so the projection is unit-tested without a UI host; the view maps [key] onto its i18n label.
 *
 * @property key the tile identity (drives the label in the view).
 * @property value the already-formatted value, or the em-dash fallback.
 * @property accent the color the value text is tinted with (web `text-{color}-400`).
 */
data class MotorSummaryTile(
    val key: MotorSummaryKey,
    val value: String,
    val accent: MotorAccent,
)

/** Stable identity of each inline metric, in the order the web bottom grid emits them. */
enum class MotorMetricKey {
    RpmFront,
    RpmRear,
    TorqueFront,
    TorqueRear,
    MotorTempFront,
    MotorTempRear,
    InverterTemp,
    BatteryTemp,
    HvIsolation,
}

/**
 * One projected inline metric — the web bottom-grid `InlineMetric` (an accent-colored icon, a label, and a
 * value). Pure data so the projection is unit-tested without a UI host; the view maps [key] onto its i18n
 * label and glyph.
 *
 * @property key the metric identity (drives the label + glyph in the view).
 * @property value the already-formatted value, or the em-dash fallback.
 * @property accent the color the leading icon is tinted with (web `text-{color}-400`); for HV isolation this
 *   is the health-derived color (web's `>= 500` / `>= 100` ternary).
 */
data class MotorMetric(
    val key: MotorMetricKey,
    val value: String,
    val accent: MotorAccent,
)

/**
 * The localized labels this surface resolves once (P1/S10) and hands to the renderer. Keeping the strings
 * injectable lets the stateless content composable be exercised in a UI test without a resources host and
 * keeps the projection free of any English literal.
 */
data class LiveMotorStatusStrings(
    val title: String,
    val shiftState: String,
    val power: String,
    val regen: String,
    val source: String,
    val rpmFront: String,
    val rpmRear: String,
    val torqueFront: String,
    val torqueRear: String,
    val motorTempFront: String,
    val motorTempRear: String,
    val inverterTemp: String,
    val batteryTemp: String,
    val isolationResistance: String,
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
 *   renders the empty state instead of the grids.
 * @property summary the four top-grid tiles (Shift State, Power, Regen, Source); empty when [hasData] is
 *   false.
 * @property metrics the nine bottom-grid inline metrics (front/rear RPM, front/rear torque, four
 *   temperatures, HV isolation); empty when [hasData] is false.
 */
data class LiveMotorStatusDisplay(
    val loading: Boolean,
    val hasData: Boolean,
    val summary: List<MotorSummaryTile>,
    val metrics: List<MotorMetric>,
)

/**
 * Pure projection from the surface's props to its render-ready [LiveMotorStatusDisplay] — a 1:1 port of the
 * derivations the web component performs: the `motorLatest != null` presence gate, the per-field
 * `… != null ? '<value> <unit>' : '—'` formatting, the SI → display temperature conversion, and the
 * HV-isolation color ternary. A null snapshot yields no tiles / metrics (empty state); a present snapshot
 * yields all four tiles and all nine metrics, exactly like the web nullish handling.
 */
object LiveMotorStatusProjection {
    /**
     * Select the render-ready view for the given [motor] snapshot, [isolationResistance], and [loading] flag.
     * [prefs] is the user's display preference (web `useUnits().unitPrefs`: the temperature unit + decimal
     * precision) and [locale] the grouping/separator locale (web `fmtNumber`'s active locale, derived from
     * the same settings document).
     */
    fun project(
        motor: MotorLive?,
        isolationResistance: Double?,
        loading: Boolean,
        prefs: UnitPref,
        locale: Locale,
    ): LiveMotorStatusDisplay {
        if (motor == null) {
            return LiveMotorStatusDisplay(loading = loading, hasData = false, summary = emptyList(), metrics = emptyList())
        }
        val tempUnit = prefs.temperature
        val tempLabel = tempUnit.label
        val precision = (prefs.precision ?: DEFAULT_DECIMAL_PRECISION).coerceAtLeast(0)
        return LiveMotorStatusDisplay(
            loading = loading,
            hasData = true,
            summary =
                listOf(
                    MotorSummaryTile(MotorSummaryKey.ShiftState, motor.shiftState ?: DASH, MotorAccent.Cyan),
                    MotorSummaryTile(MotorSummaryKey.Power, unitText(motor.powerKw, KW_UNIT, precision, locale), MotorAccent.Purple),
                    MotorSummaryTile(MotorSummaryKey.Regen, unitText(motor.regenKw, KW_UNIT, precision, locale), MotorAccent.Green),
                    MotorSummaryTile(MotorSummaryKey.Source, motor.source ?: DASH, MotorAccent.Primary),
                ),
            metrics =
                listOf(
                    MotorMetric(MotorMetricKey.RpmFront, rpmText(motor.motorRpmFront, locale), MotorAccent.Cyan),
                    MotorMetric(MotorMetricKey.RpmRear, rpmText(motor.motorRpmRear, locale), MotorAccent.Purple),
                    MotorMetric(
                        MotorMetricKey.TorqueFront,
                        unitText(motor.torqueNmFront, NM_UNIT, precision, locale),
                        MotorAccent.Cyan,
                    ),
                    MotorMetric(
                        MotorMetricKey.TorqueRear,
                        unitText(motor.torqueNmRear, NM_UNIT, precision, locale),
                        MotorAccent.Purple,
                    ),
                    MotorMetric(
                        MotorMetricKey.MotorTempFront,
                        tempText(motor.motorTempCFront, tempUnit, tempLabel, precision, locale),
                        MotorAccent.Red,
                    ),
                    MotorMetric(
                        MotorMetricKey.MotorTempRear,
                        tempText(motor.motorTempCRear, tempUnit, tempLabel, precision, locale),
                        MotorAccent.Red,
                    ),
                    MotorMetric(
                        MotorMetricKey.InverterTemp,
                        tempText(motor.inverterTempC, tempUnit, tempLabel, precision, locale),
                        MotorAccent.Amber,
                    ),
                    MotorMetric(
                        MotorMetricKey.BatteryTemp,
                        tempText(motor.batteryTempC, tempUnit, tempLabel, precision, locale),
                        MotorAccent.Green,
                    ),
                    MotorMetric(
                        MotorMetricKey.HvIsolation,
                        isolationText(isolationResistance, precision, locale),
                        isolationAccent(isolationResistance),
                    ),
                ),
        )
    }

    /**
     * The HV-isolation icon color — a verbatim port of the web ternary: null / non-positive → muted, `>= 500`
     * → green, `>= 100` → amber, otherwise red.
     */
    fun isolationAccent(isolationResistance: Double?): MotorAccent =
        when {
            isolationResistance == null || isolationResistance <= 0.0 -> MotorAccent.Muted
            isolationResistance >= ISOLATION_GOOD_MIN -> MotorAccent.Green
            isolationResistance >= ISOLATION_WARN_MIN -> MotorAccent.Amber
            else -> MotorAccent.Red
        }

    /**
     * Format a number the way the web `fmtNumber(value, decimals)` does:
     * `Number.toLocaleString(locale, { minimumFractionDigits, maximumFractionDigits })` with grouping
     * separators and ECMAScript `halfExpand` rounding (round half away from zero). A non-finite input is
     * coerced to 0 (web `safeNumber`) and a signed zero normalized to positive zero so a `-0.0` renders "0",
     * matching `Intl.NumberFormat`.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val finite = if (value.isFinite()) value else 0.0
        val normalized = if (finite == 0.0) 0.0 else finite
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }

    /** Web `value != null ? '<fmtNumber(value)> <unit>' : '—'`. */
    private fun unitText(
        value: Double?,
        unit: String,
        precision: Int,
        locale: Locale,
    ): String = if (value != null) "${formatNumber(value, precision, locale)} $unit" else DASH

    /** Web `motor_rpm_* != null ? '<fmtInt(value)> RPM' : '—'`. */
    private fun rpmText(
        value: Double?,
        locale: Locale,
    ): String = if (value != null) "${formatNumber(value, RPM_DECIMALS, locale)} $RPM_UNIT" else DASH

    /** Web `temp != null ? '<fmtNumber(convertTempFromSI(temp))> <tempUnit>' : '—'`. */
    private fun tempText(
        celsius: Double?,
        tempUnit: TemperatureUnitPref,
        tempLabel: String,
        precision: Int,
        locale: Locale,
    ): String =
        if (celsius != null) {
            "${formatNumber(convertTempFromSI(celsius, tempUnit), precision, locale)} $tempLabel"
        } else {
            DASH
        }

    /** Web `isolationResistance != null && isolationResistance > 0 ? '<fmtNumber(value)> kΩ' : '—'`. */
    private fun isolationText(
        isolationResistance: Double?,
        precision: Int,
        locale: Locale,
    ): String =
        if (isolationResistance != null && isolationResistance > 0.0) {
            "${formatNumber(isolationResistance, precision, locale)} $ISOLATION_UNIT"
        } else {
            DASH
        }
}

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a motor
 * reading or the unit preference — so a diagnostics line can never leak fleet telemetry.
 */
object LiveMotorStatusDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "LiveMotorStatus"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Read a numeric field, or `null` when absent / JSON `null` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
