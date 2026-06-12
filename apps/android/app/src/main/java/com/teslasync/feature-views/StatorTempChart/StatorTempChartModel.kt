// Pure, framework-free model + projection for the Stator Temperature History chart feature view — the
// native analogue of everything the web component derives before returning JSX
// (web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Drivetrain Health page) maps the loaded
// `/motor` history into `MotorChartDataPoint[]` and passes it down, then this leaf draws three motor
// stator-temperature lines (front, rear-left, rear-right) plus two horizontal `<ReferenceLine>` guides
// (the 60 °C "Normal" and 80 °C "Warm" thresholds), returning `null` when there are one or fewer samples
// (`if (data.length <= 1) return null`).
//
// SI boundary (Phase-48 SI-canonical rule; ADR-013; unit-conversion.instructions.md): the web parent
// pre-converts the stator temperatures to the display unit before handing them down (`toTemperatureDisplay`
// in DrivetrainHealthPage), and the leaf converts only its reference-line thresholds via `useUnits`. The
// native port instead keeps the surface the **single** display boundary: [MotorTempPoint] carries the raw
// SI Celsius readings (the `motor_temp_c_front` / `motor_temp_c_rear` / `inverter_temp_c` motor-pivot
// fields the web parent reads), and this projection converts BOTH the three series AND the two thresholds
// to the user's unit here, with the shared [convertTempFromSI]. Converting everything in one place
// guarantees the data and the guides always share an axis (and honours the SI-on-disk contract). The
// x-axis time label is the host's concern, exactly as in the web (the parent's `formatTime(s.ts)` fills
// `MotorChartDataPoint.time`), so [MotorTempPoint.time] is already a formatted label.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/StatorTempChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statortempchart

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Em dash shown for a missing reading — the web `'—'` / Recharts `connectNulls` gap. */
internal const val EM_DASH: String = "\u2014"

/** "Normal" reference-line threshold in SI Celsius — the web `<ReferenceLine y={toTemperatureDisplay(60)}>`. */
internal const val NORMAL_TEMP_C: Double = 60.0

/** "Warm" reference-line threshold in SI Celsius — the web `<ReferenceLine y={toTemperatureDisplay(80)}>`. */
internal const val WARM_TEMP_C: Double = 80.0

/**
 * Minimum sample count the chart renders — the web `if (data.length <= 1) return null` guard. With one or
 * zero samples a line cannot be drawn, so the surface shows its empty state (native surfaces never hide).
 */
internal const val MIN_POINTS: Int = 2

/** Temperature display precision — the shared lib's `PRECISION_TEMPERATURE` default (one decimal). */
internal const val TEMP_DECIMALS: Int = 1

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object StatorTempChartRegistration {
    /** Stable surface id. */
    const val ID: String = "stator-temp-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "StatorTempChart"
}

/**
 * One motor-history sample reduced to the fields the web `StatorTempChart` reads from its
 * `MotorChartDataPoint` prop — the native mirror of that prop slice. Torque / speed / axle belong to the
 * sibling drivetrain charts (TorqueHistoryChart, …) and are intentionally omitted.
 *
 * @property time the already-formatted x-axis label (web `MotorChartDataPoint.time`, the parent's
 *   `formatTime(s.ts)`); rendered verbatim as the bottom-axis tick.
 * @property statorC front motor stator temperature in **SI degrees Celsius** (web parent's
 *   `s.motor_temp_c_front`); `null` is a gap the line connects across (web `connectNulls`).
 * @property statorRelC rear-left motor stator temperature in SI Celsius (web `s.motor_temp_c_rear`).
 * @property statorRerC rear-right / inverter temperature in SI Celsius (web `s.inverter_temp_c`).
 */
data class MotorTempPoint(
    val time: String,
    val statorC: Double?,
    val statorRelC: Double?,
    val statorRerC: Double?,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the
 * `drivetrain.*` keys the web component resolves via `t(...)`. The lifecycle-chrome strings
 * (empty / error / retry / offline / freshness) are resolved inline at the Compose boundary, not here, so
 * this holder stays a thin content carrier.
 *
 * @property title the panel title (web `drivetrain.statorTempHistory`).
 * @property subtitle the panel subtitle (web `drivetrain.statorTempSub`).
 * @property timeColumn / statorColumn / statorRelColumn / statorRerColumn accessible data-table headers
 *   (web `dataColumns`).
 * @property statorSeries / statorRelSeries / statorRerSeries the line series names (web `<Line name=… />`).
 * @property normalLabel / warmLabel the threshold-guide labels (web `<ReferenceLine label=… />`).
 */
data class StatorTempChartStrings(
    val title: String,
    val subtitle: String,
    val timeColumn: String,
    val statorColumn: String,
    val statorRelColumn: String,
    val statorRerColumn: String,
    val statorSeries: String,
    val statorRelSeries: String,
    val statorRerSeries: String,
    val normalLabel: String,
    val warmLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's `data.map`
 * series plus its two converted `<ReferenceLine>` y-values and the `ChartContainer` `dataColumns`. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host: the composable wraps the
 * three `*Values` lists into `ChartSeries`, adds the two thresholds as constant guide series, feeds
 * [times] to the bottom axis, and renders [tableRows] as the accessible fallback table.
 *
 * @property times the bottom-axis labels (web `MotorChartDataPoint.time`).
 * @property statorValues / statorRelValues / statorRerValues the three series, already converted to the
 *   user's temperature unit (web `d.stator` / `d.statorRel` / `d.statorRer`, the parent's converted temps).
 * @property tableRows one accessible-table row per sample: `[time, stator, statorRel, statorRer]`.
 * @property normalThreshold / warmThreshold the 60 °C / 80 °C guides converted to the user's unit.
 * @property isInsufficient whether there are one or fewer samples (web `data.length <= 1` → renders empty).
 */
data class StatorTempChartProjectionResult(
    val times: List<String>,
    val statorValues: List<Double?>,
    val statorRelValues: List<Double?>,
    val statorRerValues: List<Double?>,
    val tableRows: List<List<String>>,
    val normalThreshold: Double,
    val warmThreshold: Double,
    val isInsufficient: Boolean,
)

/**
 * The pure projection the composable renders — a 1:1 port of the web component's `data.map` series build,
 * its `toTemperatureDisplay` reference-line conversion, and its `ChartContainer` chart/table bindings.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings, palette colors, and freshness chrome.
 */
object StatorTempChartProjection {
    /**
     * Projects [points] into render-ready chart inputs using the user's [tempUnit]. Each sample's three SI
     * Celsius readings are converted to the display unit with [convertTempFromSI] (the single SI→display
     * boundary), the 60 °C / 80 °C thresholds are converted the same way, and one accessible-table row is
     * emitted per sample. Sample order is preserved (the web maps `data` straight through — the parent
     * already ordered the history). [formatValue] formats a converted display reading for the table cells;
     * injecting it keeps the projection locale-deterministic for tests. With [MIN_POINTS] or fewer samples
     * the result is flagged [StatorTempChartProjectionResult.isInsufficient] (web `data.length <= 1`).
     */
    fun project(
        points: List<MotorTempPoint>,
        tempUnit: TemperatureUnitPref,
        formatValue: (value: Double?) -> String,
    ): StatorTempChartProjectionResult {
        val stator = points.map { it.statorC.toDisplay(tempUnit) }
        val statorRel = points.map { it.statorRelC.toDisplay(tempUnit) }
        val statorRer = points.map { it.statorRerC.toDisplay(tempUnit) }
        return StatorTempChartProjectionResult(
            times = points.map { it.time },
            statorValues = stator,
            statorRelValues = statorRel,
            statorRerValues = statorRer,
            tableRows =
                points.indices.map { i ->
                    listOf(points[i].time, formatValue(stator[i]), formatValue(statorRel[i]), formatValue(statorRer[i]))
                },
            normalThreshold = convertTempFromSI(NORMAL_TEMP_C, tempUnit),
            warmThreshold = convertTempFromSI(WARM_TEMP_C, tempUnit),
            isInsufficient = points.size < MIN_POINTS,
        )
    }

    /**
     * Locale-aware one-decimal temperature formatting (e.g. `72.5`) for the threshold legend, the y-axis
     * ticks, and the accessible table — values are already converted to the display unit. A `null` /
     * non-finite reading renders as [EM_DASH] so a sparse series never shows `NaN`.
     */
    fun formatTemp(
        value: Double?,
        locale: Locale = Locale.getDefault(),
    ): String {
        if (value == null || !value.isFinite()) return EM_DASH
        val pattern = "#,##0." + "0".repeat(TEMP_DECIMALS)
        return DecimalFormat(pattern, DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(value)
    }

    /** Convert an SI Celsius reading to the display unit, propagating `null` gaps. */
    private fun Double?.toDisplay(tempUnit: TemperatureUnitPref): Double? = this?.let { convertTempFromSI(it, tempUnit) }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [StatorTempChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a temperature or timestamp — so a diagnostics line can never leak
 * the vehicle's thermal history. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordStatorTempChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to StatorTempChartRegistration.SLUG))
}
