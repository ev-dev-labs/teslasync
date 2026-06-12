package io.teslasync.android.featureviews.costperkwhchart

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Cost per kWh Trend chart's pure logic — the native analogue of the web
 * component's render-ready use of its `data` prop plus the `useFormatting` currency contract
 * (web/src/features/charging/components/cost-analysis/CostPerKwhChart.tsx): the order-preserving chart +
 * table projection, the `data.length > 0` empty branch, the `UiState` projection of the `{ data }` prop,
 * the currency formatting (`currencySymbol + fmtNumber(amount, 2)` with the `safeNumber` guard), the
 * settings-document currency read, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class CostPerKwhChartProjectionTest {
    // ── project (web chart `data` + accessible-table rows) ────────────────────────

    @Test
    fun projectBuildsAxisLabelsSeriesAndTableRowsInInputOrder() {
        val points =
            listOf(
                CostPerKwhPoint(date = "Jan 4", costPerKwh = 0.12),
                CostPerKwhPoint(date = "Feb 19", costPerKwh = 0.18),
            )

        val result = CostPerKwhChartProjection.project(points, formatValue = { c -> "c:$c" })

        assertFalse(result.isEmpty)
        assertEquals(listOf("Jan 4", "Feb 19"), result.dates)
        assertEquals(listOf<Double?>(0.12, 0.18), result.values)
        assertEquals(
            listOf(
                listOf("Jan 4", "c:0.12"),
                listOf("Feb 19", "c:0.18"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectReturnsEmptyResultForNoPoints() {
        val result = CostPerKwhChartProjection.project(emptyList(), formatValue = { it.toString() })

        assertTrue(result.isEmpty)
        assertTrue(result.dates.isEmpty())
        assertTrue(result.values.isEmpty())
        assertTrue(result.tableRows.isEmpty())
    }

    // ── projectUiState (web `data.length > 0` branch over the shared UiState) ──────

    @Test
    fun projectUiStateMapsNonEmptyToContent() {
        val points = listOf(CostPerKwhPoint(date = "Jan 4", costPerKwh = 0.12))

        val state = CostPerKwhChartProjection.projectUiState(points)

        assertTrue(state.isContent)
        assertEquals(points, state.data)
    }

    @Test
    fun projectUiStateMapsEmptyAndNullToEmpty() {
        assertTrue(CostPerKwhChartProjection.projectUiState(emptyList()).isEmpty)
        assertTrue(CostPerKwhChartProjection.projectUiState(null).isEmpty)
    }

    // ── formatCurrency (web `useFormatting` currencySymbol + fmtNumber) ────────────

    @Test
    fun formatCurrencyRendersSymbolAndGroupedTwoDecimalsInLocale() {
        assertEquals("$0.12", CostPerKwhChartProjection.formatCurrency(0.12, "$", locale = Locale.US))
        assertEquals("$1,234.50", CostPerKwhChartProjection.formatCurrency(1_234.5, "$", locale = Locale.US))
        assertEquals("$0.00", CostPerKwhChartProjection.formatCurrency(0.0, "$", locale = Locale.US))
    }

    @Test
    fun formatCurrencyHonorsCustomSymbolAndBlankFallback() {
        assertEquals("€0.18", CostPerKwhChartProjection.formatCurrency(0.18, "€", locale = Locale.US))
        // A blank symbol degrades to the web `'$'` default.
        assertEquals("$0.18", CostPerKwhChartProjection.formatCurrency(0.18, "", locale = Locale.US))
    }

    @Test
    fun formatCurrencyCoercesNonFiniteToZero() {
        // The web `fmtNumber` runs `safeNumber` first, so NaN / Infinity never reach the output.
        assertEquals("$0.00", CostPerKwhChartProjection.formatCurrency(Double.NaN, "$", locale = Locale.US))
        assertEquals(
            "$0.00",
            CostPerKwhChartProjection.formatCurrency(Double.POSITIVE_INFINITY, "$", locale = Locale.US),
        )
    }

    @Test
    fun safeValuePassesFiniteAndZeroesNonFinite() {
        assertEquals(0.12, CostPerKwhChartProjection.safeValue(0.12), 0.0)
        assertEquals(0.0, CostPerKwhChartProjection.safeValue(Double.NaN), 0.0)
        assertEquals(0.0, CostPerKwhChartProjection.safeValue(Double.NEGATIVE_INFINITY), 0.0)
    }

    // ── CostCurrencyPrefs.fromSettings (web `useFormatting` settings read) ─────────

    @Test
    fun fromSettingsReadsCurrencySymbolFromDocument() {
        val settings: JsonObject = buildJsonObject { put("currency_symbol", JsonPrimitive("£")) }

        assertEquals("£", CostCurrencyPrefs.fromSettings(settings).currencySymbol)
    }

    @Test
    fun fromSettingsFallsBackToDollarForMissingBlankOrNull() {
        val blankSymbol = buildJsonObject { put("currency_symbol", JsonPrimitive("  ")) }
        assertEquals("$", CostCurrencyPrefs.fromSettings(null).currencySymbol)
        assertEquals("$", CostCurrencyPrefs.fromSettings(buildJsonObject {}).currencySymbol)
        assertEquals("$", CostCurrencyPrefs.fromSettings(blankSymbol).currencySymbol)
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordCostPerKwhChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "CostPerKwhChart"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }
}
