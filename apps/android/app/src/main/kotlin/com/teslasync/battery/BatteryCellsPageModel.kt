// Pure, framework-free model + projections for the BatteryCellsPage battery surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/battery/pages/BatteryCellsPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// UiState projection, the shared-core Resource/units, and kotlinx.serialization), so the composable stays a thin
// render layer and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the decode of the raw `/analytics/battery-cells` JSON envelope
// into a typed [BatteryCellData] (web optional-chaining → null-safe reads); (2) the display-boundary unit derivation
// from the `/settings` document ([BatteryCellsDisplayPrefs], web `useUnits`); and (3) the per-field derivations the
// panels call — the per-cell deviation classification (web `cellColor`), the voltage-distribution histogram (web
// `buildHistogram`), the min/max cell, the voltage-spread trend, and the three battery-health insights (web
// `insights`).
//
// SI-canonical (Phase-48 / unit-conversion.instructions): temperatures are read SI off the wire in Celsius and
// converted ONLY at the display boundary via the shared [convertTempFromSI]/[formatTemperature]; nothing is stored or
// computed in non-SI units. Voltages (V), the imbalance/spread (mV) and cell counts are unit-less scalars rendered
// verbatim, exactly like the web.
//
// Empty-state contract (Honesty Covenant #9 — documented, not silent): the web renders every section with its own
// truthiness guard (e.g. `data?.cells?.length > 0 ? … : <EmptyState/>`). The native surface mirrors that per-section
// — each panel shows its friendly empty-state composable when its slice is missing — and additionally routes a
// wholly-empty payload (no cells, no history, no totals) to UiPhase.Empty via [BatteryCellData.hasData] so the four
// declared data states are genuinely reachable.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics/admin pages do.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.battery.batterycells

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertTempFromSI
import io.teslasync.shared.core.units.formatTemperature
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor

/** Millivolts per volt — the web `* 1000` bridge for the deviation / imbalance / spread figures. */
private const val MILLIVOLTS_PER_VOLT = 1000.0

/** Fahrenheit delta factor — a temperature *spread* scales by 9/5 with no +32 offset (web `temp_spread * 1.8`). */
private const val FAHRENHEIT_DELTA_FACTOR = 1.8

/** Deviation thresholds in mV the web `cellColor` buckets on: < 5 nominal, < 15 slight, else significant. */
private const val DEVIATION_NOMINAL_MV = 5.0
private const val DEVIATION_SLIGHT_MV = 15.0

/** Imbalance thresholds in mV the web `insights` buckets on: > 15 high, > 5 watch, else balanced. */
private const val IMBALANCE_HIGH_MV = 15.0
private const val IMBALANCE_WATCH_MV = 5.0

/** Temperature-spread thresholds in °C the web `insights` buckets on: > 5 high, > 3 watch, else good. */
private const val TEMP_SPREAD_HIGH_C = 5.0
private const val TEMP_SPREAD_WATCH_C = 3.0

/** Histogram bucket bounds (web `buildHistogram`: `max(6, min(12, ceil(cells/4)))`). */
private const val HISTOGRAM_MIN_BUCKETS = 6
private const val HISTOGRAM_MAX_BUCKETS = 12
private const val HISTOGRAM_CELLS_PER_BUCKET = 4
private const val HISTOGRAM_ZERO_RANGE_STEP = 0.001

/** ISO date prefix length (`yyyy-MM-dd`) used as the last-ditch date parse (web date label). */
private const val DATE_PREFIX_LENGTH = 10

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `BatteryCellsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("batteryCells", "/battery-cells", …)`, so the host binds this surface to that destination (and its
 * `/battery-cells` deep link) without the nav module depending on it.
 */
object BatteryCellsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("batteryCells", "/battery-cells", …)`). */
    const val ROUTE_ID: String = "batteryCells"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/battery-cells"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "BatteryCellsPage"
}

/** The health classification of one cell (web `CellReading.status`: `normal | low | high | critical`). */
enum class CellStatus {
    NORMAL,
    LOW,
    HIGH,
    CRITICAL,
    UNKNOWN,
    ;

    companion object {
        /** Folds the wire string onto the enum; an unknown/absent value resolves to [UNKNOWN]. */
        fun fromWire(raw: String?): CellStatus =
            when (raw?.lowercase(Locale.ROOT)) {
                "normal" -> NORMAL
                "low" -> LOW
                "high" -> HIGH
                "critical" -> CRITICAL
                else -> UNKNOWN
            }
    }
}

/**
 * How far a cell deviates from the pack average (web `cellColor`): under 5 mV is [NOMINAL] (green), under 15 mV is
 * [SLIGHT] (amber), else [SIGNIFICANT] (red). Resolved to the theme status palette at the render boundary (ADR-005)
 * rather than the web hex literals.
 */
enum class CellDeviation { NOMINAL, SLIGHT, SIGNIFICANT }

/** The bucket a battery-health insight resolves to — drives both the icon and the status accent at render. */
enum class InsightStatus { GOOD, WARNING, CRITICAL }

/** The voltage-spread insight branch (web `imbalance_mv` thresholds). */
enum class SpreadInsight { BALANCED, WATCH, HIGH }

/** The module-temperature insight branch (web `temp_spread` thresholds). */
enum class TempInsight { GOOD, WATCH, HIGH }

/** The critical-cell insight branch (web `cells.filter(status === 'critical')` count). */
enum class CellsInsight { HEALTHY, CRITICAL }

/**
 * One cell reading — the native mirror of the web `CellReading` (`cell_id`, `voltage`, `delta_from_avg`, `status`).
 * [voltage] and [deltaFromAvg] are volts on the wire; the panels scale the delta to mV at render.
 */
data class CellReading(
    val cellId: Int,
    val voltage: Double,
    val deltaFromAvg: Double,
    val status: CellStatus,
)

/**
 * One historical sample — the native mirror of the web `HistoryPoint` (`timestamp`, `min/max/avg_voltage`,
 * `imbalance_mv`). Voltages are volts; the imbalance is mV; [timestamp] is a nullable ISO instant.
 */
data class HistoryPoint(
    val timestamp: String,
    val minVoltage: Double,
    val maxVoltage: Double,
    val avgVoltage: Double,
    val imbalanceMv: Double,
) {
    /** The peak-to-peak spread in mV (web `(max_voltage - min_voltage) * 1000`). */
    val spreadMv: Double get() = (maxVoltage - minVoltage) * MILLIVOLTS_PER_VOLT
}

/** One histogram bar — a voltage [low]–[high] bucket and the [count] of cells inside it (web `buildHistogram`). */
data class HistogramBucket(
    val low: Double,
    val high: Double,
    val count: Int,
)

/**
 * The decoded `/analytics/battery-cells` payload — the native analogue of the web `BatteryCellData` every panel
 * reads. All numerics are SI/raw on the wire (V, mV, °C, counts); display conversion happens in the formatters below.
 * Missing / JSON-null fields collapse to their zero / empty default, exactly like the web optional-chaining
 * (`data?.x ?? 0`).
 */
data class BatteryCellData(
    val totalCells: Int,
    val avgVoltage: Double,
    val minVoltage: Double,
    val maxVoltage: Double,
    val voltageSpread: Double,
    val imbalanceMv: Double,
    val packVoltage: Double,
    val avgTemperature: Double,
    val minTemperature: Double,
    val maxTemperature: Double,
    val tempSpread: Double,
    val cells: List<CellReading>,
    val history: List<HistoryPoint>,
) {
    /**
     * Whether any meaningful battery-cell data has arrived. A payload with no cells, no history and no totals routes
     * to the friendly empty surface (web's per-section `EmptyState`s) rather than a grid of zeros.
     */
    val hasData: Boolean
        get() = cells.isNotEmpty() || history.isNotEmpty() || totalCells > 0 || packVoltage > 0.0

    /** The lowest-voltage cell (web `cells.reduce((a,b) => a.voltage < b.voltage ? a : b)`), or null when empty. */
    val minCell: CellReading? get() = cells.minByOrNull { it.voltage }

    /** The highest-voltage cell (web `cells.reduce((a,b) => a.voltage > b.voltage ? a : b)`), or null when empty. */
    val maxCell: CellReading? get() = cells.maxByOrNull { it.voltage }

    /** Cells flagged critical (web `cells.filter(c => c.status === 'critical').length`). */
    val criticalCount: Int get() = cells.count { it.status == CellStatus.CRITICAL }

    /** Cells flagged normal (web `cells.filter(c => c.status === 'normal').length`). */
    val normalCount: Int get() = cells.count { it.status == CellStatus.NORMAL }

    /** The voltage-spread insight branch (web `imbalance_mv` thresholds). */
    val spreadInsight: SpreadInsight
        get() =
            when {
                imbalanceMv > IMBALANCE_HIGH_MV -> SpreadInsight.HIGH
                imbalanceMv > IMBALANCE_WATCH_MV -> SpreadInsight.WATCH
                else -> SpreadInsight.BALANCED
            }

    /** The module-temperature insight branch (web `temp_spread` thresholds). */
    val tempInsight: TempInsight
        get() =
            when {
                tempSpread > TEMP_SPREAD_HIGH_C -> TempInsight.HIGH
                tempSpread > TEMP_SPREAD_WATCH_C -> TempInsight.WATCH
                else -> TempInsight.GOOD
            }

    /** The critical-cell insight branch (web critical-count guard). */
    val cellsInsight: CellsInsight
        get() = if (criticalCount > 0) CellsInsight.CRITICAL else CellsInsight.HEALTHY

    /** The voltage-distribution histogram across [HISTOGRAM_MIN_BUCKETS]–[HISTOGRAM_MAX_BUCKETS] buckets. */
    val histogram: List<HistogramBucket> get() = buildHistogram(cells)

    companion object {
        /** The all-zero snapshot, surfaced for a null / non-object payload. */
        val EMPTY: BatteryCellData =
            BatteryCellData(
                totalCells = 0,
                avgVoltage = 0.0,
                minVoltage = 0.0,
                maxVoltage = 0.0,
                voltageSpread = 0.0,
                imbalanceMv = 0.0,
                packVoltage = 0.0,
                avgTemperature = 0.0,
                minTemperature = 0.0,
                maxTemperature = 0.0,
                tempSpread = 0.0,
                cells = emptyList(),
                history = emptyList(),
            )
    }
}

/** Classifies a cell's deviation from the pack [avg] (web `cellColor`): the |Δ|·1000 mV thresholds. */
fun cellDeviation(
    voltage: Double,
    avg: Double,
): CellDeviation {
    val deltaMv = abs(voltage - avg) * MILLIVOLTS_PER_VOLT
    return when {
        deltaMv < DEVIATION_NOMINAL_MV -> CellDeviation.NOMINAL
        deltaMv < DEVIATION_SLIGHT_MV -> CellDeviation.SLIGHT
        else -> CellDeviation.SIGNIFICANT
    }
}

/**
 * Builds the voltage-distribution histogram (web `buildHistogram`). Returns an empty list for no cells; otherwise
 * spreads the cells across `max(6, min(12, ceil(n/4)))` equal buckets between the min and max voltage and counts the
 * membership of each, exactly like the web (including the zero-range `0.001` step guard so a perfectly flat pack still
 * yields buckets).
 */
fun buildHistogram(cells: List<CellReading>): List<HistogramBucket> {
    if (cells.isEmpty()) return emptyList()
    val voltages = cells.map { it.voltage }
    val min = voltages.min()
    val max = voltages.max()
    val range = max - min
    // Integer ceil-div of the web `ceil(cells / 4)`, computed with integer math throughout.
    val rawBuckets = (cells.size + HISTOGRAM_CELLS_PER_BUCKET - 1) / HISTOGRAM_CELLS_PER_BUCKET
    val bucketCount = HISTOGRAM_MIN_BUCKETS.coerceAtLeast(HISTOGRAM_MAX_BUCKETS.coerceAtMost(rawBuckets))
    val step = if (range > 0) range / bucketCount else HISTOGRAM_ZERO_RANGE_STEP
    val counts = IntArray(bucketCount)
    for (v in voltages) {
        val idx = floor((v - min) / step).toInt().coerceIn(0, bucketCount - 1)
        counts[idx] += 1
    }
    return (0 until bucketCount).map { i ->
        HistogramBucket(low = min + i * step, high = min + (i + 1) * step, count = counts[i])
    }
}

/**
 * The user's display preferences this surface needs — the native port of the web `useUnits` reads from the `/settings`
 * document: the temperature [unit] (avg/min/max/spread temperature figures) and the [locale] used for grouped-number +
 * date formatting (web global locale). Voltage / mV / count figures are unit-less and rendered verbatim.
 */
data class BatteryCellsDisplayPrefs(
    val unit: UnitPref,
    val locale: Locale,
) {
    /** The temperature unit's display label (e.g. "°C" / "°F"). */
    val temperatureLabel: String get() = unit.temperature.label

    /** Grouped number in the user's locale (web `fmtNumber(value, decimals)`). */
    fun number(
        value: Double,
        decimals: Int,
    ): String = ChartFormat.number(value, decimals, locale)

    /** SI Celsius → the user's display temperature with its unit (web `formatTemperature(value, { precision })`). */
    fun temperature(
        celsius: Double,
        precision: Int = TEMPERATURE_PRECISION,
    ): String = formatTemperature(celsius, unit, precision)

    /**
     * A temperature *spread* (a delta, web `tempUnit === '°F' ? temp_spread * 1.8 : temp_spread`) formatted with its
     * unit. Unlike an absolute temperature this scales without the +32 offset.
     */
    fun temperatureSpread(
        celsiusDelta: Double,
        precision: Int = TEMPERATURE_PRECISION,
    ): String {
        val value =
            if (unit.temperature == TemperatureUnitPref.FAHRENHEIT) {
                celsiusDelta * FAHRENHEIT_DELTA_FACTOR
            } else {
                celsiusDelta
            }
        return number(value, precision) + temperatureLabel
    }

    /** SI Celsius → the user's display temperature value (no unit), for chart axes / canvas math. */
    fun temperatureValue(celsius: Double): Double = convertTempFromSI(celsius, unit.temperature)

    /**
     * A localized short date for [raw] (web `formatDateTime(ts).split(',')[0]`), used as the chart x-axis label. Falls
     * back to the raw string when [raw] is null / blank / unparseable so a label is never dropped. Accepts an ISO date
     * or date-time.
     */
    fun shortDate(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        val parsed =
            runCatching { OffsetDateTime.parse(raw).toLocalDate() }
                .recoverCatching { LocalDate.parse(raw) }
                .recoverCatching { LocalDate.parse(raw.take(DATE_PREFIX_LENGTH)) }
                .getOrNull() ?: return raw
        return parsed.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.SHORT).withLocale(locale))
    }

    companion object {
        /** Default temperature precision (web `formatTemperature(value, { precision: 1 })`). */
        const val TEMPERATURE_PRECISION = 1

        /** Metric (°C) + en-US defaults used before settings load (matches the web defaults). */
        val DEFAULT: BatteryCellsDisplayPrefs =
            BatteryCellsDisplayPrefs(
                unit = UnitPreferences.fromSettings(null),
                locale = Locale.US,
            )

        /** Resolves the display preferences from the raw `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): BatteryCellsDisplayPrefs {
            val unit = UnitPreferences.fromSettings(settings)
            val locale = unit.locale?.takeIf { it.isNotBlank() }?.let(Locale::forLanguageTag) ?: Locale.US
            return BatteryCellsDisplayPrefs(unit = unit, locale = locale)
        }
    }
}

/**
 * Decodes the raw `/analytics/battery-cells` [json] (snake_case on the wire) into a [BatteryCellData]. A non-object
 * input, a missing field, or a JSON-null field all collapse to zero / empty — reproducing the web optional-chaining
 * (`data?.x ?? 0`). The cell + history arrays are decoded null-safely per element.
 */
fun parseBatteryCellData(json: JsonElement?): BatteryCellData {
    val obj = json as? JsonObject ?: return BatteryCellData.EMPTY
    return BatteryCellData(
        totalCells = obj.int("total_cells"),
        avgVoltage = obj.double("avg_voltage"),
        minVoltage = obj.double("min_voltage"),
        maxVoltage = obj.double("max_voltage"),
        voltageSpread = obj.double("voltage_spread"),
        imbalanceMv = obj.double("imbalance_mv"),
        packVoltage = obj.double("pack_voltage"),
        avgTemperature = obj.double("avg_temperature"),
        minTemperature = obj.double("min_temperature"),
        maxTemperature = obj.double("max_temperature"),
        tempSpread = obj.double("temp_spread"),
        cells = obj.cells(),
        history = obj.history(),
    )
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.int(key: String): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: 0

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.cells(): List<CellReading> =
    (this["cells"] as? JsonArray)
        ?.mapNotNull { (it as? JsonObject)?.toCellReading() }
        ?: emptyList()

private fun JsonObject.toCellReading(): CellReading =
    CellReading(
        cellId = int("cell_id"),
        voltage = double("voltage"),
        deltaFromAvg = double("delta_from_avg"),
        status = CellStatus.fromWire(string("status")),
    )

private fun JsonObject.history(): List<HistoryPoint> =
    (this["history"] as? JsonArray)
        ?.mapNotNull { (it as? JsonObject)?.toHistoryPoint() }
        ?: emptyList()

private fun JsonObject.toHistoryPoint(): HistoryPoint =
    HistoryPoint(
        timestamp = string("timestamp") ?: "",
        minVoltage = double("min_voltage"),
        maxVoltage = double("max_voltage"),
        avgVoltage = double("avg_voltage"),
        imbalanceMv = double("imbalance_mv"),
    )

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → BatteryCellData` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BatteryCellsPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, voltage or temperature payload.
 */
fun recordBatteryCellsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to BatteryCellsPageRegistration.SLUG))
}
