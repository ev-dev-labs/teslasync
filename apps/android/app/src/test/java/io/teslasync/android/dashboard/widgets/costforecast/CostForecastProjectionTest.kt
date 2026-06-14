package io.teslasync.android.dashboard.widgets.costforecast

import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the CostForecastWidget's pure logic — the raw-JSON decode, the
 * historical+forecast → trailing-6 bar build (web `buildChartData(...).slice(-6)`), the next-month /
 * last-month / trend derivations, the currency formatting (web `useFormatting`), the compact / standard
 * stat-row projection branches, the chart TalkBack description, the settings-derived display preference,
 * and the registry metadata. Mirrors the web spec
 * (web/src/features/dashboard/widgets/CostForecastWidget.tsx).
 */
class CostForecastProjectionTest {
    private val strings =
        CostForecastStrings(
            title = "Cost Forecast",
            noData = "No forecast data",
            nextMonth = "Next Month",
            trend = "Trend",
            avgPerKwh = "Avg \$/kWh",
            costLabel = "Cost",
        )

    private fun prefs(currency: String = "$"): CostForecastDisplayPrefs = CostForecastDisplayPrefs(currency)

    // Four historical + four forecast months so the trailing-6 slice is exercised (drops the two oldest).
    private fun sampleJson() =
        buildJsonObject {
            put(
                "historical",
                buildJsonArray {
                    add(historical("2025-01", 30.0, 0.10))
                    add(historical("2025-02", 40.0, 0.11))
                    add(historical("2025-03", 50.0, 0.12))
                    add(historical("2025-04", 45.0, 0.14))
                },
            )
            put(
                "forecast",
                buildJsonArray {
                    add(forecast("2025-05", 55.0))
                    add(forecast("2025-06", 60.0))
                    add(forecast("2025-07", 58.0))
                    add(forecast("2025-08", 62.0))
                },
            )
        }

    private fun historical(
        month: String,
        cost: Double,
        costPerKwh: Double,
    ) = buildJsonObject {
        put("month", month)
        put("cost", cost)
        put("kwh", 200.0)
        put("sessions", 8)
        put("cost_per_kwh", costPerKwh)
    }

    private fun forecast(
        month: String,
        cost: Double,
    ) = buildJsonObject {
        put("month", month)
        put("cost", cost)
        put("cost_low", cost - 5.0)
        put("cost_high", cost + 5.0)
        put("kwh", 210.0)
    }

    private fun project(
        data: CostForecastData,
        prefs: CostForecastDisplayPrefs = prefs(),
    ): CostForecastDisplay = CostForecastProjection.project(data, prefs, strings, Locale.US)

    @Test
    fun parseNullPayloadIsEmpty() {
        val data = parseCostForecast(null)
        assertFalse(data.hasData)
        assertTrue(data.historical.isEmpty())
        assertTrue(data.forecast.isEmpty())
    }

    @Test
    fun parseReadsSnakeCaseFields() {
        val data = parseCostForecast(sampleJson())
        assertEquals(4, data.historical.size)
        assertEquals(4, data.forecast.size)
        assertEquals(HistoricalMonth("2025-04", 45.0, 0.14), data.historical.last())
        assertEquals(ForecastMonth("2025-05", 55.0), data.forecast.first())
    }

    @Test
    fun parseTreatsMissingNumericsAsZeroAndMissingMonthAsDash() {
        val json =
            buildJsonObject {
                put("historical", buildJsonArray { add(buildJsonObject { put("cost", 12.0) }) })
                put("forecast", buildJsonArray { add(buildJsonObject { put("month", "2025-09") }) })
            }
        val data = parseCostForecast(json)
        assertEquals(HistoricalMonth("\u2014", 12.0, 0.0), data.historical.single())
        assertEquals(ForecastMonth("2025-09", 0.0), data.forecast.single())
    }

    @Test
    fun parseMissingArraysCollapseToEmpty() {
        val data = parseCostForecast(buildJsonObject { put("insights", buildJsonArray { add("x") }) })
        assertFalse(data.hasData)
    }

    @Test
    fun barsKeepLastSixHistoricalThenForecastInOrder() {
        val bars = project(parseCostForecast(sampleJson())).bars
        assertEquals(6, bars.size)
        // The two oldest historical months (2025-01, 2025-02) are dropped by the trailing-6 slice.
        assertEquals(ForecastBar("2025-03", 50.0, isForecast = false), bars.first())
        assertEquals(ForecastBar("2025-08", 62.0, isForecast = true), bars.last())
        assertEquals(4, bars.count { it.isForecast })
        assertEquals(2, bars.count { !it.isForecast })
    }

    @Test
    fun chartDescriptionListsTheVisibleMonths() {
        val display = project(parseCostForecast(sampleJson()))
        assertEquals(
            "Cost Forecast: 2025-03, 2025-04, 2025-05, 2025-06, 2025-07, 2025-08",
            display.chartContentDescription,
        )
    }

    @Test
    fun standardStatsUseNextForecastLastHistoricalAndRisingTrend() {
        val display = project(parseCostForecast(sampleJson()))
        assertTrue(display.hasData)
        assertTrue(display.trendUp)
        assertEquals(
            listOf(
                ForecastStat("Next Month", "$55"),
                ForecastStat("Avg \$/kWh", "$0.14"),
                // nextCost 55 − lastCost 45 = 10.
                ForecastStat("Trend", "\u2191 $10"),
            ),
            display.standardStats,
        )
    }

    @Test
    fun compactStatsDropAvgPerKwhAndShowArrowOnly() {
        val display = project(parseCostForecast(sampleJson()))
        assertEquals(
            listOf(
                ForecastStat("Next Month", "$55"),
                ForecastStat("Trend", "\u2191"),
            ),
            display.compactStats,
        )
    }

    @Test
    fun fallingTrendUsesDownArrowAndLastMinusNextDelta() {
        val json =
            buildJsonObject {
                put("historical", buildJsonArray { add(historical("2025-03", 45.0, 0.14)) })
                put("forecast", buildJsonArray { add(forecast("2025-04", 30.0)) })
            }
        val display = project(parseCostForecast(json))
        assertFalse(display.trendUp)
        // lastCost 45 − nextCost 30 = 15.
        assertEquals(ForecastStat("Trend", "\u2193 $15"), display.standardStats[2])
        assertEquals(ForecastStat("Trend", "\u2193"), display.compactStats[1])
    }

    @Test
    fun avgPerKwhIsDashWhenNoHistoricalMonths() {
        val json =
            buildJsonObject {
                put("forecast", buildJsonArray { add(forecast("2025-04", 30.0)) })
            }
        val display = project(parseCostForecast(json))
        assertTrue(display.hasData)
        assertEquals(ForecastStat("Avg \$/kWh", "\u2014"), display.standardStats[1])
    }

    @Test
    fun formatCurrencyGroupsAndPrefixesSymbol() {
        assertEquals("$1,234", CostForecastProjection.formatCurrency(1234.0, 0, "$", Locale.US))
        assertEquals("\u20AC9.999", CostForecastProjection.formatCurrency(9.999, 3, "\u20AC", Locale.US))
        // Blank symbol falls back to "$" (web `currency_symbol` blank guard).
        assertEquals("$5.00", CostForecastProjection.formatCurrency(5.0, 2, "  ", Locale.US))
    }

    @Test
    fun emptyDataProjectsZeroStatsDashAndNoBars() {
        val display = project(CostForecastData.EMPTY)
        assertFalse(display.hasData)
        assertTrue(display.bars.isEmpty())
        // trendUp is 0 >= 0 = true, so the rising arrow + zero delta render (web parity for empty).
        assertEquals(ForecastStat("Next Month", "$0"), display.standardStats[0])
        assertEquals(ForecastStat("Avg \$/kWh", "\u2014"), display.standardStats[1])
        assertEquals(ForecastStat("Trend", "\u2191 $0"), display.standardStats[2])
        assertEquals("No forecast data", display.emptyMessage)
        assertEquals("No forecast data", display.chartContentDescription)
    }

    @Test
    fun displayPrefsResolveFromSettings() {
        assertEquals(CostForecastDisplayPrefs.DEFAULT, CostForecastDisplayPrefs.fromSettings(null))

        val euro = CostForecastDisplayPrefs.fromSettings(buildJsonObject { put("currency_symbol", "\u20AC") })
        assertEquals("\u20AC", euro.currencySymbol)

        val blank = CostForecastDisplayPrefs.fromSettings(buildJsonObject { put("currency_symbol", "   ") })
        assertEquals("$", blank.currencySymbol)

        val absent = CostForecastDisplayPrefs.fromSettings(buildJsonObject { put("locale", "en-US") })
        assertEquals("$", absent.currencySymbol)
    }

    @Test
    fun registrationMirrorsWebRegistry() {
        assertEquals("cost-forecast", CostForecastRegistration.ID)
        assertEquals("charging", CostForecastRegistration.CATEGORY)
        assertEquals("CostForecastWidget", CostForecastRegistration.SLUG)
        assertEquals(CostForecastSize(cols = 2, rows = 4), CostForecastRegistration.defaultSize)
        assertEquals(CostForecastSize(cols = 1, rows = 2), CostForecastRegistration.minSize)
        assertEquals(CostForecastSize(cols = 4, rows = 40), CostForecastRegistration.maxSize)
    }

    @Test
    fun registrationClampsAndChecksBounds() {
        assertEquals(CostForecastSize(cols = 4, rows = 40), CostForecastRegistration.clamp(CostForecastSize(9, 99)))
        assertEquals(CostForecastSize(cols = 1, rows = 2), CostForecastRegistration.clamp(CostForecastSize(0, 0)))
        assertTrue(CostForecastRegistration.isWithinBounds(CostForecastSize(2, 4)))
        assertFalse(CostForecastRegistration.isWithinBounds(CostForecastSize(5, 4)))
    }

    @Test
    fun compactAndWideBranchesFollowColumnCount() {
        assertTrue(CostForecastSize(cols = 1, rows = 4).isCompact)
        assertFalse(CostForecastSize(cols = 2, rows = 4).isCompact)
        assertTrue(CostForecastSize(cols = 3, rows = 4).isWide)
        assertFalse(CostForecastSize(cols = 2, rows = 4).isWide)
    }
}
