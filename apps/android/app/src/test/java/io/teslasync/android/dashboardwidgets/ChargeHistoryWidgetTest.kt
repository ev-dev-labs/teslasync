package io.teslasync.android.dashboardwidgets

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * Framework-free unit tests for the ChargeHistory widget — the SI→kWh conversion, the `.reverse()`
 * chart shaping, the `hasData` (>1 point) gate, the `Total`/`Avg` stat math, the vehicle-id resolution,
 * the two-source cache-then-network adapter, the error-kind mapping and the ViewModel bound to a fake
 * [ChargeHistorySource]. These run in the `:android:testReleaseUnitTest` gate and cover the behavior the
 * composables only render.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargeHistoryWidgetTest {
    private val totalLabel = "Total"
    private val avgLabel = "Avg"
    private val unit = "kWh"
    private val standard = ChargeHistorySize(cols = 2, rows = 4)

    // ── projection: SI→kWh, reverse, hasData (>1), Total/Avg (web chartData / hasData / stats) ──
    @Test
    fun projectConvertsReversesAndComputesStats() {
        val snapshot = ChargeHistorySnapshot(listOf(12_000.0, 8_000.0, 16_000.0))
        val display = ChargeHistoryProjection.project(snapshot, standard, totalLabel, avgLabel, unit)

        assertFalse(display.isCompact)
        assertTrue(display.hasData)
        // SI Wh → kWh, then reversed to oldest→newest (web .map().reverse()).
        assertEquals(listOf(16.0, 8.0, 12.0), display.chartValues)
        assertEquals(listOf("2", "1", "0"), display.xLabels)
        assertEquals(2, display.stats.size)
        assertEquals(totalLabel, display.stats[0].label)
        assertEquals(unit, display.stats[0].unit)
        assertEquals(avgLabel, display.stats[1].label)
        assertEquals(ChartFormat.number(36.0, 1), display.stats[0].value)
        assertEquals(ChartFormat.number(12.0, 1), display.stats[1].value)
    }

    @Test
    fun projectSingleSessionIsNotChartData() {
        val display =
            ChargeHistoryProjection.project(ChargeHistorySnapshot(listOf(10_000.0)), standard, totalLabel, avgLabel, unit)
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertEquals(listOf(10.0), display.chartValues)
    }

    @Test
    fun projectEmptyHasNoDataNoStats() {
        val display = ChargeHistoryProjection.project(ChargeHistorySnapshot.EMPTY, standard, totalLabel, avgLabel, unit)
        assertFalse(display.hasData)
        assertTrue(display.stats.isEmpty())
        assertTrue(display.chartValues.isEmpty())
    }

    @Test
    fun compactSizeStillCarriesStats() {
        val display =
            ChargeHistoryProjection.project(
                ChargeHistorySnapshot(listOf(4_000.0, 6_000.0)),
                ChargeHistorySize(cols = 1, rows = 2),
                totalLabel,
                avgLabel,
                unit,
            )
        assertTrue(display.isCompact)
        assertTrue(display.hasData)
        assertEquals(2, display.stats.size)
    }

    // ── snapshot parsing (web `?? 0` tolerance, hasData gate) ───────────────────
    @Test
    fun fromSessionsReadsEnergyWithNullTolerance() {
        val snapshot = ChargeHistorySnapshot.fromSessions(listOf(session(1, 12_000.0), session(2, null)))
        assertEquals(listOf(12_000.0, 0.0), snapshot.energiesWh)
    }

    @Test
    fun hasChartDataRequiresMoreThanOnePoint() {
        assertFalse(ChargeHistorySnapshot.EMPTY.hasChartData)
        assertFalse(ChargeHistorySnapshot(listOf(1.0)).hasChartData)
        assertTrue(ChargeHistorySnapshot(listOf(1.0, 2.0)).hasChartData)
    }

    // ── vehicle-id resolution (web id = vehicleId ?? vehicles?.[0]?.id ?? 0) ─────
    @Test
    fun resolveVehicleIdPrefersExplicitThenFirstThenZero() {
        assertEquals(7L, resolveVehicleId(7L, listOf(vehicle(42L))))
        assertEquals(42L, resolveVehicleId(null, listOf(vehicle(42L), vehicle(9L))))
        assertEquals(0L, resolveVehicleId(null, emptyList()))
        assertEquals(0L, resolveVehicleId(null, null))
    }

    // ── size + registry descriptor parity (web registry/charging.ts) ────────────
    @Test
    fun sizeModelAndDescriptorMatchRegistry() {
        assertTrue(ChargeHistorySize(cols = 1, rows = 2).isCompact)
        assertFalse(ChargeHistorySize(cols = 2, rows = 4).isCompact)
        assertEquals("charge-history", ChargeHistoryWidgetDescriptor.ID)
        assertEquals("charging", ChargeHistoryWidgetDescriptor.CATEGORY)
        assertEquals("ChargeHistoryWidget", ChargeHistoryWidgetDescriptor.SURFACE_SLUG)
        assertEquals(ChargeHistorySize(cols = 2, rows = 4), ChargeHistoryWidgetDescriptor.defaultSize)
        assertEquals(ChargeHistorySize(cols = 2, rows = 2), ChargeHistoryWidgetDescriptor.minSize)
        assertEquals(ChargeHistorySize(cols = 4, rows = 40), ChargeHistoryWidgetDescriptor.maxSize)
    }

    // ── error-kind mapping (offline vs http status vs transient) ────────────────
    @Test
    fun errorKindMapsStatusAndConnectivity() {
        assertEquals(QueryErrorKind.Offline, chargeHistoryErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, chargeHistoryErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.NotFound, chargeHistoryErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.Unauthorized, chargeHistoryErrorKind(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.ServerError, chargeHistoryErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Waiting, chargeHistoryErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, chargeHistoryErrorKind(ErrorKind.Unknown, null))
    }

    // ── two-source adapter (vehicles → id → recent charging) ────────────────────
    @Test
    fun adapterEmitsEmptyWhenNoVehicleResolves() =
        runTest {
            val vehicles = flowOf(success(emptyList<Vehicle>()))
            val result = chargeHistoryResource(vehicles, null) { flowOf(success(listOf(session(1, 1_000.0)))) }.toList().last()
            assertTrue(result is Resource.Success)
            assertFalse(result.cached!!.hasChartData)
            assertTrue(result.cached!!.energiesWh.isEmpty())
        }

    @Test
    fun adapterMapsSessionsToSnapshotForFirstVehicle() =
        runTest {
            val vehicles = flowOf(success(listOf(vehicle(42L))))
            var requestedId = -1L
            val result =
                chargeHistoryResource(vehicles, null) { id ->
                    requestedId = id
                    flowOf(success(listOf(session(1, 12_000.0), session(2, 8_000.0))))
                }.toList().last()
            assertEquals(42L, requestedId)
            assertTrue(result is Resource.Success)
            assertEquals(listOf(12_000.0, 8_000.0), result.cached!!.energiesWh)
            assertTrue(result.cached!!.hasChartData)
        }

    @Test
    fun adapterUsesExplicitVehicleIdOverList() =
        runTest {
            val vehicles = flowOf(success(listOf(vehicle(42L))))
            var requestedId = -1L
            chargeHistoryResource(vehicles, explicitVehicleId = 7L) { id ->
                requestedId = id
                flowOf(success(listOf(session(1, 1_000.0), session(2, 2_000.0))))
            }.toList()
            assertEquals(7L, requestedId)
        }

    @Test
    fun adapterStaysLoadingWhileSessionsLoad() =
        runTest {
            val vehicles = flowOf(success(listOf(vehicle(1L))))
            val result = chargeHistoryResource(vehicles, null) { flowOf(Resource.Loading(null, null, false)) }.toList().last()
            assertTrue(result is Resource.Loading)
        }

    @Test
    fun adapterKeepsCachedSessionsOnErrorAsOffline() =
        runTest {
            val vehicles = flowOf(success(listOf(vehicle(1L))))
            val cached = listOf(session(1, 1_000.0), session(2, 2_000.0))
            val errored: Flow<Resource<List<ChargingSession>>> =
                flowOf(Resource.Error(cached, 50L, stale = true, error = ApiError.Network()))
            val result = chargeHistoryResource(vehicles, null) { errored }.toList().last()
            assertTrue(result is Resource.Error)
            assertTrue(result.stale)
            assertEquals(2, result.cached!!.energiesWh.size)
        }

    // ── ViewModel bound to a fake source ────────────────────────────────────────
    @Test
    fun viewModelProjectsContentFromSource() =
        runTest(UnconfinedTestDispatcher()) {
            val snapshot = ChargeHistorySnapshot(listOf(12_000.0, 8_000.0, 16_000.0))
            val source = FakeChargeHistorySource(listOf(Resource.Loading(null, null, false), success(snapshot)))
            val viewModel = ChargeHistoryWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.data!!.hasChartData)
        }

    @Test
    fun viewModelOneSessionIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeChargeHistorySource(listOf(success(ChargeHistorySnapshot(listOf(10_000.0)))))
            val viewModel = ChargeHistoryWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, viewModel.state.value.phase)
        }

    @Test
    fun viewModelHardErrorIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeChargeHistorySource(listOf(Resource.Error(null, null, stale = false, error = ApiError.Network())))
            val viewModel = ChargeHistoryWidgetViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()

            val state = viewModel.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
        }

    @Test
    fun onAppearEmitsViewOpenedTelemetryOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val viewModel =
                ChargeHistoryWidgetViewModel(
                    FakeChargeHistorySource(listOf(Resource.Loading(null, null, false))),
                    logger,
                    backgroundScope,
                )
            viewModel.onAppear()
            viewModel.onAppear()

            val opened = logger.records.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ChargeHistoryWidget", opened.first().second["surface"])
        }

    @Test
    fun refreshRestartsUpstreamCollection() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeChargeHistorySource(listOf(success(ChargeHistorySnapshot(listOf(1_000.0, 2_000.0)))))
            val logger = RecordingLogger()
            val viewModel = ChargeHistoryWidgetViewModel(source, logger, backgroundScope)
            backgroundScope.launch { viewModel.state.collect {} }
            advanceUntilIdle()
            val before = source.streamCount

            viewModel.refresh()
            advanceUntilIdle()

            assertTrue(source.streamCount > before)
            assertTrue(logger.records.any { it.first == "chargeHistory.refresh" })
        }

    // ── helpers ──────────────────────────────────────────────────────────────────
    private fun <T> success(payload: T): Resource<T> = Resource.Success(payload, fetchedAt = 100L, stale = false)

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = EPOCH,
            displayName = "Car $id",
            enrolledAt = EPOCH,
            id = id,
            teslaId = id,
            timezone = "UTC",
            updatedAt = EPOCH,
            vin = "VIN$id",
        )

    private fun session(
        id: Long,
        energyWh: Double?,
    ): ChargingSession =
        ChargingSession(
            id = id,
            startedAt = EPOCH,
            vehicleId = 1L,
            totalEnergyAddedWh = energyWh,
        )

    private companion object {
        val EPOCH: Instant = Instant.fromEpochMilliseconds(0)
    }

    /** A [Logger] that records every event + fields, for telemetry assertions. */
    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(event to fields)
        }
    }

    /** A fake [ChargeHistorySource] that replays a hand-built emission list and counts re-collections. */
    private class FakeChargeHistorySource(
        private val emissions: List<Resource<ChargeHistorySnapshot>>,
    ) : ChargeHistorySource {
        var streamCount = 0
            private set

        override fun stream(): Flow<Resource<ChargeHistorySnapshot>> {
            streamCount++
            return flow { emissions.forEach { emit(it) } }
        }
    }
}
