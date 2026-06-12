package io.teslasync.android.featureviews.teslachargingsessionsmap

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [TeslaChargingSessionsMapViewModel] over a controllable fake [ChargingSessionsSource], covering
 * the full cache-then-network state matrix the surface renders (loading / content with a plottable session
 * / empty with no sessions / empty with only coordinate-less sessions / hard error + retry / stale-offline
 * + retry / refresh re-fetch) and the PII-safe `view.opened` + refresh diagnostics. The empty gate is
 * exercised both ways: an empty list AND a list whose rows lack a coordinate both map to empty, while a
 * list with ≥1 valid coordinate maps to content.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaChargingSessionsMapViewModelTest {
    private val plottable = listOf(session(sessionId = 1L, lat = 37.5, lng = -122.25))
    private val coordless = listOf(session(sessionId = 2L, lat = null, lng = null))

    private class FakeSource(
        var emissions: List<Resource<List<TeslaChargingSession>>>,
    ) : ChargingSessionsSource {
        override fun stream(): Flow<Resource<List<TeslaChargingSession>>> = flow { emissions.forEach { emit(it) } }
    }

    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenAPlottableSessionResolves() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(plottable, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(plottable, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoSessions() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptyList<TeslaChargingSession>(), 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun emptyWhenEverySessionLacksACoordinate() =
        runTest(UnconfinedTestDispatcher()) {
            // A present-but-coordinate-less response is the empty map, NOT content.
            val vm = viewModel(FakeSource(listOf(Resource.Success(coordless, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeSource(
                    listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())),
                )
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
        }

    @Test
    fun staleOfflineKeepsCachedSessionsWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(plottable, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(plottable, vm.state.value.data)

            src.emissions = listOf(Resource.Error(plottable, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(plottable, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedSessions() =
        runTest(UnconfinedTestDispatcher()) {
            val updated = listOf(session(sessionId = 3L, lat = 40.0, lng = -74.0))
            val src = FakeSource(listOf(Resource.Success(plottable, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(plottable, vm.state.value.data)

            src.emissions = listOf(Resource.Success(updated, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(updated, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TeslaChargingSessionsMap"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "teslaChargingSessionsMap.refresh" })
        }

    @Test
    fun recordViewOpenedCarriesNoLocationFields() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()

            val fields = logger.events.single { it.first == "view.opened" }.second
            // PII-safe: only the surface slug, never a site name / coordinate / cost / vin.
            assertEquals(mapOf("surface" to "TeslaChargingSessionsMap"), fields)
        }

    private fun TestScope.viewModel(
        source: ChargingSessionsSource,
        logger: Logger = NoopLogger,
    ): TeslaChargingSessionsMapViewModel = TeslaChargingSessionsMapViewModel(source, logger, backgroundScope)

    private companion object {
        fun session(
            sessionId: Long,
            lat: Double?,
            lng: Double?,
        ): TeslaChargingSession =
            TeslaChargingSession(
                sessionId = sessionId,
                siteLocationName = "Site",
                chargeStartDatetime = null,
                totalEnergyAddedWh = null,
                totalCost = null,
                chargerType = null,
                latitude = lat,
                longitude = lng,
            )
    }
}
