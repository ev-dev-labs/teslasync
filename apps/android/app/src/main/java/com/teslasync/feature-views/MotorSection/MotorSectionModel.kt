// Pure, framework-free model + projection for the MotorSection feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// MotorSection is a presentational surface — the web component takes its `motorData` snapshot as a prop from
// the Vehicle Detail page (which owns the `/motor` query and its loading / error / stale / offline handling).
// So, exactly like the sibling LiveMotorStatus / TirePressureSection ports, this surface binds no data fetch;
// its two web data sources are `useTranslation` (the i18n catalog, P1/S10) and `useUnits` (the temperature
// display preference, P1/S8), and the cache-then-network lifecycle states are projected onto the shared
// [io.teslasync.android.data.UiState] the owning page exposes (P1/S8). The two branches the web source itself
// defines are the data core of that state set:
//   • a present `motorData` (web `motorData ? … : …`) → the eight-tile metric grid, and
//   • an absent `motorData` → a friendly empty state ("No motor data available"), never a blank box
//     (web `<EmptyState/>`), which doubles as the offline-cached-empty surface.
//
// The web reads a `MotorSnapshot` (web/src/api/types.ts); [MotorReadout] mirrors the slice it consumes in
// snake_case (matching the Go JSON tags served verbatim, no camelCaseKeys transform in the shared layer), so
// the projection runs straight off the cached API JSON. Every field is nullable because the backend omits a
// reading whenever the underlying telemetry has not reported (the web reads each as `… != null ? … : '—'`).
// Pack voltage prefers the rear bus then the front (web `vbat_rear ?? vbat_front`); the peak motor temperature
// is the max of the two SI Celsius readings (web `Math.max(front ?? -Infinity, rear ?? -Infinity)`), converted
// to the user's display unit at the single render-boundary seam (Phase-48 SI-canonical rule; web
// `useUnits().formatTemperature`). `fmtNumber` mirrors the web global precision (the user's `decimal_precision`,
// default 2) and `fmtInt` the zero-decimal RPM read; both keep the web locale grouping.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/MotorSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.motorsection

import io.teslasync.shared.core.diagnostics.Logger
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

/** RPM renders as a whole number with no suffix (web `fmtInt(motor_rpm_*)`). */
private const val RPM_DECIMALS: Int = 0

/** Pack-voltage unit suffix (web literal `'V'`). */
internal const val VOLT_UNIT: String = "V"

/** Motor-current unit suffix (web literal `'A'`). */
internal const val AMP_UNIT: String = "A"

/** Torque unit suffix (web literal `'Nm'`). */
internal const val NM_UNIT: String = "Nm"

// Raw `/motor` (MotorSnapshot) document keys read by the surface — snake_case, served verbatim by the Go
// handler (no camelCaseKeys transform in the shared layer), so the native reads match the wire contract.
private const val FIELD_SHIFT_STATE = "shift_state"
private const val FIELD_VBAT_FRONT = "vbat_front"
private const val FIELD_VBAT_REAR = "vbat_rear"
private const val FIELD_MOTOR_CURRENT_FRONT = "motor_current_front"
private const val FIELD_TORQUE_NM_FRONT = "torque_nm_front"
private const val FIELD_TORQUE_NM_REAR = "torque_nm_rear"
private const val FIELD_MOTOR_RPM_FRONT = "motor_rpm_front"
private const val FIELD_MOTOR_RPM_REAR = "motor_rpm_rear"
private const val FIELD_MOTOR_TEMP_C_FRONT = "motor_temp_c_front"
private const val FIELD_MOTOR_TEMP_C_REAR = "motor_temp_c_rear"

/**
 * The slice of `/motor` this surface reads — the native mirror of the `MotorSnapshot` fields the web
 * `MotorSection` consumes (web/src/api/types.ts). Field names keep their snake_case wire form so the projection
 * runs directly off the cached API JSON, and every field is nullable because the backend omits a reading
 * whenever the underlying telemetry has not reported (the web reads each as `… != null ? … : '—'`).
 *
 * The torques are newton-metres and the axle speeds rpm (both rendered verbatim, the web does no conversion);
 * the bus voltages are volts and the motor temperatures SI degrees Celsius (the latter converted to the user's
 * display unit at the projection's [MotorFormatters.temperature] seam, never stored converted).
 *
 * @property shiftState the drive-inverter gear (web `shift_state`), e.g. `"D"` / `"P"`, or `null`.
 * @property vbatFront front HV-bus voltage in volts (web `vbat_front`), or `null`.
 * @property vbatRear rear HV-bus voltage in volts (web `vbat_rear`), or `null`; preferred for the pack tile.
 * @property motorCurrentFront front motor current in amperes (web `motor_current_front`), or `null`.
 * @property torqueNmFront front-axle torque in newton-metres (web `torque_nm_front`), or `null`.
 * @property torqueNmRear rear-axle torque in newton-metres (web `torque_nm_rear`), or `null`.
 * @property motorRpmFront front axle speed in rpm (web `motor_rpm_front`), or `null`.
 * @property motorRpmRear rear axle speed in rpm (web `motor_rpm_rear`), or `null`.
 * @property motorTempCFront front motor temperature in SI degrees Celsius (web `motor_temp_c_front`), or `null`.
 * @property motorTempCRear rear motor temperature in SI degrees Celsius (web `motor_temp_c_rear`), or `null`.
 */
data class MotorReadout(
    val shiftState: String?,
    val vbatFront: Double?,
    val vbatRear: Double?,
    val motorCurrentFront: Double?,
    val torqueNmFront: Double?,
    val torqueNmRear: Double?,
    val motorRpmFront: Double?,
    val motorRpmRear: Double?,
    val motorTempCFront: Double?,
    val motorTempCRear: Double?,
) {
    companion object {
        /**
         * Decode a `/motor` body into a tolerant snapshot, or `null` when the body is absent / not a JSON
         * object — web parity: `motorData` is `MotorSnapshot | null | undefined` and the `motorData ? … : …`
         * gate then renders the empty state. A present object — even one whose fields are all null — decodes to
         * a snapshot so the grid renders with the web `'—'` fallbacks, mirroring the web truthiness check on
         * the snapshot object itself.
         */
        fun fromJson(element: JsonElement?): MotorReadout? {
            val obj = element as? JsonObject ?: return null
            return MotorReadout(
                shiftState = obj.stringField(FIELD_SHIFT_STATE),
                vbatFront = obj.doubleField(FIELD_VBAT_FRONT),
                vbatRear = obj.doubleField(FIELD_VBAT_REAR),
                motorCurrentFront = obj.doubleField(FIELD_MOTOR_CURRENT_FRONT),
                torqueNmFront = obj.doubleField(FIELD_TORQUE_NM_FRONT),
                torqueNmRear = obj.doubleField(FIELD_TORQUE_NM_REAR),
                motorRpmFront = obj.doubleField(FIELD_MOTOR_RPM_FRONT),
                motorRpmRear = obj.doubleField(FIELD_MOTOR_RPM_REAR),
                motorTempCFront = obj.doubleField(FIELD_MOTOR_TEMP_C_FRONT),
                motorTempCRear = obj.doubleField(FIELD_MOTOR_TEMP_C_REAR),
            )
        }
    }
}

/**
 * The semantic accent each metric card tints with — the native analogue of the web `MetricCard color` prop
 * (`"cyan"` / `"purple"` / `"green"`). The render layer resolves each to a design token so no hex literal
 * leaks into the view, and the same three colors the web source uses are the complete set this surface needs.
 */
enum class MotorAccent { Cyan, Purple, Green }

/** Stable identity of each metric tile, in the exact order the web grid emits them. */
enum class MotorTileKey {
    ShiftState,
    PackVoltage,
    MotorCurrentFront,
    TorqueFront,
    TorqueRear,
    RpmFront,
    RpmRear,
    MotorTemp,
}

/**
 * One projected metric tile — the web `<MetricCard>` cell (an accent-tinted icon, a label, and a value). Pure
 * data so the projection is unit-tested without a UI host; the view maps [key] onto its i18n label and glyph.
 *
 * @property key the tile identity (drives the label + glyph in the view).
 * @property value the already-formatted, unit-suffixed value, or the em-dash fallback (web `… : '—'`).
 * @property accent the color the leading icon is tinted with (web `color="cyan" | "purple" | "green"`).
 */
data class MotorTile(
    val key: MotorTileKey,
    val value: String,
    val accent: MotorAccent,
)

/**
 * The injected display formatters the tile projection needs — the native analogue of the web `fmtNumber`
 * (bound to the global precision/locale), `fmtInt`, and `useUnits().formatTemperature`. Injecting them keeps
 * the projection locale/precision/unit deterministic for the off-device tests and free of any Android type.
 *
 * @property number web `fmtNumber(v)` — locale grouping at the user's precision (pack voltage, current, torque).
 * @property integer web `fmtInt(v)` — locale grouping at zero precision (the axle-speed read).
 * @property temperature web `useUnits().formatTemperature(c)` — SI Celsius → the user's display unit + label.
 */
data class MotorFormatters(
    val number: (Double) -> String,
    val integer: (Double) -> String,
    val temperature: (Double) -> String,
)

/**
 * The localized labels this surface resolves once (P1/S10) and hands to the renderer. Keeping the strings
 * injectable lets the stateless content composable be exercised in a UI test without a resources host and keeps
 * the projection free of any English literal.
 */
data class MotorSectionStrings(
    val title: String,
    val shiftState: String,
    val packVoltage: String,
    val motorCurrentFront: String,
    val torqueFront: String,
    val torqueRear: String,
    val rpmFront: String,
    val rpmRear: String,
    val motorTemp: String,
    val noData: String,
)

/**
 * Pure projection from a present [MotorReadout] to the eight render-ready [MotorTile]s — a 1:1 port of the
 * derivations the web component performs inside its `motorData ? (…grid…) : (…empty…)` branch: the pack-voltage
 * `vbat_rear ?? vbat_front` fallback, the per-field `… != null ? '<value> <unit>' : '—'` formatting, the
 * zero-suffix `fmtInt` RPM read, and the peak-temperature `Math.max(front ?? -∞, rear ?? -∞)` + `isFinite`
 * guard with its SI → display conversion. The presence gate (web `motorData != null`) lives one level up, in
 * the composable's [io.teslasync.android.data.UiState] switch, so this is only ever called with a snapshot and
 * always returns all eight tiles — exactly like the web, which renders every card (each with its own `'—'`
 * fallback) whenever the snapshot is present.
 */
object MotorSectionProjection {
    /**
     * Projects [readout] into the eight ordered tiles, formatting each value with [formatters]. Pure: no
     * Compose, no Android, no I/O — every tile is fully determined by its inputs.
     */
    fun project(
        readout: MotorReadout,
        formatters: MotorFormatters,
    ): List<MotorTile> {
        val vbat = readout.vbatRear ?: readout.vbatFront
        val peakTemp = peakMotorTemp(readout)
        return listOf(
            MotorTile(MotorTileKey.ShiftState, readout.shiftState ?: DASH, MotorAccent.Cyan),
            MotorTile(MotorTileKey.PackVoltage, unitText(vbat, VOLT_UNIT, formatters.number), MotorAccent.Purple),
            MotorTile(
                MotorTileKey.MotorCurrentFront,
                unitText(readout.motorCurrentFront, AMP_UNIT, formatters.number),
                MotorAccent.Green,
            ),
            MotorTile(
                MotorTileKey.TorqueFront,
                unitText(readout.torqueNmFront, NM_UNIT, formatters.number),
                MotorAccent.Cyan,
            ),
            MotorTile(
                MotorTileKey.TorqueRear,
                unitText(readout.torqueNmRear, NM_UNIT, formatters.number),
                MotorAccent.Purple,
            ),
            MotorTile(MotorTileKey.RpmFront, intText(readout.motorRpmFront, formatters.integer), MotorAccent.Cyan),
            MotorTile(MotorTileKey.RpmRear, intText(readout.motorRpmRear, formatters.integer), MotorAccent.Purple),
            MotorTile(MotorTileKey.MotorTemp, tempText(peakTemp, formatters.temperature), MotorAccent.Green),
        )
    }

    /**
     * The peak motor temperature in SI degrees Celsius — the web `Math.max(motor_temp_c_front ?? -Infinity,
     * motor_temp_c_rear ?? -Infinity)`. Returns `Double.NEGATIVE_INFINITY` when both readings are absent, so the
     * tile's [tempText] `isFinite` guard renders the web `'—'` fallback; otherwise the larger of the present
     * readings (a single present reading wins over the absent one's `-Infinity`).
     */
    fun peakMotorTemp(readout: MotorReadout): Double {
        val front = readout.motorTempCFront ?: Double.NEGATIVE_INFINITY
        val rear = readout.motorTempCRear ?: Double.NEGATIVE_INFINITY
        return maxOf(front, rear)
    }

    /** Web `value != null ? '<fmtNumber(value)> <unit>' : '—'`. */
    private fun unitText(
        value: Double?,
        unit: String,
        number: (Double) -> String,
    ): String = if (value != null) "${number(value)} $unit" else DASH

    /** Web `motor_rpm_* != null ? '<fmtInt(value)>' : '—'` — a whole number with no unit suffix. */
    private fun intText(
        value: Double?,
        integer: (Double) -> String,
    ): String = if (value != null) integer(value) else DASH

    /** Web `maxMotorTemp != null && isFinite(maxMotorTemp) ? formatTemperature(maxMotorTemp) : '—'`. */
    private fun tempText(
        peakCelsius: Double,
        temperature: (Double) -> String,
    ): String = if (peakCelsius.isFinite()) temperature(peakCelsius) else DASH
}

/**
 * Locale-aware number formatting that reproduces the web `numberFormat` helpers (`fmtNumber` / `fmtInt`,
 * web/src/lib/numberFormat.ts) the tiles use. Pure (JVM-tested): a non-finite value is coerced to 0 exactly as
 * the web `safeNumber`, a signed zero is normalized to positive zero so `-0.0` renders "0" like
 * `Intl.NumberFormat`, and grouping/precision follow `NumberFormat` with equal min/max fraction digits
 * (`HALF_UP` matches ECMAScript `halfExpand`). The composable binds these into a [MotorFormatters] from the
 * live unit prefs.
 */
object MotorSectionFormat {
    private const val MAX_PRECISION: Int = 20

    /** Web `fmtNumber(v, decimals)` — `safeNumber` then locale grouping at [precision] fraction digits. */
    fun number(
        value: Double,
        precision: Int,
        locale: Locale,
    ): String {
        val finite = if (value.isFinite()) value else 0.0
        val normalized = if (finite == 0.0) 0.0 else finite
        val digits = precision.coerceIn(0, MAX_PRECISION)
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = digits
                maximumFractionDigits = digits
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }

    /** Web `fmtInt(v)` = `fmtNumber(v, 0)` — a grouped whole number. */
    fun integer(
        value: Double,
        locale: Locale,
    ): String = number(value, RPM_DECIMALS, locale)
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
object MotorSectionDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "MotorSection"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Read a numeric field, or `null` when absent / JSON `null` / not a JSON number (web typed `number | null`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string (web typed `string | null`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
