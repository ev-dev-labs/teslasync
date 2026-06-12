package io.teslasync.android.featureviews.costforecastsection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Cost-Forecast surface's pure logic — the native analogue of the web
 * component's two reads of its `forecastData` prop
 * (web/src/features/charging/components/cost-analysis/CostForecastSection.tsx): the combined
 * historical+forecast chart projection (actual / 95%-confidence / projected series + the Month / Actual /
 * Projected / Low / High fallback table), the historical-only cost-per-kWh trend (series + table), the
 * `hasForecast` / `hasCostPerKwhTrend` data gates, and the non-finite-sample guard — all in received row
 * order. Runs in the :android:testReleaseUnitTest gate; no Compose, no device.
 */
class CostForecastSectionProjectionTest {
    private val formatters =
        CostForecastChartFormatters(
            cost = { "c($it)" },
            costPerKwh = { "k($it)" },
        )

    private val historical =
        listOf(
            CostForecastHistoricalPoint(month = "Jan", cost = 52.0, costPerKwh = 0.13),
            CostForecastHistoricalPoint(month = "Feb", cost = 48.0, costPerKwh = 0.12),
            CostForecastHistoricalPoint(month = "Mar", cost = 60.0, costPerKwh = 0.14),
        )
    private val forecast =
        listOf(
            CostForecastProjectedPoint(month = "Apr", cost = 58.0, costLow = 50.0, costHigh = 66.0),
        )

    // ── Forecast chart (web ComposedChart combined series + fallback table) ─────────

    @Test
    fun projectBuildsForecastAxisSeriesAndTableInReceivedOrder() {
        val result = CostForecastSectionProjection.project(CostForecastSectionData(historical, forecast), formatters)

        assertTrue(result.hasForecast)
        assertEquals(listOf("Jan", "Feb", "Mar", "Apr"), result.forecastXLabels)
        assertEquals(listOf<Double?>(52.0, 48.0, 60.0, null), result.actualValues)
        assertEquals(listOf<Double?>(null, null, null, 66.0), result.confidenceHighValues)
        assertEquals(listOf<Double?>(null, null, null, 58.0), result.projectedValues)
        assertEquals(
            listOf(
                listOf("Jan", "c(52.0)", CELL_EMPTY, CELL_EMPTY, CELL_EMPTY),
                listOf("Feb", "c(48.0)", CELL_EMPTY, CELL_EMPTY, CELL_EMPTY),
                listOf("Mar", "c(60.0)", CELL_EMPTY, CELL_EMPTY, CELL_EMPTY),
                listOf("Apr", CELL_EMPTY, "c(58.0)", "c(50.0)", "c(66.0)"),
            ),
            result.forecastTableRows,
        )
    }

    // ── Cost-per-kWh trend (web LineChart over historical) ──────────────────────────

    @Test
    fun projectBuildsTrendSeriesAndTableFromHistorical() {
        val result = CostForecastSectionProjection.project(CostForecastSectionData(historical, forecast), formatters)

        assertTrue(result.hasCostPerKwhTrend)
        assertEquals(listOf("Jan", "Feb", "Mar"), result.trendXLabels)
        assertEquals(listOf<Double?>(0.13, 0.12, 0.14), result.costPerKwhValues)
        assertEquals(
            listOf(
                listOf("Jan", "k(0.13)"),
                listOf("Feb", "k(0.12)"),
                listOf("Mar", "k(0.14)"),
            ),
            result.trendTableRows,
        )
    }

    // ── Data gates (web hasForecast / hasCostPerKwhTrend conditions) ────────────────

    @Test
    fun forecastGateRequiresAtLeastThreeHistoryAndOneForecast() {
        assertFalse(
            CostForecastSectionProjection
                .project(CostForecastSectionData(historical.take(2), forecast), formatters)
                .hasForecast,
        )
        assertFalse(
            CostForecastSectionProjection
                .project(CostForecastSectionData(historical, emptyList()), formatters)
                .hasForecast,
        )
        assertTrue(
            CostForecastSectionProjection
                .project(CostForecastSectionData(historical, forecast), formatters)
                .hasForecast,
        )
    }

    @Test
    fun trendGateRequiresMoreThanOneHistoryMonth() {
        assertFalse(
            CostForecastSectionProjection
                .project(CostForecastSectionData(historical.take(1), emptyList()), formatters)
                .hasCostPerKwhTrend,
        )
        assertTrue(
            CostForecastSectionProjection
                .project(CostForecastSectionData(historical.take(2), emptyList()), formatters)
                .hasCostPerKwhTrend,
        )
    }

    // ── Robustness ──────────────────────────────────────────────────────────────────

    @Test
    fun projectMapsNonFiniteSamplesToNull() {
        val data =
            CostForecastSectionData(
                historical = listOf(CostForecastHistoricalPoint("Jan", Double.NaN, Double.NaN)),
                forecast =
                    listOf(
                        CostForecastProjectedPoint(
                            month = "Apr",
                            cost = Double.NaN,
                            costLow = 1.0,
                            costHigh = Double.POSITIVE_INFINITY,
                        ),
                    ),
            )

        val result = CostForecastSectionProjection.project(data, formatters)

        assertEquals(listOf<Double?>(null, null), result.actualValues)
        assertEquals(listOf<Double?>(null, null), result.confidenceHighValues)
        assertEquals(listOf<Double?>(null, null), result.projectedValues)
        assertEquals(listOf<Double?>(null), result.costPerKwhValues)
    }

    @Test
    fun projectReturnsEmptyResultAndFalseGatesForNoData() {
        val result = CostForecastSectionProjection.project(CostForecastSectionData.EMPTY, formatters)

        assertFalse(result.hasForecast)
        assertFalse(result.hasCostPerKwhTrend)
        assertTrue(result.forecastXLabels.isEmpty())
        assertTrue(result.actualValues.isEmpty())
        assertTrue(result.confidenceHighValues.isEmpty())
        assertTrue(result.projectedValues.isEmpty())
        assertTrue(result.forecastTableRows.isEmpty())
        assertTrue(result.trendXLabels.isEmpty())
        assertTrue(result.costPerKwhValues.isEmpty())
        assertTrue(result.trendTableRows.isEmpty())
    }
}
