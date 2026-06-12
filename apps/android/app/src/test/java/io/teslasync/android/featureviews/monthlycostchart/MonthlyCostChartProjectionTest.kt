package io.teslasync.android.featureviews.monthlycostchart

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the Monthly Cost Trend chart's pure logic — the native analogue of the web
 * component's render-ready use of its `data` prop plus the `useFormatting` currency contract
 * (web/src/features/charging/components/cost-analysis/MonthlyCostChart.tsx): the order-preserving chart +
 * table projection, the `data.length > 0` empty branch, the `UiState` projection of the `{ data }` prop, the
 * raw `String(cost)` fallback-table cells, the `YYYY-MM` → `MM/YY` X-axis tick reformat, the currency
 * formatting (`currencySymbol + fmtNumber(amount, 0)` with the `safeNumber` guard), the settings-document
 * currency read, the `annotations` binding, and the PII-safe `view.opened` diagnostic. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class MonthlyCostChartProjectionTest {
    // ── project (web chart `data` + accessible-table rows) ────────────────────────

    @Test
    fun projectBuildsAxisLabelsSeriesAndTableRowsInInputOrder() {
        val points =
            listOf(
                MonthlyCostPoint(month = "2024-01", cost = 42.0),
                MonthlyCostPoint(month = "2024-02", cost = 58.5),
            )

        val result = MonthlyCostChartProjection.project(points, formatCostCell = { c -> "c:$c" })

        assertFalse(result.isEmpty)
        assertEquals(listOf("2024-01", "2024-02"), result.months)
        assertEquals(listOf<Double?>(42.0, 58.5), result.values)
        assertEquals(
            listOf(
                listOf("2024-01", "c:42.0"),
                listOf("2024-02", "c:58.5"),
            ),
            result.tableRows,
        )
    }

    @Test
    fun projectReturnsEmptyResultForNoPoints() {
        val result = MonthlyCostChartProjection.project(emptyList(), formatCostCell = { it.toString() })

        assertTrue(result.isEmpty)
        assertTrue(result.months.isEmpty())
        assertTrue(result.values.isEmpty())
        assertTrue(result.tableRows.isEmpty())
    }

    // ── projectUiState (web `data.length > 0` branch over the shared UiState) ──────

    @Test
    fun projectUiStateMapsNonEmptyToContent() {
        val points = listOf(MonthlyCostPoint(month = "2024-01", cost = 42.0))

        val state = MonthlyCostChartProjection.projectUiState(points)

        assertTrue(state.isContent)
        assertEquals(points, state.data)
    }

    @Test
    fun projectUiStateMapsEmptyAndNullToEmpty() {
        assertTrue(MonthlyCostChartProjection.projectUiState(emptyList()).isEmpty)
        assertTrue(MonthlyCostChartProjection.projectUiState(null).isEmpty)
    }

    // ── rawCostCell (web fallback-table `String(d.cost)`) ──────────────────────────

    @Test
    fun rawCostCellRendersIntegralValuesWithoutADecimal() {
        assertEquals("42", MonthlyCostChartProjection.rawCostCell(42.0))
        assertEquals("0", MonthlyCostChartProjection.rawCostCell(0.0))
        assertEquals("-5", MonthlyCostChartProjection.rawCostCell(-5.0))
        assertEquals("1234", MonthlyCostChartProjection.rawCostCell(1234.0))
    }

    @Test
    fun rawCostCellKeepsFractionsUngroupedLikeJsStringNumber() {
        assertEquals("58.5", MonthlyCostChartProjection.rawCostCell(58.5))
        assertEquals("71.25", MonthlyCostChartProjection.rawCostCell(71.25))
        // No thousands grouping — JS `String(1234.5)` is "1234.5", not "1,234.5".
        assertEquals("1234.5", MonthlyCostChartProjection.rawCostCell(1234.5))
    }

    @Test
    fun rawCostCellDegradesNonFiniteToTheEmptyMarker() {
        assertEquals(ChartFormat.EMPTY, MonthlyCostChartProjection.rawCostCell(Double.NaN))
        assertEquals(ChartFormat.EMPTY, MonthlyCostChartProjection.rawCostCell(Double.POSITIVE_INFINITY))
        assertEquals(ChartFormat.EMPTY, MonthlyCostChartProjection.rawCostCell(Double.NEGATIVE_INFINITY))
    }

    // ── formatMonthTick (web `<XAxis tickFormatter>` YYYY-MM → MM/YY) ──────────────

    @Test
    fun formatMonthTickReformatsYearMonthToMonthSlashShortYear() {
        assertEquals("03/24", MonthlyCostChartProjection.formatMonthTick("2024-03"))
        assertEquals("12/24", MonthlyCostChartProjection.formatMonthTick("2024-12"))
        assertEquals("01/99", MonthlyCostChartProjection.formatMonthTick("1999-01"))
    }

    @Test
    fun formatMonthTickReturnsOtherShapesUnchanged() {
        // The web ternary's `: v` fallback for anything that is not exactly two `-`-split parts.
        assertEquals("2024", MonthlyCostChartProjection.formatMonthTick("2024"))
        assertEquals("2024-03-15", MonthlyCostChartProjection.formatMonthTick("2024-03-15"))
        assertEquals("", MonthlyCostChartProjection.formatMonthTick(""))
    }

    // ── formatCurrency (web `useFormatting` currencySymbol + fmtNumber(v, 0)) ──────

    @Test
    fun formatCurrencyRendersSymbolAndGroupedZeroDecimalsInLocale() {
        assertEquals("$42", MonthlyCostChartProjection.formatCurrency(42.0, "$", locale = Locale.US))
        assertEquals("$1,234", MonthlyCostChartProjection.formatCurrency(1_234.0, "$", locale = Locale.US))
        assertEquals("$0", MonthlyCostChartProjection.formatCurrency(0.0, "$", locale = Locale.US))
    }

    @Test
    fun formatCurrencyRoundsToZeroDecimals() {
        assertEquals("$59", MonthlyCostChartProjection.formatCurrency(58.7, "$", locale = Locale.US))
        assertEquals("$36", MonthlyCostChartProjection.formatCurrency(36.2, "$", locale = Locale.US))
    }

    @Test
    fun formatCurrencyHonorsCustomSymbolAndBlankFallback() {
        assertEquals("€1,234", MonthlyCostChartProjection.formatCurrency(1_234.0, "€", locale = Locale.US))
        // A blank symbol degrades to the web `'$'` default.
        assertEquals("$99", MonthlyCostChartProjection.formatCurrency(99.0, "", locale = Locale.US))
    }

    @Test
    fun formatCurrencyCoercesNonFiniteToZero() {
        // The web `fmtNumber` runs `safeNumber` first, so NaN / Infinity never reach the output.
        assertEquals("$0", MonthlyCostChartProjection.formatCurrency(Double.NaN, "$", locale = Locale.US))
        assertEquals(
            "$0",
            MonthlyCostChartProjection.formatCurrency(Double.POSITIVE_INFINITY, "$", locale = Locale.US),
        )
    }

    @Test
    fun safeValuePassesFiniteAndZeroesNonFinite() {
        assertEquals(42.5, MonthlyCostChartProjection.safeValue(42.5), 0.0)
        assertEquals(0.0, MonthlyCostChartProjection.safeValue(Double.NaN), 0.0)
        assertEquals(0.0, MonthlyCostChartProjection.safeValue(Double.NEGATIVE_INFINITY), 0.0)
    }

    // ── MonthlyCostAnnotationScope (web `annotations={{ vehicleId, scope, chartId }}`) ─

    @Test
    fun annotationScopeCarriesVehicleIdWithWebScopeAndChartId() {
        val scope = MonthlyCostAnnotationScope.forVehicle(7)

        assertEquals(7, scope.vehicleId)
        assertEquals("cost", scope.scope)
        assertEquals("cost-monthly-trend", scope.chartId)
    }

    @Test
    fun annotationScopeAllowsNullVehicleId() {
        val scope = MonthlyCostAnnotationScope.forVehicle(null)

        assertNull(scope.vehicleId)
        assertEquals(MonthlyCostAnnotationScope.SCOPE, scope.scope)
        assertEquals(MonthlyCostAnnotationScope.CHART_ID, scope.chartId)
    }

    // ── MonthlyCostCurrencyPrefs.fromSettings (web `useFormatting` settings read) ──

    @Test
    fun fromSettingsReadsCurrencySymbolFromDocument() {
        val settings: JsonObject = buildJsonObject { put("currency_symbol", JsonPrimitive("£")) }

        assertEquals("£", MonthlyCostCurrencyPrefs.fromSettings(settings).currencySymbol)
    }

    @Test
    fun fromSettingsFallsBackToDollarForMissingBlankOrNull() {
        val blankSymbol = buildJsonObject { put("currency_symbol", JsonPrimitive("  ")) }
        assertEquals("$", MonthlyCostCurrencyPrefs.fromSettings(null).currencySymbol)
        assertEquals("$", MonthlyCostCurrencyPrefs.fromSettings(buildJsonObject {}).currencySymbol)
        assertEquals("$", MonthlyCostCurrencyPrefs.fromSettings(blankSymbol).currencySymbol)
    }

    // ── resolveOptional (web `t(key, default)` inline-default seam) ────────────────

    @Test
    fun resolveOptionalPrefersCatalogValueAndFallsBackWhenAbsentOrBlank() {
        assertEquals("From catalog", resolveOptional({ "From catalog" }, KEY_ARIA_LABEL, "fallback"))
        assertEquals("fallback", resolveOptional({ null }, KEY_ARIA_LABEL, "fallback"))
        assertEquals("fallback", resolveOptional({ "   " }, KEY_ARIA_LABEL, "fallback"))
    }

    // ── Diagnostics (P1/S11 view.opened contract) ─────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()

        recordMonthlyCostChartOpened(logger)

        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.single()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "MonthlyCostChart"), fields)
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
