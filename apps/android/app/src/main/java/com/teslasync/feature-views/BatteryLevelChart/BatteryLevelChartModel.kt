// Pure, framework-free model + projection for the Battery-Level-at-Charge-Start chart feature view — the
// native analogue of everything the web surface derives before returning JSX
// (web/src/features/charging/components/charging-list/BatteryLevelChart.tsx, fed by the sibling
// helpers.ts `computeStartLevelDist`). No Compose, no Android, no HTTP: every declaration here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// The web component is purely presentational — its parent computes `computeStartLevelDist(sessions)` and
// passes the resulting `StartLevelBucket[]` (ten fixed 0-10% … 90-100% start-of-charge SoC buckets, each
// with a session count) as the `data` prop; the component then draws one amber bar per bucket. This file
// owns both halves of that contract: [BatteryLevelChartProjection.distribution] mirrors the web
// `computeStartLevelDist` (the client-side bucketing the web parent runs), and
// [BatteryLevelChartProjection.projectBuckets] maps those buckets into the render-ready chart inputs the
// composable consumes (the X-axis range labels, the bar values, and the accessible fallback-table rows).
// Bucket order is the natural ascending 0→90% order the web array builder produces, so the native bars and
// the accessible table read left-to-right in the same order.
//
// SI on the wire, display at the boundary: `startSocPct` is a battery state-of-charge percentage (0-100,
// dimensionless) exactly as the API serves it — there is no unit conversion to do, only bucketing, which
// happens here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BatteryLevelChart — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterylevelchart

import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale
import kotlin.math.floor

/** Number of start-of-charge SoC buckets — the web `Array.from({ length: 10 })`. */
internal const val BUCKET_COUNT: Int = 10

/** Width of each SoC bucket in percentage points — the web `i * 10` / `+ 10` step. */
internal const val BUCKET_WIDTH_PCT: Int = 10

/** Highest bucket index — the web `Math.min(idx, 9)` clamp upper bound. */
internal const val MAX_BUCKET_INDEX: Int = BUCKET_COUNT - 1

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object BatteryLevelChartRegistration {
    /** Stable surface id. */
    const val ID: String = "battery-level-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BatteryLevelChart"
}

/**
 * The subset of a charging session this surface reads — the native mirror of the single web
 * `ChargingSession` field the distribution touches. [startSocPct] is the battery state of charge at the
 * moment charging began, as a 0-100 percentage (web `start_soc_pct`).
 */
data class ChargingSessionStart(
    val startSocPct: Double,
)

/**
 * One start-of-charge SoC bucket — the native mirror of the web `StartLevelBucket`
 * (`{ range: string; count: number }`). [range] is the human-readable band label (e.g. `"0-10%"`) and
 * [count] is how many sessions began in that band (a non-negative integer, so `Long`).
 */
data class StartLevelBucket(
    val range: String,
    val count: Long,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the two
 * `charging.charts.*` keys the web component resolves via `t(...)` plus the accessible table column
 * headers and the bar series name (web `<Bar name="Sessions" />`). The lifecycle-chrome strings
 * (empty / error / retry / offline / freshness) are resolved inline at the Compose boundary, not here, so
 * this holder stays a thin content carrier.
 */
data class BatteryLevelChartStrings(
    val title: String,
    val subtitle: String,
    val rangeColumn: String,
    val sessionsColumn: String,
    val seriesLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the props the web `<BarChart>` +
 * its parent read from the `StartLevelBucket[]`. Pure data (no Compose types) so the projection is
 * unit-tested without a UI host: the composable wraps [values] into a single `ChartSeries`, feeds
 * [xLabels] to the bottom axis, renders [tableRows] as the accessible fallback table, and shows the
 * friendly empty state when [isEmpty] (no session fell into any bucket).
 */
data class BatteryLevelChartProjectionResult(
    val xLabels: List<String>,
    val values: List<Double>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web `computeStartLevelDist`
 * helper and the component's read of its result. Stateless and side-effect-free so it is fully covered by
 * the off-device unit gate.
 */
object BatteryLevelChartProjection {
    /**
     * The bucket index a [startSocPct] falls into — the native mirror of the web
     * `Math.min(Math.floor(start_soc_pct / 10), 9)`. The result is additionally floored at 0 so a
     * malformed negative SoC clamps into the first band instead of throwing (the web indexes an array
     * directly); a 100% start lands in the top `90-100%` band.
     */
    fun bucketIndex(startSocPct: Double): Int = floor(startSocPct / BUCKET_WIDTH_PCT).toInt().coerceIn(0, MAX_BUCKET_INDEX)

    /**
     * Buckets [sessions] into the ten fixed start-of-charge SoC bands — the native mirror of the web
     * `computeStartLevelDist`. Always returns [BUCKET_COUNT] ascending buckets (`0-10%` … `90-100%`),
     * each carrying the number of sessions that began in that band, so the chart's x-axis is stable
     * regardless of how sparse the data is.
     */
    fun distribution(sessions: List<ChargingSessionStart>): List<StartLevelBucket> {
        val counts = LongArray(BUCKET_COUNT)
        for (session in sessions) {
            counts[bucketIndex(session.startSocPct)] += 1L
        }
        return (0 until BUCKET_COUNT).map { index ->
            val low = index * BUCKET_WIDTH_PCT
            StartLevelBucket(range = "$low-${low + BUCKET_WIDTH_PCT}%", count = counts[index])
        }
    }

    /**
     * Projects pre-computed [buckets] into render-ready chart inputs, preserving order. Each bucket
     * contributes one X-axis range label, one bar value (its count), and one accessible-table row
     * (`[range, formatCount(count)]`). [isEmpty] is true only when no bucket holds a session — ten
     * all-zero bars would read as a blank panel, so the surface shows the friendly empty state instead.
     * Injecting [formatCount] keeps this locale-deterministic under test.
     */
    fun projectBuckets(
        buckets: List<StartLevelBucket>,
        formatCount: (count: Long) -> String,
    ): BatteryLevelChartProjectionResult =
        BatteryLevelChartProjectionResult(
            xLabels = buckets.map { it.range },
            // `+ 0.0` widens each Long band count to the chart series' Double value type.
            values = buckets.map { it.count + 0.0 },
            tableRows = buckets.map { listOf(it.range, formatCount(it.count)) },
            isEmpty = buckets.all { it.count == 0L },
        )

    /**
     * Convenience that buckets [sessions] (via [distribution]) and projects the result in one step — the
     * full web data flow (`computeStartLevelDist` → render) the stateful entry binds to the charging feed.
     */
    fun project(
        sessions: List<ChargingSessionStart>,
        formatCount: (count: Long) -> String,
    ): BatteryLevelChartProjectionResult = projectBuckets(distribution(sessions), formatCount)

    /** Locale-grouped integer formatting — the native analogue of the web `fmtInt` (e.g. `1,204`). */
    fun formatCount(
        count: Long,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, "%,d", count)
}

/**
 * Maps a charging-feed [UiState] of raw [ChargingSessionStart]s onto the buckets the surface renders,
 * running [BatteryLevelChartProjection.distribution] over the payload while preserving every lifecycle
 * field (phase, freshness stamp, stale/refreshing flags, error classification). This is how the stateful
 * sessions entry reproduces the web parent's `computeStartLevelDist(sessions)` without losing the
 * cache-then-network contract. A `null` payload (first load / hard error) stays `null`.
 */
fun distributionState(state: UiState<List<ChargingSessionStart>>): UiState<List<StartLevelBucket>> =
    UiState(
        phase = state.phase,
        data = state.data?.let { BatteryLevelChartProjection.distribution(it) },
        fetchedAt = state.fetchedAt,
        stale = state.stale,
        refreshing = state.refreshing,
        errorKind = state.errorKind,
        httpStatus = state.httpStatus,
    )

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [BatteryLevelChartRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordBatteryLevelChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to BatteryLevelChartRegistration.SLUG))
}
