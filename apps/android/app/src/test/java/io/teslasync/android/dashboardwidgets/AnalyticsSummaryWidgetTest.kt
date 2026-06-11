package io.teslasync.android.dashboardwidgets

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * JVM unit tests for the framework-free Analytics Summary surface logic: the cached-JSON →
 * display projection (the "data adapter"), the per-state surface decision, the error-kind
 * mapping, the settings-derived display preferences, the cost formatter, and the registry
 * size constraints. These run in the `:android:testReleaseUnitTest` gate with no device.
 */
class AnalyticsSummaryWidgetTest {
    // ── Adapter: cached SI JSON → display projection ────────────────────────────

    @Test
    fun kmProjectionConvertsDistanceEfficiencyAndCost() {
        val ui =
            analyticsSummaryUi(
                summaryJson(distanceKm = 100.0, energyKwh = 45.6, totalCost = 12.5, efficiencyWhKm = 150.0),
                DistanceUnitPref.KM,
            )

        assertEquals(100.0, ui.distance.value, TOLERANCE)
        assertEquals("km", ui.distance.unit)
        assertEquals(150.0, ui.efficiency.value, TOLERANCE)
        assertEquals("Wh/km", ui.efficiency.unit)
        assertEquals(45.6, ui.energy.value, TOLERANCE)
        assertEquals("kWh", ui.energy.unit)
        assertEquals(0.125, ui.costPerDistance, TOLERANCE)
        assertTrue(ui.hasData)
    }

    @Test
    fun mileProjectionConvertsDistanceEfficiencyAndCost() {
        val ui =
            analyticsSummaryUi(
                summaryJson(distanceKm = 100.0, energyKwh = 45.6, totalCost = 12.5, efficiencyWhKm = 150.0),
                DistanceUnitPref.MI,
            )

        assertEquals(62.1371, ui.distance.value, TOLERANCE)
        assertEquals("mi", ui.distance.unit)
        assertEquals(241.401, ui.efficiency.value, COARSE_TOLERANCE)
        assertEquals("Wh/mi", ui.efficiency.unit)
        assertEquals(0.201168, ui.costPerDistance, TOLERANCE)
    }

    @Test
    fun camelCaseWireKeysAreTolerated() {
        val json =
            buildJsonObject {
                put("totalDistanceKm", 50.0)
                put("totalEnergyKwh", 10.0)
            }

        val ui = analyticsSummaryUi(json, DistanceUnitPref.KM)

        assertEquals(50.0, ui.distance.value, TOLERANCE)
        assertEquals(10.0, ui.energy.value, TOLERANCE)
        assertTrue(ui.hasData)
    }

    @Test
    fun missingFieldsCollapseToZeroAndEmpty() {
        val ui = analyticsSummaryUi(null, DistanceUnitPref.KM)

        assertEquals(0.0, ui.distance.value, TOLERANCE)
        assertEquals(0.0, ui.efficiency.value, TOLERANCE)
        assertEquals(0.0, ui.costPerDistance, TOLERANCE)
        assertFalse(ui.hasData)
    }

    @Test
    fun hasDataReflectsDistanceOrEnergyOnly() {
        assertTrue(analyticsSummaryHasData(summaryJson(distanceKm = 1.0)))
        assertTrue(analyticsSummaryHasData(summaryJson(energyKwh = 1.0)))
        assertFalse(analyticsSummaryHasData(summaryJson(totalCost = 99.0)))
        assertFalse(analyticsSummaryHasData(null))
    }

    @Test
    fun sparklineTrendsAreParsedWhenPresent() {
        val json =
            buildJsonObject {
                put("total_distance_km", 10.0)
                putJsonArray("distance_trend") {
                    add(1.0)
                    add(2.0)
                    add(3.0)
                }
            }

        val ui = analyticsSummaryUi(json, DistanceUnitPref.KM)

        assertEquals(listOf(1.0, 2.0, 3.0), ui.sparklines[0])
        assertTrue(ui.sparklines[1].isEmpty())
    }

    // ── Per-state surface decision ──────────────────────────────────────────────

    @Test
    fun surfaceMapsEveryPhase() {
        assertEquals(AnalyticsSummarySurface.Loading, analyticsSummarySurface(UiState<JsonElement>(UiPhase.Loading)))
        assertEquals(AnalyticsSummarySurface.Error, analyticsSummarySurface(UiState<JsonElement>(UiPhase.Error)))
        assertEquals(AnalyticsSummarySurface.Empty, analyticsSummarySurface(UiState<JsonElement>(UiPhase.Empty)))
        assertEquals(AnalyticsSummarySurface.Content, analyticsSummarySurface(UiState<JsonElement>(UiPhase.Content)))
    }

    @Test
    fun offlineCachedStaysContentNotError() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = summaryJson(distanceKm = 5.0),
                stale = true,
                errorKind = ErrorKind.Network,
            )

        assertEquals(AnalyticsSummarySurface.Content, analyticsSummarySurface(offline))
        assertTrue(offline.isOffline)
    }

    // ── Error-kind mapping ──────────────────────────────────────────────────────

    @Test
    fun errorKindMapsConnectivityAndHttpStatus() {
        assertEquals(QueryErrorKind.Offline, analyticsSummaryErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, analyticsSummaryErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, analyticsSummaryErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, analyticsSummaryErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, analyticsSummaryErrorKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, analyticsSummaryErrorKind(ErrorKind.Http, HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.ServerError, analyticsSummaryErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, analyticsSummaryErrorKind(ErrorKind.Unknown, null))
    }

    // ── Settings-derived display preferences ────────────────────────────────────

    @Test
    fun displayPrefsDefaultToMetricAndDollar() {
        val prefs = displayPrefsFrom(null)

        assertEquals(DistanceUnitPref.KM, prefs.distanceUnit)
        assertEquals("$", prefs.currencySymbol)
    }

    @Test
    fun displayPrefsReadUnitAndCurrencyFromSettings() {
        val settings =
            buildJsonObject {
                put("unit_of_length", "mi")
                put("currency_symbol", "\u20AC")
            }

        val prefs = displayPrefsFrom(settings)

        assertEquals(DistanceUnitPref.MI, prefs.distanceUnit)
        assertEquals("\u20AC", prefs.currencySymbol)
    }

    @Test
    fun blankCurrencyFallsBackToDollar() {
        val settings = buildJsonObject { put("currency_symbol", "   ") }

        assertEquals("$", displayPrefsFrom(settings).currencySymbol)
    }

    // ── Cost formatter ──────────────────────────────────────────────────────────

    @Test
    fun costFormatterRendersCurrencyOrEmDash() {
        assertEquals("$0.125", formatCostPerDistance(0.125, "$", Locale.US))
        assertEquals("\u20AC0.201", formatCostPerDistance(0.201168, "\u20AC", Locale.US))
        assertEquals("\u2014", formatCostPerDistance(0.0, "$", Locale.US))
    }

    // ── Registry size constraints ───────────────────────────────────────────────

    @Test
    fun registryIdAndSpanConstraintsMatchWeb() {
        assertEquals("analytics-summary", AnalyticsSummaryWidgetSpec.ID)
        assertEquals(WidgetSpan(1, 2), AnalyticsSummaryWidgetSpec.coerceSpan(WidgetSpan(0, 0)))
        assertEquals(WidgetSpan(4, 40), AnalyticsSummaryWidgetSpec.coerceSpan(WidgetSpan(9, 99)))
        assertTrue(AnalyticsSummaryWidgetSpec.isCompact(WidgetSpan(1, 2)))
        assertFalse(AnalyticsSummaryWidgetSpec.isCompact(WidgetSpan(2, 2)))
        assertTrue(AnalyticsSummaryWidgetSpec.isWide(WidgetSpan(4, 2)))
        assertFalse(AnalyticsSummaryWidgetSpec.isWide(WidgetSpan(2, 2)))
    }

    private fun summaryJson(
        distanceKm: Double? = null,
        energyKwh: Double? = null,
        totalCost: Double? = null,
        efficiencyWhKm: Double? = null,
    ): JsonElement =
        buildJsonObject {
            if (distanceKm != null) put("total_distance_km", distanceKm)
            if (energyKwh != null) put("total_energy_kwh", energyKwh)
            if (totalCost != null) put("total_cost", totalCost)
            if (efficiencyWhKm != null) put("avg_efficiency_wh_km", efficiencyWhKm)
        }

    private companion object {
        const val TOLERANCE = 0.001
        const val COARSE_TOLERANCE = 0.01
        const val HTTP_NOT_FOUND = 404
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_SERVER_ERROR = 500
    }
}
