package io.teslasync.android.dashboardwidgets

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.convertEnergyFromSI

/*
 * Framework-free domain + projection for the ChargeHistory dashboard widget — the native port of the
 * data the web `ChargeHistoryWidget` (web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx)
 * computes before it renders JSX. Pure Kotlin (no Android, no Compose, no coroutines) so the vehicle-id
 * resolution, the SI→kWh conversion, the `.map().reverse()` chart shaping, the `hasData` (>1 point)
 * gate and the `Total`/`Avg` stat math are all unit-tested off device.
 */

/** Recent charging sessions fetched for the chart — the web `&limit=10`. */
internal const val RECENT_SESSIONS_LIMIT: Int = 10

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact = size.cols <= 1` branch: a single column drops the title + area chart and shows only the
 * `Total`/`Avg` stat pair (web `WidgetChartSummary compact`), while wider footprints add the title,
 * the freshness header and the energy area chart.
 */
data class ChargeHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`). */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    companion object {
        /** A footprint of one column or fewer is the compact layout. */
        const val COMPACT_MAX_COLS: Int = 1
    }
}

/**
 * One projected summary statistic (web `ChartSummaryStat`): a [label], a pre-formatted [value] and its
 * [unit] symbol. Pure data so the `Total`/`Avg` derivation is asserted directly off device.
 */
data class ChargeStat(
    val label: String,
    val value: String,
    val unit: String,
)

/**
 * The parsed payload backing the widget: the per-session energy-added figures (SI watt-hours, in the
 * API's newest-first order) for the recent charging sessions. The web composes `useVehicles` (for the
 * default vehicle id) with the recent-10 `useQuery`; this snapshot is the native analogue of the
 * resolved charging response. Energy is kept SI here (ADR — SI on the wire and in domain); the kWh
 * conversion is applied in [ChargeHistoryProjection] at the display boundary.
 */
data class ChargeHistorySnapshot(
    val energiesWh: List<Double>,
) {
    /**
     * True when the chart has more than one point (web `hasData = chartData.length > 1`). A single
     * session — or none — is treated as empty, exactly like the web source.
     */
    val hasChartData: Boolean get() = energiesWh.size > MIN_CHART_POINTS

    companion object {
        /** The empty payload (no vehicle / no sessions resolved) — drives the empty state. */
        val EMPTY: ChargeHistorySnapshot = ChargeHistorySnapshot(emptyList())

        /**
         * Projects the recent charging [sessions] into the SI energy series the chart consumes,
         * reading `total_energy_added_wh` with the web `?? 0` tolerance so a partial row never throws.
         */
        fun fromSessions(sessions: List<ChargingSession>): ChargeHistorySnapshot =
            ChargeHistorySnapshot(sessions.map { it.totalEnergyAddedWh ?: 0.0 })

        /** A snapshot has more than [MIN_CHART_POINTS] points before the chart is meaningful. */
        const val MIN_CHART_POINTS: Int = 1
    }
}

/**
 * Resolves the effective vehicle id exactly like the web `id = vehicleId ?? vehicles?.[0]?.id ?? 0`:
 * an [explicitVehicleId] (the widget's configured vehicle) wins when present, otherwise the first
 * enrolled vehicle's id, otherwise `0` (the disabled-query sentinel → empty state).
 */
fun resolveVehicleId(
    explicitVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long = explicitVehicleId ?: vehicles?.firstOrNull()?.id ?: 0L

/**
 * The fully projected, render-ready view of the charge history for one footprint — the native analogue
 * of everything the web component computes via `useMemo` before returning JSX: the compact branch, the
 * `hasData` gate, the reversed kWh chart series with its index x-labels, and the `Total`/`Avg` stats.
 * Pure data so it is unit-tested directly.
 */
data class ChargeHistoryDisplay(
    val isCompact: Boolean,
    val hasData: Boolean,
    val chartValues: List<Double>,
    val xLabels: List<String>,
    val stats: List<ChargeStat>,
)

/**
 * Pure projection from a parsed [ChargeHistorySnapshot] to the display model — the native port of the
 * `chartData` / `hasData` / `stats` `useMemo` work in the web source. Energy is converted to kWh with
 * the shared [convertEnergyFromSI] (the web `convertEnergyFromSI(wh, 'kWh')`), the series + index
 * labels are reversed to match the web `.map((s, i) => …).reverse()`, and the `Total`/`Avg` figures are
 * the sum and mean over every point — only when there is more than one point. Every label is supplied
 * by the caller (resolved through the i18n facade); the unit symbol comes from [EnergyUnitPref.KWH].
 */
object ChargeHistoryProjection {
    private const val ENERGY_DECIMALS: Int = 1

    /** kWh series in chart order (oldest→newest) — the web `convertEnergyFromSI(...).reverse()`. */
    fun chartValues(snapshot: ChargeHistorySnapshot): List<Double> =
        snapshot.energiesWh
            .map { convertEnergyFromSI(it, EnergyUnitPref.KWH) }
            .reversed()

    /** Index x-labels in chart order — the web `i: String(i)` taken before the `.reverse()`. */
    fun xLabels(count: Int): List<String> = (0 until count).map { it.toString() }.reversed()

    /** Project [snapshot] for [size] using the supplied (i18n-resolved) stat [totalLabel]/[avgLabel] + [unit]. */
    fun project(
        snapshot: ChargeHistorySnapshot,
        size: ChargeHistorySize,
        totalLabel: String,
        avgLabel: String,
        unit: String,
    ): ChargeHistoryDisplay {
        val values = chartValues(snapshot)
        val hasData = values.size > ChargeHistorySnapshot.MIN_CHART_POINTS
        val stats =
            if (hasData) {
                val total = values.sum()
                val avg = total / values.size
                listOf(
                    ChargeStat(totalLabel, ChartFormat.number(total, ENERGY_DECIMALS), unit),
                    ChargeStat(avgLabel, ChartFormat.number(avg, ENERGY_DECIMALS), unit),
                )
            } else {
                emptyList()
            }
        return ChargeHistoryDisplay(
            isCompact = size.isCompact,
            hasData = hasData,
            chartValues = values,
            xLabels = xLabels(values.size),
            stats = stats,
        )
    }
}
