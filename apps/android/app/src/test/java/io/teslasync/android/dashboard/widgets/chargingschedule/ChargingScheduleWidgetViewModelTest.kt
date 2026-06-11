package io.teslasync.android.dashboard.widgets.chargingschedule

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.signals.LiveSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalEnvelope
import io.teslasync.shared.core.presentation.signals.SignalKind
import io.teslasync.shared.core.presentation.signals.SignalValue
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ChargingScheduleWidgetViewModel] over a controllable fake [ChargingScheduleSource], covering the
 * full cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch) plus the PII-safe `view.opened` diagnostic and the
 * refresh event. Also unit-tests the pure [combineScheduleResources] adapter (live-signals freshness
 * primary, latest vehicle state folded into the snapshot).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingScheduleWidgetViewModelTest {
    private val scheduled = scheduleData(mode = "StartAt")
    private val scheduledOff = scheduleData(mode = "Off")

    private class FakeScheduleSource(
        var emissions: List<Resource<ChargingScheduleData>>,
    ) : ChargingScheduleSource {
        override fun schedule(): Flow<Resource<ChargingScheduleData>> = flow { emissions.forEach { emit(it) } }
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

    // ---- state matrix ---------------------------------------------------------------

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeScheduleSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenScheduleData() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeScheduleSource(listOf(Resource.Loading(null, null, false), Resource.Success(scheduled, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(scheduled, state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun emptyWhenNoScheduleData() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeScheduleSource(listOf(Resource.Success(ChargingScheduleData.EMPTY, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src =
                FakeScheduleSource(
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
            val src = FakeScheduleSource(listOf(Resource.Success(scheduled, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(scheduled, vm.state.value.data)

            src.emissions = listOf(Resource.Error(scheduled, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(scheduled, state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun refreshReFetchesUpdatedSchedule() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeScheduleSource(listOf(Resource.Success(scheduled, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(scheduled, vm.state.value.data)

            src.emissions = listOf(Resource.Success(scheduledOff, 200L, false))
            vm.refresh()
            advanceUntilIdle()

            assertEquals(scheduledOff, vm.state.value.data)
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeScheduleSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ChargingScheduleWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeScheduleSource(emptyList()), logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "chargingSchedule.refresh" })
        }

    // ---- combineScheduleResources adapter -------------------------------------------

    @Test
    fun combineFoldsLatestStateIntoSignalsSuccess() {
        val signals = Resource.Success(liveResponse(mode = "StartAt"), 150L, false)
        val state = Resource.Success(VehicleStateEnvelope(vehicleState(58, true), live = true), 120L, false)

        val combined = combineScheduleResources(signals, state)
        assertTrue(combined is Resource.Success)
        val success = combined as Resource.Success
        assertEquals(150L, success.fetchedAt)
        assertEquals("StartAt", (success.data.signals[ScheduleSignalKeys.MODE]?.value as SignalValue.Text).value)
        assertEquals(58L, success.data.state?.batteryLevel)
        assertTrue(success.data.state?.isCharging == true)
    }

    @Test
    fun combineFollowsSignalsLoadingWithCache() {
        val signals = Resource.Loading(liveResponse(mode = "Off"), 90L, stale = false)
        val state = Resource.Success(VehicleStateEnvelope(vehicleState(40, false), live = false), 80L, false)

        val combined = combineScheduleResources(signals, state)
        assertTrue(combined is Resource.Loading)
        val loading = combined as Resource.Loading
        assertEquals(90L, loading.fetchedAt)
        assertEquals(40L, loading.cached?.state?.batteryLevel)
    }

    @Test
    fun combineFollowsSignalsErrorAndFoldsCachedState() {
        val signals = Resource.Error(liveResponse(mode = "StartAt"), 70L, stale = true, ApiError.Network())
        val state = Resource.Error(VehicleStateEnvelope(vehicleState(33, false), live = false), 60L, true, ApiError.Timeout())

        val combined = combineScheduleResources(signals, state)
        assertTrue(combined is Resource.Error)
        val error = combined as Resource.Error
        assertTrue(error.stale)
        assertEquals(33L, error.cached?.state?.batteryLevel)
    }

    @Test
    fun combineLeavesStateNullWhenStateUnloaded() {
        val signals = Resource.Success(liveResponse(mode = "StartAt"), 150L, false)
        val state = Resource.Loading<VehicleStateEnvelope>(null, null, false)

        val combined = combineScheduleResources(signals, state)
        val success = combined as Resource.Success
        assertNull(success.data.state)
        assertFalse(success.data.signals.isEmpty())
    }

    // ---- helpers --------------------------------------------------------------------

    private fun TestScope.viewModel(
        source: ChargingScheduleSource,
        logger: Logger = NoopLogger,
    ): ChargingScheduleWidgetViewModel = ChargingScheduleWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        private const val TS = "2026-06-11T10:00:00Z"

        fun scheduleData(mode: String): ChargingScheduleData =
            ChargingScheduleData(
                signals = mapOf(ScheduleSignalKeys.MODE to SignalEnvelope(SignalKind.String, SignalValue.Text(mode), TS)),
                state = null,
            )

        fun liveResponse(mode: String): LiveSignalsResponse =
            LiveSignalsResponse(
                vehicleId = 1,
                count = 1,
                at = TS,
                signals = mapOf(ScheduleSignalKeys.MODE to SignalEnvelope(SignalKind.String, SignalValue.Text(mode), TS)),
            )

        fun vehicleState(
            batteryLevel: Long,
            isCharging: Boolean,
        ): VehicleState =
            VehicleState(
                batteryLevel = batteryLevel,
                chargeRate = 0.0,
                chargerPower = 0.0,
                idealRange = 0.0,
                insideTemp = 21.0,
                isCharging = isCharging,
                isClimateOn = false,
                isLocked = true,
                latitude = 0.0,
                longitude = 0.0,
                odometer = 0.0,
                outsideTemp = 18.0,
                power = 0.0,
                ratedRange = 0.0,
                sentryMode = false,
                softwareVersion = "2026.0",
                speed = 0.0,
                state = "online",
                timeToFullCharge = 0.0,
                vehicleId = 1,
            )
    }
}
