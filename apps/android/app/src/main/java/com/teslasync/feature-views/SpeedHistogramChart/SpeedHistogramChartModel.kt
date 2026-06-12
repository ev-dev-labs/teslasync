// Pure, framework-free model + projection for the Speed Histogram chart feature view — the native
// analogue of everything the web component renders from its prop before returning JSX
// (web/src/features/driving/components/drive-detail/SpeedHistogramChart.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is purely presentational — its parent (the Drive Detail page's `useDriveDetailData`
// memo) buckets the per-sample speeds into fixed ranges, drops empty buckets, and converts each surviving
// bucket's share into an integer percent (`Math.round((count / total) * 100)`), then passes the resulting
// `SpeedHistogramBucket[]` (`{ range: string; pct: number }`) down. This file owns the parts the web
// `SpeedHistogramChart` itself derives from that prop: the single `pct` bar series, the per-bucket X-axis
// `range` labels, and the accessible fallback table rows (web `dataColumns` → `[range, pct]`). The bucket
// order is preserved exactly as received (the parent emits ascending speed ranges and the web data table
// maps in array order), so the native categorical bar chart and its table read left-to-right identically.
//
// The bucket `range` labels arrive already formatted in the user's display unit (the parent builds them
// with the locale number formatter + an en-dash, e.g. `0–20` / `120+`); this surface is presentational, so
// it renders them verbatim and never re-derives bucket edges or speed units.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SpeedHistogramChart — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.speedhistogramchart

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SpeedHistogramChartRegistration {
    /** Stable surface id. */
    const val ID: String = "speed-histogram-chart"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SpeedHistogramChart"
}

/**
 * One speed-distribution bucket — the native mirror of the web `SpeedHistogramBucket`
 * (`{ range: string; pct: number }`). [range] is the already-localized bucket label (the chart X label,
 * e.g. `0–20` or `120+`), and [pct] is that bucket's share of the drive as a percent (the web parent's
 * `Math.round((count / total) * 100)`, so a non-negative whole number in `[0, 100]`, carried as `Double`
 * to match the web `number` and to defend against a host that has not pre-rounded).
 */
data class SpeedHistogramBucket(
    val range: String,
    val pct: Double,
)

/**
 * The already-localized chart microcopy the composable reads from the i18n catalog (P1/S10) — the
 * `driveDetail.*` keys the web component resolves via `t(...)`. The lifecycle-chrome strings
 * (empty / error / retry / offline / freshness) are resolved inline at the Compose boundary, not here, so
 * this holder stays a thin content carrier.
 *
 * @property title the panel title (web `driveDetail.speedHistogram`).
 * @property ariaLabel the chart's screen-reader description (web `driveDetail.speedHistogram.aria`, which
 *   collides with the title leaf in the i18next tree and is therefore carried as the non-colliding sibling
 *   catalog key `driveDetail.speedHistogramAria` — the same resolution the sibling `SpeedTrendChart` uses).
 * @property rangeColumn the accessible-table speed-range header (web `driveDetail.col.range`).
 * @property pctColumn the accessible-table percent header (web `driveDetail.col.pct`).
 * @property seriesLabel the bar's tooltip series name (web `` `% ${t('driveDetail.ofDrive')}` `` → `% of drive`).
 */
data class SpeedHistogramChartStrings(
    val title: String,
    val ariaLabel: String,
    val rangeColumn: String,
    val pctColumn: String,
    val seriesLabel: String,
)

/**
 * The fully projected, render-ready chart inputs — the native analogue of the web component's chart
 * `data`/`dataColumns` props. Pure data (no Compose types) so the projection is unit-tested without a UI
 * host: the composable wraps [values] into a single bar `ChartSeries`, feeds [xLabels] to the chart's
 * bottom axis, and renders [tableRows] as the accessible fallback table (`Speed range`, `% of drive`).
 */
data class SpeedHistogramChartProjectionResult(
    val xLabels: List<String>,
    val values: List<Double>,
    val tableRows: List<List<String>>,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's prop-to-chart
 * binding. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the
 * composable only resolves localized strings, the bar color, and the freshness chrome.
 */
object SpeedHistogramChartProjection {
    /**
     * Projects the loaded [buckets] into render-ready chart inputs, preserving the received order. Each
     * bucket contributes one X-axis label (its `range`), one bar value (its `pct`), and one accessible-table
     * row (`[range, formatPct(pct)]`, mirroring the web `dataColumns` where the range column is the raw
     * label and the percent column is the formatted share). Injecting [formatPct] keeps this function
     * locale-deterministic for tests.
     */
    fun project(
        buckets: List<SpeedHistogramBucket>,
        formatPct: (pct: Double) -> String,
    ): SpeedHistogramChartProjectionResult =
        SpeedHistogramChartProjectionResult(
            xLabels = buckets.map { it.range },
            values = buckets.map { it.pct },
            tableRows = buckets.map { listOf(it.range, formatPct(it.pct)) },
            isEmpty = buckets.isEmpty(),
        )

    /**
     * Locale-grouped whole-percent formatting (e.g. `42`, `1,000`) for the Y-axis ticks and the accessible
     * table — the analogue of the web rendering the parent's already-`Math.round`-ed integer `pct`. Renders
     * with no fraction digits, half-up, so a defensively-unrounded host value still reads as a whole percent
     * exactly as the web column does. The `% of drive` framing lives in the column header and series name,
     * never appended to the value, matching the web (its cells/ticks are bare numbers).
     */
    fun formatPct(
        pct: Double,
        locale: Locale = Locale.getDefault(),
    ): String =
        DecimalFormat("#,##0", DecimalFormatSymbols(locale))
            .apply { roundingMode = RoundingMode.HALF_UP }
            .format(pct)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SpeedHistogramChartRegistration.SLUG]
 * (P1/S11). Carries only the slug — never a speed, bucket, or percentage — so a diagnostics line can never
 * leak the drive's speed profile. Kept free of Compose so it is unit-tested with a recording [Logger]; the
 * composable calls it from its first-composition effect.
 */
fun recordSpeedHistogramChartOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SpeedHistogramChartRegistration.SLUG))
}
