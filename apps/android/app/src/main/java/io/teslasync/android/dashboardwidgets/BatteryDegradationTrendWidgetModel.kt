package io.teslasync.android.dashboardwidgets

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale

/*
 * Framework-free domain + projection for the BatteryDegradationTrend dashboard widget — the native
 * port of the data the web `BatteryDegradationTrendWidget`
 * (web/src/features/dashboard/widgets/BatteryDegradationTrendWidget.tsx) computes before it renders
 * JSX. Pure Kotlin (no Android, no Compose, no coroutines) so the tolerant JSON parsing, the
 * `current_health_pct ?? current_health` fallback, the `chartData` map, the `stats` `useMemo` and the
 * compact / empty / "needs more data" branches are all unit-tested off device. The only dependency is
 * the framework-free [ChartFormat] number formatter (the Android counterpart of the web `fmtNumber`).
 */

/**
 * One monthly degradation sample from `GET /analytics/battery-degradation` (web `DegradationTrend`).
 * Only the fields the widget reads are projected — the [month] bucket label, the average state of
 * health [avgHealth] (percent) and the average rated range [avgRange]. Reads are null-tolerant so a
 * partial row never throws (web treats them as plain numbers).
 */
data class DegradationTrend(
    val month: String,
    val avgHealth: Double?,
    val avgRange: Double?,
)

/**
 * One render-ready chart row — the native analogue of the flat objects the web builds in its
 * `chartData` `useMemo`: the [month] label, the rated [range], the [health] plotted by the area
 * series, and the [original] (the first sample's range, repeated on every row exactly as the web
 * does). Only [month] + [health] feed the native area chart; [range]/[original] are carried for
 * faithful transform parity (and the accessible data table).
 */
data class DegradationChartPoint(
    val month: String,
    val range: Double?,
    val health: Double?,
    val original: Double?,
)

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` rule, which for this widget is BOTH dimensions at one (`size.cols <= 1 && size.rows <=
 * 1`) — so the registry minimum (1×2) is NOT compact and still shows the chart, while only a 1×1 tile
 * collapses to the stat row.
 */
data class BatteryDegradationSize(
    val cols: Int,
    val rows: Int,
) {
    /** True only at a single cell (web `isCompact = size.cols <= 1 && size.rows <= 1`). */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS && rows <= COMPACT_MAX_ROWS

    companion object {
        /** A footprint of one column or fewer is a compact candidate (web `size.cols <= 1`). */
        const val COMPACT_MAX_COLS: Int = 1

        /** Combined with [COMPACT_MAX_COLS]: only a single-row, single-column tile is compact. */
        const val COMPACT_MAX_ROWS: Int = 1
    }
}

/**
 * The parsed `GET /analytics/battery-degradation` payload backing the widget (web `DegradationData`),
 * reduced to exactly what the surface renders: the predictive [currentHealthPct] with the legacy
 * [currentHealth] fallback, the per-month [degradationRatePctPerMonth], the lifetime [currentCycles],
 * and the [monthlyTrend]. [hasData] distinguishes a fetched payload (even an all-null one) from the
 * absent-body fallback used before anything has loaded.
 *
 * Health is read SI-free (already a percent in this analytics shape); no unit conversion happens here.
 */
data class BatteryDegradationSnapshot(
    val hasData: Boolean,
    val currentHealthPct: Double?,
    val currentHealth: Double?,
    val degradationRatePctPerMonth: Double?,
    val currentCycles: Double?,
    val monthlyTrend: List<DegradationTrend>,
) {
    /** State of health to surface: the predictive percent, falling back to the legacy field (web `??`). */
    val effectiveHealth: Double? get() = currentHealthPct ?: currentHealth

    /**
     * True when there is nothing meaningful to show — no state of health AND no trend (web
     * `isEmpty = currentHealth == null && chartData.length === 0`). Drives the [io.teslasync.android.data.UiPhase.Empty]
     * surface.
     */
    val isEmpty: Boolean get() = effectiveHealth == null && monthlyTrend.isEmpty()

    companion object {
        /** The absent-body fallback (nothing loaded yet) — flagged [hasData] = false. */
        val EMPTY: BatteryDegradationSnapshot =
            BatteryDegradationSnapshot(
                hasData = false,
                currentHealthPct = null,
                currentHealth = null,
                degradationRatePctPerMonth = null,
                currentCycles = null,
                monthlyTrend = emptyList(),
            )

        /** A fetched payload that resolved no degradation analytics (web `data == null` short-circuit). */
        val NO_DATA: BatteryDegradationSnapshot = EMPTY.copy(hasData = true)

        /** Parses a `/analytics/battery-degradation` body into a tolerant snapshot (web destructuring + `safeArray`). */
        fun fromJson(element: JsonElement?): BatteryDegradationSnapshot {
            val obj = element as? JsonObject ?: return NO_DATA
            return BatteryDegradationSnapshot(
                hasData = true,
                currentHealthPct = obj.doubleValue("current_health_pct"),
                currentHealth = obj.doubleValue("current_health"),
                degradationRatePctPerMonth = obj.doubleValue("degradation_rate_pct_per_month"),
                currentCycles = obj.doubleValue("current_cycles"),
                monthlyTrend = parseTrend(obj["monthly_trend"]),
            )
        }

        /** Project a `monthly_trend` JSON array into a tolerant list of [DegradationTrend] (web `safeArray`). */
        fun parseTrend(element: JsonElement?): List<DegradationTrend> =
            (element as? JsonArray)
                ?.mapNotNull { item -> (item as? JsonObject)?.toTrend() }
                ?: emptyList()

        private fun JsonObject.toTrend(): DegradationTrend? {
            val month = stringValue("month") ?: return null
            return DegradationTrend(
                month = month,
                avgHealth = doubleValue("avg_health"),
                avgRange = doubleValue("avg_range"),
            )
        }

        private fun JsonObject.doubleValue(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

        private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }
}

/** One summary stat chip — the native counterpart of the web `ChartSummaryStat` ({label, value, unit?}). */
data class BatteryDegradationStat(
    val label: String,
    val value: String,
    val unit: String? = null,
)

/** Localized labels for the summary stats + axis, resolved by the view from the P1/S10 i18n catalog. */
data class BatteryDegradationLabels(
    val soh: String,
    val degradation: String,
    val cycles: String,
    val perMonth: String,
)

/**
 * The fully projected, render-ready view of the degradation data for one footprint — the native
 * analogue of everything the web component computes before returning JSX: the compact branch, the
 * empty branch, the resolved [currentHealth] / [degradationRate] / [totalCycles], and the
 * newest-untouched-order chart [points]. Pure data so it is unit-tested directly; the derived flags
 * keep the type small.
 */
data class BatteryDegradationDisplay(
    val isCompact: Boolean,
    val isEmpty: Boolean,
    val points: List<DegradationChartPoint>,
    val currentHealth: Double?,
    val degradationRate: Double?,
    val totalCycles: Double?,
) {
    /** Whether the area chart is shown — web renders it only with more than one sample (`chartData.length > 1`). */
    val hasTrend: Boolean get() = points.size > 1

    /** Whether the degradation chip is shown — web pushes it only when the rate is present and positive. */
    val showDegradation: Boolean get() = degradationRate != null && degradationRate > 0.0

    /** The x-axis month labels for the chart, in source order. */
    val monthLabels: List<String> get() = points.map { it.month }

    /** The plotted health series (percent), in source order; nulls bridge gaps at the chart layer. */
    val healthValues: List<Double?> get() = points.map { it.health }
}

/**
 * Pure projection from a parsed [BatteryDegradationSnapshot] to the [BatteryDegradationDisplay] and the
 * summary stat chips — the native port of the web `chartData` + `stats` `useMemo` work plus the
 * compact branch. Percentages are formatted via the framework-free [ChartFormat] (web `fmtNumber`); the
 * em dash / minus-sign / `%` punctuation matches the web verbatim.
 */
object BatteryDegradationProjection {
    /** Decimal places per stat, matching the web `fmtNumber(value, n)` calls. */
    private const val HEALTH_DECIMALS: Int = 1
    private const val RATE_DECIMALS: Int = 2
    private const val CYCLES_DECIMALS: Int = 0

    /** U+2212 MINUS SIGN — the exact glyph the web prefixes the degradation rate with. */
    private const val MINUS_SIGN: String = "\u2212"
    private const val PERCENT: String = "%"

    /** The 80% rated-capacity warranty threshold the web draws as a reference line (see the view a11y note). */
    const val WARRANTY_THRESHOLD_PCT: Double = 80.0

    /** Project [snapshot] for [size] into the render-ready display (web `chartData` + `isCompact` + `isEmpty`). */
    fun project(
        snapshot: BatteryDegradationSnapshot,
        size: BatteryDegradationSize,
    ): BatteryDegradationDisplay {
        val trend = snapshot.monthlyTrend
        val originalRange = trend.firstOrNull()?.avgRange
        val points =
            trend.map { entry ->
                DegradationChartPoint(
                    month = entry.month,
                    range = entry.avgRange,
                    health = entry.avgHealth,
                    original = originalRange,
                )
            }
        return BatteryDegradationDisplay(
            isCompact = size.isCompact,
            isEmpty = snapshot.isEmpty,
            points = points,
            currentHealth = snapshot.effectiveHealth,
            degradationRate = snapshot.degradationRatePctPerMonth,
            totalCycles = snapshot.currentCycles,
        )
    }

    /**
     * Builds the summary stat chips exactly as the web `stats` `useMemo` does: always a SoH chip and a
     * Cycles chip (em dash when absent), with a Degradation chip inserted between them only when the
     * rate is present and positive. [labels] are resolved through the i18n facade; [locale] keeps the
     * number formatting deterministic in tests.
     */
    fun stats(
        display: BatteryDegradationDisplay,
        labels: BatteryDegradationLabels,
        locale: Locale = Locale.getDefault(),
    ): List<BatteryDegradationStat> =
        buildList {
            add(BatteryDegradationStat(label = labels.soh, value = sohValue(display.currentHealth, locale)))
            if (display.showDegradation) {
                add(
                    BatteryDegradationStat(
                        label = labels.degradation,
                        value = degradationValue(requireNotNull(display.degradationRate), locale),
                        unit = "/${labels.perMonth}",
                    ),
                )
            }
            add(BatteryDegradationStat(label = labels.cycles, value = cyclesValue(display.totalCycles, locale)))
        }

    /** SoH chip value: `{health,1}%`, or an em dash when health is absent (web `… ? `${…}%` : '—'`). */
    fun sohValue(
        health: Double?,
        locale: Locale = Locale.getDefault(),
    ): String = if (health == null) ChartFormat.EMPTY else "${ChartFormat.number(health, HEALTH_DECIMALS, locale)}$PERCENT"

    /** Degradation chip value: `−{rate,2}%` (web prefixes a U+2212 minus). Only called when the rate is positive. */
    fun degradationValue(
        rate: Double,
        locale: Locale = Locale.getDefault(),
    ): String = "$MINUS_SIGN${ChartFormat.number(rate, RATE_DECIMALS, locale)}$PERCENT"

    /** Cycles chip value: `{cycles,0}`, or an em dash when absent (web `… ? fmtNumber(…,0) : '—'`). */
    fun cyclesValue(
        cycles: Double?,
        locale: Locale = Locale.getDefault(),
    ): String = if (cycles == null) ChartFormat.EMPTY else ChartFormat.number(cycles, CYCLES_DECIMALS, locale)
}

/**
 * Static registry metadata for the BatteryDegradationTrend surface — the canonical id, category and
 * grid-size constraints from web/src/features/dashboard/widgets/registry/battery.ts. A dashboard host
 * registers the surface with this id and honors these size bounds, mirroring the web registry exactly.
 */
object BatteryDegradationTrendWidgetDescriptor {
    /** Canonical registry id (web `battery-degradation-trend`). */
    const val ID: String = "battery-degradation-trend"

    /** Registry category (web `battery`). */
    const val CATEGORY: String = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SURFACE_SLUG: String = "BatteryDegradationTrendWidget"

    /** Registry default footprint (2×4). */
    val defaultSize: BatteryDegradationSize = BatteryDegradationSize(cols = 2, rows = 4)

    /** Registry minimum footprint (1×2). */
    val minSize: BatteryDegradationSize = BatteryDegradationSize(cols = 1, rows = 2)

    /** Registry maximum footprint (4×40). */
    val maxSize: BatteryDegradationSize = BatteryDegradationSize(cols = 4, rows = 40)
}
