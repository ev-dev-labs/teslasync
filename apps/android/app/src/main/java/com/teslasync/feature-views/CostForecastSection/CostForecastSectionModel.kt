// Pure, framework-free model + projection for the Cost-Forecast feature view — the native analogue of
// everything the web component reads from its prop before returning JSX
// (web/src/features/charging/components/cost-analysis/CostForecastSection.tsx). No Compose, no Android, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer.
//
// The web component is purely presentational. Its parent (the Cost Analysis page) computes a
// `CostForecastData` and passes it down; the component reads two slices of it:
//   1. The composed forecast chart — a combined month axis of the `historical` rows (an `actual`-cost area)
//      followed by the `forecast` rows (a `Projected Cost` line plus a stacked `95% Confidence` band built
//      from `cost_low`/`cost_high`). It renders only when there are >= 3 historical months AND at least one
//      forecast month, otherwise a friendly empty state ("need at least 3 months").
//   2. The cost-per-kWh trend — a line over the `historical` rows' `cost_per_kwh`. It renders only when there
//      is more than one historical month, otherwise a friendly empty state ("need at least 2 months").
// The sibling `ForecastDetails` block the web component also composes (breakdown / savings / insights) is a
// SEPARATE surface with its own prompt (A-0113), so this file owns only the two reads above.
//
// This file owns exactly those reads: [project] turns the data into the combined forecast x-axis, its three
// plotted series (actual / 95%-confidence / projected), the trend x-axis and its single series, and the two
// screen-reader-honest fallback tables, preserving the received row order so chart, table, and legend agree.
// Because the shared cartesian renderer exposes a single value axis and fills areas from the baseline (it
// cannot stack a floating band), the `95% Confidence` series carries the upper bound while the exact low and
// high stay available — and screen-reader honest — through the forecast fallback table's Low/High columns.
//
// Display formatting (currency-prefixed amounts) is injected through [CostForecastChartFormatters] so the
// projection stays locale-deterministic under test; the composable supplies the localized implementations.
// No English literal is hard-coded in logic — every label is resolved at the render boundary from the
// P1/S10 catalog.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/CostForecastSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.costforecastsection

import io.teslasync.shared.core.diagnostics.Logger

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object CostForecastSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "cost-forecast-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "CostForecastSection"
}

/** The minimum historical months the web requires before drawing the composed forecast chart. */
const val MIN_FORECAST_HISTORY: Int = 3

/** The minimum historical months the web requires before drawing the cost-per-kWh trend line. */
const val MIN_TREND_HISTORY: Int = 2

/** The em dash shown for an absent table cell (a row that has no value for that column). */
const val CELL_EMPTY: String = "\u2014"

/**
 * One realized historical month — the native mirror of a web `CostHistoricalMonth` element, narrowed to the
 * fields this surface reads. [month] is the x-axis category label, [cost] is the realized charging cost (the
 * forecast chart's `actual` area), and [costPerKwh] is the blended price (the trend line's sample).
 */
data class CostForecastHistoricalPoint(
    val month: String,
    val cost: Double,
    val costPerKwh: Double,
)

/**
 * One projected month — the native mirror of a web `CostForecastMonth` element, narrowed to the fields this
 * surface reads. [month] is the x-axis category label, [cost] is the projected charging cost (the `Projected
 * Cost` line), and [costLow]/[costHigh] are the 95% confidence bounds.
 */
data class CostForecastProjectedPoint(
    val month: String,
    val cost: Double,
    val costLow: Double,
    val costHigh: Double,
)

/**
 * The slice of the web `CostForecastData` this surface renders: the [historical] and [forecast] rows. The
 * breakdown / gas-comparison / insights the web type also carries belong to the sibling `ForecastDetails`
 * surface (prompt A-0113) and are intentionally out of this surface's scope.
 */
data class CostForecastSectionData(
    val historical: List<CostForecastHistoricalPoint>,
    val forecast: List<CostForecastProjectedPoint>,
) {
    companion object {
        /** The no-data value — both reads resolve to their friendly empty states. */
        val EMPTY: CostForecastSectionData = CostForecastSectionData(emptyList(), emptyList())
    }
}

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10) — every
 * `costAnalysis.forecast.*` key the web component resolves via `t(...)`, plus the generic column headers the
 * native fallback tables need. The lifecycle-chrome strings (error / retry / offline / freshness) are
 * resolved inline at the Compose boundary, so this holder stays a thin content carrier.
 */
data class CostForecastSectionStrings(
    val forecastTitle: String,
    val trendTitle: String,
    val actualLabel: String,
    val confidenceLabel: String,
    val projectedLabel: String,
    val costPerKwhLabel: String,
    val needDataMessage: String,
    val needTrendDataMessage: String,
    val monthHeader: String,
    val lowHeader: String,
    val highHeader: String,
)

/**
 * The locale-bound formatters the projection injects so it stays deterministic and UI-free under test (the
 * native analogue of the currency-formatted values the web tooltip renders). [cost] formats a charging
 * amount (the actual / projected / low / high cells), [costPerKwh] formats a blended price (the trend cells).
 * Both must already include any currency symbol the display preference applies.
 */
data class CostForecastChartFormatters(
    val cost: (Double) -> String,
    val costPerKwh: (Double) -> String,
)

/**
 * The fully projected, render-ready inputs — the native analogue of the two prop reads the web component
 * performs. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * Forecast chart: the composable wraps [actualValues] into an area series, [confidenceHighValues] into the
 * `95% Confidence` area, and [projectedValues] into the projected line, feeding [forecastXLabels] to the
 * bottom axis and [forecastTableRows] to the fallback table; it draws the chart only when [hasForecast].
 * Trend chart: [costPerKwhValues] becomes a line over [trendXLabels] with [trendTableRows] as its table,
 * drawn only when [hasCostPerKwhTrend]. Series values are nullable to carry gaps (the Android `connectNulls`)
 * so the historical-only and forecast-only series plot on the right half of the shared month axis; a
 * non-finite input becomes `null` so a malformed row never plots `NaN`.
 */
data class CostForecastProjectionResult(
    val forecastXLabels: List<String>,
    val actualValues: List<Double?>,
    val confidenceHighValues: List<Double?>,
    val projectedValues: List<Double?>,
    val forecastTableRows: List<List<String>>,
    val hasForecast: Boolean,
    val trendXLabels: List<String>,
    val costPerKwhValues: List<Double?>,
    val trendTableRows: List<List<String>>,
    val hasCostPerKwhTrend: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's two reads of its
 * `forecastData` prop (the composed forecast chart and the cost-per-kWh trend). Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate.
 */
object CostForecastSectionProjection {
    /**
     * Projects [data] into render-ready inputs via the injected [formatters], preserving the received row
     * order. Mirrors the web reads: the combined historical+forecast month axis with the actual / confidence
     * / projected series, the historical-only trend, and the two fallback tables. The `hasForecast` /
     * `hasCostPerKwhTrend` gates reproduce the web `historical.length >= 3 && forecast.length > 0` and
     * `historical.length > 1` conditions, so the composable shows the friendly empty state rather than a
     * blank panel when there is not enough data.
     */
    fun project(
        data: CostForecastSectionData,
        formatters: CostForecastChartFormatters,
    ): CostForecastProjectionResult {
        val historical = data.historical
        val forecast = data.forecast

        val forecastXLabels = historical.map { it.month } + forecast.map { it.month }
        val actualValues = historical.map { finiteOrNull(it.cost) } + forecast.map { null }
        val confidenceHighValues = historical.map { null } + forecast.map { finiteOrNull(it.costHigh) }
        val projectedValues = historical.map { null } + forecast.map { finiteOrNull(it.cost) }

        val forecastTableRows =
            buildList {
                historical.forEach { point ->
                    add(listOf(point.month, formatters.cost(point.cost), CELL_EMPTY, CELL_EMPTY, CELL_EMPTY))
                }
                forecast.forEach { point ->
                    add(
                        listOf(
                            point.month,
                            CELL_EMPTY,
                            formatters.cost(point.cost),
                            formatters.cost(point.costLow),
                            formatters.cost(point.costHigh),
                        ),
                    )
                }
            }

        return CostForecastProjectionResult(
            forecastXLabels = forecastXLabels,
            actualValues = actualValues,
            confidenceHighValues = confidenceHighValues,
            projectedValues = projectedValues,
            forecastTableRows = forecastTableRows,
            hasForecast = historical.size >= MIN_FORECAST_HISTORY && forecast.isNotEmpty(),
            trendXLabels = historical.map { it.month },
            costPerKwhValues = historical.map { finiteOrNull(it.costPerKwh) },
            trendTableRows = historical.map { listOf(it.month, formatters.costPerKwh(it.costPerKwh)) },
            hasCostPerKwhTrend = historical.size >= MIN_TREND_HISTORY,
        )
    }

    /** Keeps a finite sample, mapping `NaN`/`Infinity` to `null` so the series bridges the gap. */
    private fun finiteOrNull(value: Double): Double? = if (value.isFinite()) value else null
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [CostForecastSectionRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordCostForecastSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to CostForecastSectionRegistration.SLUG))
}
