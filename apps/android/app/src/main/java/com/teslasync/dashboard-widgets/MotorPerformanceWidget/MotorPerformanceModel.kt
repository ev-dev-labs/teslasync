// Pure, framework-free model + projection for the Motor Performance dashboard widget — the native
// analogue of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/MotorPerformanceWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. The stator temperature arrives as SI degrees Celsius and is converted
// to the user's display unit here, at the single render-boundary seam (Phase-48 SI-canonical rule; web
// `convertTempFromSI` + `useUnits`). Torque (Nm) and the lateral / longitudinal g-forces are already the
// values the web renders verbatim, so they carry through without conversion.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/MotorPerformanceWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling DriveScoreGauge / Drivetrain
// Health widgets do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.motorperformance

import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale
import kotlin.math.abs

/** Em dash shown for a missing reading — the web `'—'` fallback for an absent temperature / g-force / gear. */
internal const val EM_DASH: String = "\u2014"

// Raw `/motor/latest` (MotorSnapshot) document keys read by the widget — snake_case, served verbatim by
// the Go handler (no camelCaseKeys transform in the shared layer), so the native reads match the wire
// contract, not the web camelCase type.
private const val FIELD_DI_TORQUE = "di_torque"
private const val FIELD_DI_STATOR_TEMP = "di_stator_temp"
private const val FIELD_MOTOR_TEMP_C_FRONT = "motor_temp_c_front"
private const val FIELD_GEAR = "gear"
private const val FIELD_SHIFT_STATE = "shift_state"
private const val FIELD_LATERAL_ACCEL = "lateral_accel"
private const val FIELD_LONGITUDINAL_ACCEL = "longitudinal_accel"

// Torque color-band thresholds — the web `torqueColor(nm)` map applied to |torque|: < 200 green, < 400
// amber, else red. Doubles so the gauge sweep + band share one source of truth.
private const val TORQUE_BAND_MEDIUM_MIN = 200.0
private const val TORQUE_BAND_HIGH_MIN = 400.0

/** Torque renders as a whole number (web `fmtInt(torque)`). */
private const val TORQUE_DECIMALS = 0

/** The stator temperature renders as whole degrees (web `fmtNumber(convertTempFromSI(value), 0)`). */
private const val TEMP_DECIMALS = 0

/** The g-forces render with two decimals (web `fmtNumber(value, 2)`). */
private const val G_DECIMALS = 2

/** The g-force unit suffix (web literal `'g'`). */
internal const val G_UNIT: String = "g"

/**
 * One decoded `/motor/latest` document — the native mirror of the fields the web component reads off the
 * `MotorSnapshot` (web/src/api/types.ts). The field-fallback chains the web applies inline
 * (`di_stator_temp ?? motor_temp_c_front`, `gear ?? shift_state`) are resolved here in [fromJson] so the
 * projection stays a straight render mapping. Numeric torque/g-force fields stay nullable (the web `??`
 * defaults are applied where each is consumed); [gear] stays nullable so the projection can render the
 * em-dash fallback.
 */
data class MotorSnapshot(
    val torque: Double?,
    val statorTempC: Double?,
    val gear: String?,
    val lateralG: Double?,
    val longitudinalG: Double?,
) {
    companion object {
        /**
         * Decode a `/motor/latest` body into a tolerant snapshot, or `null` when the body is absent / not
         * a JSON object (web parity: `/motor/latest` returns `MotorSnapshot | null`, and the `hasData =
         * !!data` gate then renders the "No motor data" empty state). A present object — even one whose
         * fields are all null — decodes to a snapshot so the gauge + stats render with the web `?? 0` /
         * `'—'` fallbacks, mirroring the web `!!data` truthiness check.
         */
        fun fromJson(element: JsonElement?): MotorSnapshot? {
            val obj = element as? JsonObject ?: return null
            return MotorSnapshot(
                torque = obj.doubleField(FIELD_DI_TORQUE),
                statorTempC = obj.doubleField(FIELD_DI_STATOR_TEMP) ?: obj.doubleField(FIELD_MOTOR_TEMP_C_FRONT),
                gear = obj.stringField(FIELD_GEAR) ?: obj.stringField(FIELD_SHIFT_STATE),
                lateralG = obj.doubleField(FIELD_LATERAL_ACCEL),
                longitudinalG = obj.doubleField(FIELD_LONGITUDINAL_ACCEL),
            )
        }
    }
}

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The web
 * component reads `size.cols` to choose the compact (gear + torque text) vs standard (gauge + stat grid)
 * layout, so this type carries the same axis the registry constrains.
 */
data class MotorPerformanceSize(
    val cols: Int,
    val rows: Int,
) {
    /** True when [cols] selects the compact (gear + torque text, no gauge/grid) layout — web `size.cols <= 1`. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val DEFAULT_COLS = 2
        private const val DEFAULT_ROWS = 4
        private const val MIN_COLS = 1
        private const val MIN_ROWS = 2
        private const val MAX_COLS = 4
        private const val MAX_ROWS = 40

        /** Registry default footprint (2×4). */
        val Default: MotorPerformanceSize = MotorPerformanceSize(cols = DEFAULT_COLS, rows = DEFAULT_ROWS)

        /** Registry minimum footprint (1×2). */
        val MinSize: MotorPerformanceSize = MotorPerformanceSize(cols = MIN_COLS, rows = MIN_ROWS)

        /** Registry maximum footprint (4×40). */
        val MaxSize: MotorPerformanceSize = MotorPerformanceSize(cols = MAX_COLS, rows = MAX_ROWS)

        /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
        fun withinBounds(size: MotorPerformanceSize): Boolean = clamp(size) == size

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: MotorPerformanceSize): MotorPerformanceSize =
            MotorPerformanceSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/vehicle.ts (`motor-performance`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object MotorPerformanceRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "motor-performance"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MotorPerformanceWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize: MotorPerformanceSize get() = MotorPerformanceSize.Default

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize: MotorPerformanceSize get() = MotorPerformanceSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize: MotorPerformanceSize get() = MotorPerformanceSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: MotorPerformanceSize): Boolean = MotorPerformanceSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: MotorPerformanceSize): MotorPerformanceSize = MotorPerformanceSize.clamp(size)

    /** True when [size] selects the compact (gear + torque text) layout — web `size.cols <= 1`. */
    fun isCompact(size: MotorPerformanceSize): Boolean = size.isCompact
}

/**
 * The torque magnitude band the gauge arc is colored by — the native analogue of the web `torqueColor`
 * buckets. Mapped to a concrete semantic color at the render boundary (low → success, medium → warning,
 * high → danger) so no hex literal leaks into the view.
 */
enum class TorqueBand {
    /** |torque| < 200 Nm (web green `#10b981`). */
    Low,

    /** 200 ≤ |torque| < 400 Nm (web amber `#f59e0b`). */
    Medium,

    /** |torque| ≥ 400 Nm (web red `#ef4444`). */
    High,
}

/**
 * Localized labels the surface folds into its output (web `t('widget.motorPerformance.*')` calls). The
 * composable builds this from `stringResource`; tests pass a deterministic instance. Keeping i18n out of
 * the projection lets the projection stay a pure, locale-stable function.
 */
data class MotorPerformanceStrings(
    val title: String,
    val gear: String,
    val torque: String,
    val nm: String,
    val statorTemp: String,
    val gearState: String,
    val lateralG: String,
    val longitudinalG: String,
    val noData: String,
)

/** One already-formatted stat-grid tile (web `StatCard`): a [label] over a [value] with an optional [unit]. */
data class MotorStat(
    val label: String,
    val value: String,
    val unit: String?,
)

/**
 * The fully projected, render-ready view of the motor snapshot — the native analogue of everything the web
 * component computes before returning JSX. Pure data (no Compose types) so every branch is unit-tested
 * directly.
 *
 * @property gaugeValue the |torque| (Nm) the gauge sweeps to (web `value={Math.abs(torque)}`).
 * @property torqueText the signed torque as a whole-number string — the gauge label and the compact-layout
 *   torque value (web `fmtInt(torque)`).
 * @property gearText the resolved gear / shift state, or the em-dash fallback (web `gear ?? shift_state ?? '—'`).
 * @property band the color band the gauge arc uses (web `torqueColor(Math.abs(torque))`).
 * @property stats the four stat-grid tiles (Stator Temp, Gear State, Lateral G, Longitudinal G), shown on
 *   the standard footprint (web `!isCompact && <grid>`).
 */
data class MotorPerformanceDisplay(
    val gaugeValue: Double,
    val torqueText: String,
    val gearText: String,
    val band: TorqueBand,
    val stats: List<MotorStat>,
)

/**
 * Pure projection from a decoded [MotorSnapshot] to the render-ready [MotorPerformanceDisplay] — the native
 * port of the inline data derivation in `MotorPerformanceWidget.tsx`. The SI stator temperature is
 * converted at this boundary via [convertTempFromSI]; torque defaults to `0` and gear to the em-dash
 * exactly as the web nullish-coalescing reads do.
 */
object MotorPerformanceProjection {
    /** The fixed gauge scale (web `TORQUE_MAX = 600`). */
    const val TORQUE_MAX: Double = 600.0

    /**
     * Project [snapshot] using the user's [prefs] (temperature unit + locale) and the localized [strings],
     * reproducing the web stat order: Stator Temp, Gear State, Lateral G, Longitudinal G.
     */
    fun project(
        snapshot: MotorSnapshot,
        prefs: UnitPref,
        strings: MotorPerformanceStrings,
    ): MotorPerformanceDisplay {
        val torque = snapshot.torque ?: 0.0
        val gearText = snapshot.gear?.takeIf { it.isNotBlank() } ?: EM_DASH
        return MotorPerformanceDisplay(
            gaugeValue = abs(torque),
            torqueText = formatInt(torque),
            gearText = gearText,
            band = bandFor(abs(torque)),
            stats =
                listOf(
                    statorTempStat(snapshot.statorTempC, prefs, strings.statorTemp),
                    MotorStat(strings.gearState, gearText, unit = null),
                    gStat(snapshot.lateralG, strings.lateralG),
                    gStat(snapshot.longitudinalG, strings.longitudinalG),
                ),
        )
    }

    /** The torque band for [absTorque] (web `torqueColor` thresholds: 200 / 400 applied to |torque|). */
    fun bandFor(absTorque: Double): TorqueBand =
        when {
            absTorque >= TORQUE_BAND_HIGH_MIN -> TorqueBand.High
            absTorque >= TORQUE_BAND_MEDIUM_MIN -> TorqueBand.Medium
            else -> TorqueBand.Low
        }

    /**
     * Locale-stable decimal formatter (web `fmtNumber`): grouped thousands and a fixed number of fraction
     * digits, half-expand rounding. Uses [Locale.US] grouping/decimal symbols so the output is
     * deterministic and matches the web default (en-US) instead of Java's banker's rounding.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
    ): String = groupedFormat(decimals).format(value)

    /** Locale-stable integer formatter (web `fmtInt`). */
    fun formatInt(value: Double): String = groupedFormat(decimals = TORQUE_DECIMALS).format(value)

    private fun statorTempStat(
        celsius: Double?,
        prefs: UnitPref,
        label: String,
    ): MotorStat {
        val finite = celsius?.takeIf { it.isFinite() }
        return if (finite != null) {
            MotorStat(label, formatNumber(convertTempFromSI(finite, prefs.temperature), TEMP_DECIMALS), prefs.temperature.label)
        } else {
            MotorStat(label, EM_DASH, unit = null)
        }
    }

    private fun gStat(
        g: Double?,
        label: String,
    ): MotorStat {
        val finite = g?.takeIf { it.isFinite() }
        return if (finite != null) {
            MotorStat(label, formatNumber(finite, G_DECIMALS), G_UNIT)
        } else {
            MotorStat(label, EM_DASH, unit = null)
        }
    }

    private fun groupedFormat(decimals: Int): DecimalFormat {
        val pattern = if (decimals > 0) "#,##0." + "0".repeat(decimals) else "#,##0"
        return DecimalFormat(pattern, DecimalFormatSymbols(Locale.US)).apply {
            roundingMode = RoundingMode.HALF_UP
        }
    }
}

/** Read a numeric field, or `null` when absent / JSON `null` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
