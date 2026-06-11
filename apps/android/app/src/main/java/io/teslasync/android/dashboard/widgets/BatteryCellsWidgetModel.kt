package io.teslasync.android.dashboard.widgets

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Per-cell severity the voltage heatmap colours a tile with — the native union of the web
 * `StatusCell['status']` values the shared `WidgetStatusGrid` renders. Derived from how far a
 * cell's voltage deviates from the pack average (web `cellStatus`): ≤5 mV → [Ok], ≤15 mV →
 * [Warning], >15 mV → [Error], missing voltage → [Unknown].
 */
enum class BatteryCellSeverity { Ok, Warning, Error, Unknown }

/**
 * One battery brick reading from `GET /vehicles/{vehicleID}/battery/cells` — the native mirror of
 * the web `BatteryCell` type (web/src/types/energy.ts): identity ([cellId], [module]) plus the
 * measured [voltage] (volts, SI) and [temperature] (°C, SI). Parsing is null-tolerant so a partial
 * body never throws; [voltage] stays `null` when the brick reported none so the heatmap renders the
 * web `'unknown'` status rather than a fabricated value.
 */
data class BatteryCell(
    val cellId: Int,
    val module: Int,
    val voltage: Double?,
    val temperature: Double?,
) {
    companion object {
        /** Project one cell object into a tolerant reading (binds to the web `BatteryCell` contract). */
        fun fromJson(element: JsonElement): BatteryCell {
            val obj = element as? JsonObject ?: return BatteryCell(0, 0, null, null)
            return BatteryCell(
                cellId = obj.numberOrNull("cell_id")?.roundToInt() ?: 0,
                module = obj.numberOrNull("module")?.roundToInt() ?: 0,
                voltage = obj.numberOrNull("voltage"),
                temperature = obj.numberOrNull("temperature"),
            )
        }
    }
}

/**
 * The battery-cell rollup from `GET /vehicles/{vehicleID}/battery/cells` (web `useBatteryCells`,
 * shape `BatteryCellSummary` in web/src/types/energy.ts). Field names mirror the Go API's snake_case
 * JSON tags. All voltages are volts and temperatures °C (SI); they are formatted for display only at
 * projection time and never unit-converted (the web widget shows raw volts / °, matching this).
 */
data class BatteryCellSummary(
    val avgVoltage: Double,
    val minVoltage: Double,
    val maxVoltage: Double,
    val voltageSpread: Double,
    val avgTemperature: Double,
    val minTemperature: Double,
    val maxTemperature: Double,
    val tempSpread: Double,
    val totalCells: Int,
    val cells: List<BatteryCell>,
) {
    companion object {
        /** An all-zero summary with no cells — the projection fallback for a populated-but-empty body. */
        val EMPTY: BatteryCellSummary =
            BatteryCellSummary(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0, emptyList())

        /**
         * Project a `GET /vehicles/{vehicleID}/battery/cells` body into a tolerant summary, or `null`
         * when the body is absent / not an object. Web parity: a present object (even all-zero) keeps
         * `data` truthy → the surface renders with the heatmap's own "No cell data" message; a missing
         * body → the outer "No battery cell data" empty state.
         */
        fun fromJson(element: JsonElement): BatteryCellSummary? {
            val obj = element as? JsonObject ?: return null
            return BatteryCellSummary(
                avgVoltage = obj.numberOrNull("avg_voltage") ?: 0.0,
                minVoltage = obj.numberOrNull("min_voltage") ?: 0.0,
                maxVoltage = obj.numberOrNull("max_voltage") ?: 0.0,
                voltageSpread = obj.numberOrNull("voltage_spread") ?: 0.0,
                avgTemperature = obj.numberOrNull("avg_temperature") ?: 0.0,
                minTemperature = obj.numberOrNull("min_temperature") ?: 0.0,
                maxTemperature = obj.numberOrNull("max_temperature") ?: 0.0,
                tempSpread = obj.numberOrNull("temp_spread") ?: 0.0,
                totalCells = obj.numberOrNull("total_cells")?.roundToInt() ?: 0,
                cells = (obj["cells"] as? JsonArray)?.map(BatteryCell::fromJson) ?: emptyList(),
            )
        }
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` / `isWide` / heatmap-column logic in
 * web/src/features/dashboard/widgets/BatteryCellsWidget.tsx.
 */
data class BatteryCellsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): hide the title, tighten the grid. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): per-cell temperature + a temp row. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    /** Heatmap column count (web `cols={isWide ? 4 : isCompact ? 2 : 3}`). */
    val gridColumns: Int
        get() =
            when {
                isWide -> WIDE_GRID_COLS
                isCompact -> COMPACT_GRID_COLS
                else -> STANDARD_GRID_COLS
            }

    companion object {
        private const val COMPACT_MAX_COLS = 1
        private const val WIDE_MIN_COLS = 3
        private const val COMPACT_GRID_COLS = 2
        private const val STANDARD_GRID_COLS = 3
        private const val WIDE_GRID_COLS = 4

        /** The registry default footprint (2×4). */
        val Default: BatteryCellsSize = BatteryCellsSize(2, 4)

        /** Minimum footprint (2×4) from the web registry. */
        val MinSize: BatteryCellsSize = BatteryCellsSize(2, 4)

        /** Maximum footprint (4×40) from the web registry. */
        val MaxSize: BatteryCellsSize = BatteryCellsSize(4, 40)

        /** True when [size] falls within the min/max footprint constraints. */
        fun withinBounds(size: BatteryCellsSize): Boolean =
            size.cols in MinSize.cols..MaxSize.cols && size.rows in MinSize.rows..MaxSize.rows

        /** Clamp [size] into the supported min/max footprint. */
        fun clamp(size: BatteryCellsSize): BatteryCellsSize =
            BatteryCellsSize(
                cols = size.cols.coerceIn(MinSize.cols, MaxSize.cols),
                rows = size.rows.coerceIn(MinSize.rows, MaxSize.rows),
            )
    }
}

/**
 * One projected, render-ready heatmap tile — the native analogue of a web `StatusCell`. Holds the
 * localized [label], the already-formatted [value], the derived [severity] (the view maps it to a
 * themed status colour) and a TalkBack [contentDescription]. Pure data — no Compose types.
 */
data class BatteryCellTile(
    val id: String,
    val label: String,
    val severity: BatteryCellSeverity,
    val value: String,
    val contentDescription: String,
)

/** One projected stat tile (min/max/avg/spread or per-module temperature) — web `StatCard`. */
data class BatteryCellsStat(
    val label: String,
    val value: String,
)

/**
 * The fully projected, render-ready view of the battery-cell summary for one footprint — the native
 * analogue of everything the web component computes via `useMemo` before returning JSX.
 */
data class BatteryCellsDisplay(
    val isCompact: Boolean,
    val isWide: Boolean,
    val gridColumns: Int,
    val cells: List<BatteryCellTile>,
    val voltageStats: List<BatteryCellsStat>,
    val showTemperature: Boolean,
    val temperatureStats: List<BatteryCellsStat>,
) {
    /** True when the heatmap has at least one cell (web `cells.length > 0`). */
    val hasCells: Boolean get() = cells.isNotEmpty()
}

/**
 * The localized labels the projection needs, resolved from the P1/S10 i18n catalog at the Compose
 * boundary (`stringResource`) and passed in so [BatteryCellsProjection.project] stays pure and
 * JVM-testable. Keys mirror the web `t('widget.batteryCells.*')` calls verbatim.
 */
data class BatteryCellsLabels(
    val cell: String,
    val minV: String,
    val maxV: String,
    val avgV: String,
    val spread: String,
    val minTemp: String,
    val avgTemp: String,
    val maxTemp: String,
)

/**
 * Pure projection from a raw [BatteryCellSummary] to the display model — the native port of the
 * `cellStatus` helper and the `statusCells`/stat `useMemo`s in
 * web/src/features/dashboard/widgets/BatteryCellsWidget.tsx. Voltages/temperatures are already SI
 * and need no conversion (the web widget shows raw volts / °), so this only formats and labels.
 */
object BatteryCellsProjection {
    /** Deviation (mV) at or under which a cell is healthy (web `deviationMv <= 5`). */
    const val OK_THRESHOLD_MV: Double = 5.0

    /** Deviation (mV) at or under which a cell is a warning (web `deviationMv <= 15`). */
    const val WARNING_THRESHOLD_MV: Double = 15.0

    private const val MV_PER_V = 1000.0
    private const val MIDDLE_DOT = "\u00B7"
    private const val DEGREE = "\u00B0"
    private const val VOLTAGE_DECIMALS = 3
    private const val TEMPERATURE_DECIMALS = 1
    private const val SPREAD_DECIMALS = 1

    /**
     * Derive a cell's severity from how far its voltage deviates from the pack average (web
     * `cellStatus`): missing/non-finite voltage → [BatteryCellSeverity.Unknown]; otherwise ≤5 mV →
     * [BatteryCellSeverity.Ok], ≤15 mV → [BatteryCellSeverity.Warning], else [BatteryCellSeverity.Error].
     */
    fun severityFor(
        voltage: Double?,
        avgVoltage: Double,
    ): BatteryCellSeverity {
        if (voltage == null || !voltage.isFinite()) return BatteryCellSeverity.Unknown
        val deviationMv = abs(voltage - avgVoltage) * MV_PER_V
        return when {
            deviationMv <= OK_THRESHOLD_MV -> BatteryCellSeverity.Ok
            deviationMv <= WARNING_THRESHOLD_MV -> BatteryCellSeverity.Warning
            else -> BatteryCellSeverity.Error
        }
    }

    /** Project [summary] for [size] using [labels] for every localized string. */
    fun project(
        summary: BatteryCellSummary,
        size: BatteryCellsSize,
        labels: BatteryCellsLabels,
    ): BatteryCellsDisplay {
        val wide = size.isWide
        val avgV = summary.avgVoltage
        val cells =
            summary.cells.map { cell ->
                val label =
                    if (wide) {
                        "${labels.cell} ${cell.cellId} $MIDDLE_DOT M${cell.module}"
                    } else {
                        "C${cell.cellId}"
                    }
                val value =
                    if (wide) {
                        "${fmt(cell.voltage, VOLTAGE_DECIMALS)} V / ${fmt(cell.temperature, TEMPERATURE_DECIMALS)}$DEGREE"
                    } else {
                        "${fmt(cell.voltage, VOLTAGE_DECIMALS)} V"
                    }
                BatteryCellTile(
                    id = cell.cellId.toString(),
                    label = label,
                    severity = severityFor(cell.voltage, avgV),
                    value = value,
                    contentDescription = "$label, $value",
                )
            }

        val voltageStats =
            listOf(
                BatteryCellsStat(labels.minV, "${fmt(summary.minVoltage, VOLTAGE_DECIMALS)} V"),
                BatteryCellsStat(labels.maxV, "${fmt(summary.maxVoltage, VOLTAGE_DECIMALS)} V"),
                BatteryCellsStat(labels.avgV, "${fmt(avgV, VOLTAGE_DECIMALS)} V"),
                BatteryCellsStat(labels.spread, "${fmt(summary.voltageSpread * MV_PER_V, SPREAD_DECIMALS)} mV"),
            )

        val temperatureStats =
            if (wide) {
                listOf(
                    BatteryCellsStat(labels.minTemp, "${fmt(summary.minTemperature, TEMPERATURE_DECIMALS)}$DEGREE"),
                    BatteryCellsStat(labels.avgTemp, "${fmt(summary.avgTemperature, TEMPERATURE_DECIMALS)}$DEGREE"),
                    BatteryCellsStat(labels.maxTemp, "${fmt(summary.maxTemperature, TEMPERATURE_DECIMALS)}$DEGREE"),
                )
            } else {
                emptyList()
            }

        return BatteryCellsDisplay(
            isCompact = size.isCompact,
            isWide = wide,
            gridColumns = size.gridColumns,
            cells = cells,
            voltageStats = voltageStats,
            showTemperature = wide,
            temperatureStats = temperatureStats,
        )
    }

    /**
     * Format a number exactly as the web `fmtNumber` does: coerce null / NaN / ±∞ to 0 (web
     * `safeNumber`) then render with fixed [decimals] fraction digits. Uses [Locale.US] to match the
     * web default locale and keep the projection deterministic.
     */
    fun fmt(
        value: Double?,
        decimals: Int,
    ): String {
        val safe = value?.takeIf(Double::isFinite) ?: 0.0
        return String.format(Locale.US, "%.${decimals}f", safe)
    }
}

/** Reads a numeric (or numeric-string) property, or `null` when absent / non-numeric. */
private fun JsonObject.numberOrNull(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
