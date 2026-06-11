package io.teslasync.android.dashboard.widgets.chargestatuslive

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.VehicleState
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
import kotlin.time.Instant

/**
 * Drives [ChargeStatusLiveWidgetViewModel] over a controllable fake [ChargeStatusLiveSource], covering
 * the full cache-then-network state matrix the web component renders (loading / content / empty / hard
 * error + retry / stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic
 * and the refresh event — end to end through the real [UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargeStatusLiveWidgetViewModelTest {
    private val charging = snapshot(chargerPower = 11.0, energyWh = 12_345.0)
    private val refreshed = snapshot(chargerPower = 7.0, energyWh = 20_000.0)
    private val emptySnapshot = ChargeStatusLiveSnapshot(state = null, latestSession = null)

    private class FakeSource(
        var emissions: List<Resource<ChargeStatusLiveSnapshot>>,
    ) : ChargeStatusLiveSource {
        override fun stream(): Flow<Resource<ChargeStatusLiveSnapshot>> = flow { emissions.forEach { emit(it) } }
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
    fun contentWhenLoaded() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(charging, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(charging, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoVehicleState() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(emptySnapshot, 100L, false))))
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
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(charging, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(charging, vm.state.value.data)

            src.emissions = listOf(Resource.Error(charging, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(charging, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedSnapshot() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(charging, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(charging, vm.state.value.data)

            src.emissions = listOf(Resource.Success(refreshed, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(refreshed, vm.state.value.data)
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
            assertEquals(mapOf("surface" to "ChargeStatusLiveWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "chargeStatusLive.refresh" })
        }

    private fun TestScope.viewModel(
        source: ChargeStatusLiveSource,
        logger: Logger = NoopLogger,
    ): ChargeStatusLiveWidgetViewModel = ChargeStatusLiveWidgetViewModel(source, logger, backgroundScope)

    private fun snapshot(
        chargerPower: Double,
        energyWh: Double,
    ): ChargeStatusLiveSnapshot =
        ChargeStatusLiveSnapshot(
            state =
                VehicleState(
                    batteryLevel = 82,
                    chargeRate = 50_000.0,
                    chargerPower = chargerPower,
                    idealRange = 300_000.0,
                    insideTemp = 21.0,
                    isCharging = true,
                    isClimateOn = false,
                    isLocked = true,
                    latitude = 0.0,
                    longitude = 0.0,
                    odometer = 0.0,
                    outsideTemp = 10.0,
                    power = 0.0,
                    ratedRange = 300_000.0,
                    sentryMode = false,
                    softwareVersion = "2026.4",
                    speed = 0.0,
                    state = "charging",
                    timeToFullCharge = 1.5,
                    vehicleId = 1L,
                ),
            latestSession =
                ChargingSession(
                    id = 1L,
                    startedAt = Instant.fromEpochMilliseconds(0L),
                    vehicleId = 1L,
                    totalEnergyAddedWh = energyWh,
                ),
        )
}
