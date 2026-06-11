package io.teslasync.android.dashboardwidgets.chargecosttracker

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/**
 * JVM unit tests for the framework-free Charge Cost Tracker surface logic: the charging-sessions →
 * cost-metrics projection (the "data adapter"), the `useFormatting` cost/gas helpers (including the
 * web's miles-as-metres quirk reproduced verbatim), the settings derivation, the per-state surface
 * decision, the error-kind mapping, the cached → projection bridge, and the registry constraints.
 * These run in the `:android:testReleaseUnitTest` gate with no device.
 */
class ChargeCostTrackerWidgetTest {
    private val km = DistanceUnitPref.KM

    // ── Adapter: charging sessions → cost metrics ───────────────────────────────

    @Test
    fun computeMetricsSumsEnergyAndEstimatesCostFromRate() {
        val metrics =
            ChargeCostTrackerProjection.computeMetrics(
                listOf(ChargeCostSession(12_000.0, null), ChargeCostSession(8_000.0, null)),
                ChargeCostSettings.DEFAULT,
                km,
            )

        assertEquals(20.0, metrics.totalKwh, TOLERANCE)
        // No recorded cost → energy × 0.12/kWh rate (web `s.cost != null ? s.cost : energy * costPerKwh`).
        assertEquals(2.4, metrics.totalCost, TOLERANCE)
        assertEquals(2, metrics.sessionCount)
        assertEquals(70.0, metrics.totalDistanceMi, TOLERANCE)
        assertTrue(metrics.hasData)
    }

    @Test
    fun computeMetricsPrefersRecordedSessionCost() {
        val metrics =
            ChargeCostTrackerProjection.computeMetrics(
                listOf(ChargeCostSession(10_000.0, 5.0)),
                ChargeCostSettings.DEFAULT,
                km,
            )

        assertEquals(10.0, metrics.totalKwh, TOLERANCE)
        // Recorded cost (5.0) wins over the 10 kWh × 0.12 estimate (1.2).
        assertEquals(5.0, metrics.totalCost, TOLERANCE)
    }

    @Test
    fun computeMetricsEmptyListIsAllZeroAndNotHasData() {
        val metrics = ChargeCostTrackerProjection.computeMetrics(emptyList(), ChargeCostSettings.DEFAULT, km)

        assertEquals(0.0, metrics.totalKwh, TOLERANCE)
        assertEquals(0.0, metrics.totalCost, TOLERANCE)
        assertNull(metrics.costPerDistance)
        assertNull(metrics.gasSavings)
        assertEquals(0, metrics.sessionCount)
        assertFalse(metrics.hasData)
    }

    @Test
    fun costPerDistanceReproducesWebMilesAsMetresQuirk() {
        // Web parity: totalDistanceMi (70) is fed into the SI-metres parameter, so 70 "metres" → 0.07 km.
        val metrics =
            ChargeCostTrackerProjection.computeMetrics(
                listOf(ChargeCostSession(20_000.0, null)),
                ChargeCostSettings.DEFAULT,
                km,
            )

        val cost = 20.0 * ChargeCostSettings.DEFAULT_COST_PER_KWH
        val expected = cost / (70.0 / 1000.0)
        assertEquals(expected, metrics.costPerDistance!!, TOLERANCE)
    }

    @Test
    fun gasSavingsNullWhenGasUnconfiguredOtherwiseComputed() {
        val noGas =
            ChargeCostTrackerProjection.computeMetrics(
                listOf(ChargeCostSession(12_000.0, null)),
                ChargeCostSettings.DEFAULT,
                DistanceUnitPref.MI,
            )
        assertNull(noGas.gasSavings)

        val withGas =
            ChargeCostTrackerProjection.computeMetrics(
                listOf(ChargeCostSession(12_000.0, null)),
                ChargeCostSettings.DEFAULT.copy(gasEfficiencyMpg = 30.0, gasPricePerUnit = 4.0),
                DistanceUnitPref.MI,
            )
        assertTrue(withGas.gasSavings != null)
    }

    // ── useFormatting helpers ───────────────────────────────────────────────────

    @Test
    fun estimateGasCostGuardsAndConvertsLitres() {
        assertNull(ChargeCostTrackerProjection.estimateGasCost(0.0, ChargeCostSettings.DEFAULT))
        assertNull(
            ChargeCostTrackerProjection.estimateGasCost(
                100.0,
                ChargeCostSettings.DEFAULT.copy(gasEfficiencyMpg = 0.0, gasPricePerUnit = 4.0),
            ),
        )

        val gallon =
            ChargeCostTrackerProjection.estimateGasCost(
                100.0,
                ChargeCostSettings.DEFAULT.copy(gasEfficiencyMpg = 25.0, gasPricePerUnit = 4.0, gasUnit = ChargeCostGasUnit.GALLON),
            )!!
        val litre =
            ChargeCostTrackerProjection.estimateGasCost(
                100.0,
                ChargeCostSettings.DEFAULT.copy(gasEfficiencyMpg = 25.0, gasPricePerUnit = 4.0, gasUnit = ChargeCostGasUnit.LITER),
            )!!
        assertEquals(gallon * ChargeCostTrackerProjection.GALLONS_TO_LITERS, litre, TOLERANCE)
    }

    @Test
    fun formatCurrencyAppliesSymbolPrecisionAndGrouping() {
        assertEquals("$2.40", ChargeCostTrackerProjection.formatCurrency(2.4, ChargeCostSettings.DEFAULT, locale = Locale.US))
        assertEquals("$0.034", ChargeCostTrackerProjection.formatCurrency(0.034, ChargeCostSettings.DEFAULT, 3, Locale.US))
        assertEquals("$1,234.50", ChargeCostTrackerProjection.formatCurrency(1234.5, ChargeCostSettings.DEFAULT, 2, Locale.US))
        assertEquals(
            "\u20AC38",
            ChargeCostTrackerProjection.formatCurrency(37.5, ChargeCostSettings.DEFAULT.copy(currencySymbol = "\u20AC"), 0, Locale.US),
        )
    }

    @Test
    fun formatKwhUsesOneDecimal() {
        assertEquals("20.0", ChargeCostTrackerProjection.formatKwh(20.0, Locale.US))
        assertEquals("312.5", ChargeCostTrackerProjection.formatKwh(312.46, Locale.US))
    }

    // ── Settings derivation (web useFormatting reads) ───────────────────────────

    @Test
    fun settingsFromNullIsAllDefault() {
        val settings = ChargeCostSettings.from(null)

        assertEquals(ChargeCostSettings.DEFAULT_COST_PER_KWH, settings.costPerKwh, TOLERANCE)
        assertEquals("$", settings.resolvedSymbol)
        assertEquals(2, settings.resolvedPrecision)
        assertEquals(0.0, settings.gasEfficiencyMpg, TOLERANCE)
        assertEquals(ChargeCostGasUnit.GALLON, settings.gasUnit)
    }

    @Test
    fun settingsFromDocumentReadsEveryField() {
        val settings =
            ChargeCostSettings.from(
                buildJsonObject {
                    put("base_cost_per_kwh", 0.25)
                    put("currency_symbol", "\u20AC")
                    put("decimal_precision", 3)
                    put("gas_efficiency_mpg", 30.0)
                    put("gas_price_per_unit", 4.5)
                    put("gas_unit", "liter")
                },
            )

        assertEquals(0.25, settings.costPerKwh, TOLERANCE)
        assertEquals("\u20AC", settings.resolvedSymbol)
        assertEquals(3, settings.resolvedPrecision)
        assertEquals(30.0, settings.gasEfficiencyMpg, TOLERANCE)
        assertEquals(4.5, settings.gasPricePerUnit, TOLERANCE)
        assertEquals(ChargeCostGasUnit.LITER, settings.gasUnit)
    }

    @Test
    fun settingsBlankCurrencyAndNegativePrecisionFallBack() {
        val settings =
            ChargeCostSettings.from(
                buildJsonObject {
                    put("currency_symbol", "   ")
                    put("decimal_precision", -1)
                },
            )

        assertEquals("$", settings.resolvedSymbol)
        assertEquals(2, settings.resolvedPrecision)
    }

    @Test
    fun resolvedGettersClampSymbolAndPrecision() {
        val settings = ChargeCostSettings(currencySymbol = "  ", precision = -5)
        assertEquals("$", settings.resolvedSymbol)
        assertEquals(0, settings.resolvedPrecision)
    }

    // ── Per-state surface + error-kind mapping ──────────────────────────────────

    @Test
    fun surfaceMapsEveryPhase() {
        assertEquals(ChargeCostSurface.Loading, chargeCostSurface(UiState<ChargeCostMetrics>(UiPhase.Loading)))
        assertEquals(ChargeCostSurface.Error, chargeCostSurface(UiState<ChargeCostMetrics>(UiPhase.Error)))
        assertEquals(ChargeCostSurface.Empty, chargeCostSurface(UiState<ChargeCostMetrics>(UiPhase.Empty)))
        assertEquals(ChargeCostSurface.Content, chargeCostSurface(UiState<ChargeCostMetrics>(UiPhase.Content)))
    }

    @Test
    fun errorKindMapsConnectivityAndHttpStatus() {
        assertEquals(QueryErrorKind.Offline, chargeCostErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, chargeCostErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, chargeCostErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.NotFound, chargeCostErrorKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, chargeCostErrorKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, chargeCostErrorKind(ErrorKind.Http, HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.ServerError, chargeCostErrorKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, chargeCostErrorKind(ErrorKind.Unknown, null))
    }

    // ── Cached → projection bridge (DTO → metrics) ──────────────────────────────

    @OptIn(ExperimentalTime::class)
    @Test
    fun toMetricsStatePreservesPhaseAndProjectsSessions() {
        val state =
            UiState(
                phase = UiPhase.Content,
                data =
                    listOf(
                        session(totalEnergyAddedWh = 12_000.0),
                        session(totalEnergyAddedWh = null),
                    ),
                fetchedAt = 99L,
                stale = true,
            )

        val projected = state.toMetricsState(ChargeCostPrefs.DEFAULT)

        assertEquals(UiPhase.Content, projected.phase)
        assertEquals(99L, projected.fetchedAt)
        assertTrue(projected.stale)
        // 12000 Wh → 12 kWh; the null energy session collapses to 0 (web `?? 0`).
        assertEquals(12.0, projected.data!!.totalKwh, TOLERANCE)
        assertEquals(2, projected.data!!.sessionCount)
    }

    @OptIn(ExperimentalTime::class)
    @Test
    fun toMetricsStateLeavesDataNullOnHardError() {
        val state = UiState<List<ChargingSession>>(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500)

        val projected = state.toMetricsState(ChargeCostPrefs.DEFAULT)

        assertEquals(UiPhase.Error, projected.phase)
        assertNull(projected.data)
        assertEquals(500, projected.httpStatus)
    }

    // ── Window start + registry constraints ─────────────────────────────────────

    @Test
    fun isoDaysAgoSubtractsTheWindow() {
        // 30 days after the epoch, minus the 30-day window, is the epoch itself.
        assertEquals("1970-01-01T00:00:00Z", isoDaysAgo(THIRTY_DAYS_MILLIS, ChargeCostTrackerRegistration.WINDOW_DAYS))
    }

    @Test
    fun registryIdCategorySlugAndSizesMatchWeb() {
        assertEquals("charge-cost-tracker", ChargeCostTrackerRegistration.ID)
        assertEquals("charging", ChargeCostTrackerRegistration.CATEGORY)
        assertEquals("ChargeCostTrackerWidget", ChargeCostTrackerRegistration.SLUG)
        assertEquals(ChargeCostTrackerSize(2, 2), ChargeCostTrackerRegistration.DEFAULT_SIZE)
        assertEquals(ChargeCostTrackerSize(1, 2), ChargeCostTrackerRegistration.MIN_SIZE)
        assertEquals(ChargeCostTrackerSize(4, 40), ChargeCostTrackerRegistration.MAX_SIZE)
    }

    @Test
    fun registryClampAndBoundsHonourTheFootprint() {
        assertEquals(ChargeCostTrackerSize(1, 2), ChargeCostTrackerRegistration.clamp(ChargeCostTrackerSize(0, 0)))
        assertEquals(ChargeCostTrackerSize(4, 40), ChargeCostTrackerRegistration.clamp(ChargeCostTrackerSize(9, 99)))
        assertTrue(ChargeCostTrackerRegistration.isWithinBounds(ChargeCostTrackerSize(2, 2)))
        assertFalse(ChargeCostTrackerRegistration.isWithinBounds(ChargeCostTrackerSize(0, 1)))
    }

    @Test
    fun sizeCompactAndTallMatchWeb() {
        assertTrue(ChargeCostTrackerSize(1, 1).isCompact)
        assertFalse(ChargeCostTrackerSize(2, 2).isCompact)
        assertFalse(ChargeCostTrackerSize(1, 2).isCompact)
        assertTrue(ChargeCostTrackerSize(2, 2).isTall)
        assertFalse(ChargeCostTrackerSize(2, 1).isTall)
    }

    @OptIn(ExperimentalTime::class)
    private fun session(totalEnergyAddedWh: Double?): ChargingSession =
        ChargingSession(
            id = 1L,
            startedAt = Instant.fromEpochMilliseconds(0L),
            vehicleId = 1L,
            totalEnergyAddedWh = totalEnergyAddedWh,
        )

    private companion object {
        const val TOLERANCE = 0.0001
        const val HTTP_NOT_FOUND = 404
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_SERVER_ERROR = 500
        const val THIRTY_DAYS_MILLIS = 30L * 86_400_000L
    }
}
