package io.teslasync.android.watch.watchface

import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.watch.WatchCommandResult
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.asFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [WatchFacePageViewModel] against the [WatchFacePageSource] seam with a fake feed, plus the pure
 * [WatchFaceProjection] / [BatteryColorBand] / [WatchStateTone] model directly — covering every state the web
 * page renders (the parity items `state:loading` and `state:success`, plus the empty / hard-error /
 * offline-cached surfaces), the SI→display range / cabin-temperature / time-to-full conversions, the lock /
 * climate command dispatch + outcome event + in-flight flag, the refresh + retry re-fetch, and the one-shot
 * PII-safe `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WatchFacePageViewModelTest {
    // ── PARITY state:loading ──────────────────────────────────────────────────────
    @Test
    fun summaryLoadingIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(summary = listOf(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            val vm = WatchFacePageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.state.value.phase)
            assertFalse(vm.state.value.hasData)
        }

    // ── PARITY state:success ──────────────────────────────────────────────────────
    @Test
    fun decodedSummaryIsContentPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(summary = listOf(success(sample(72.0))))
            val vm = WatchFacePageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(72.0, ui.data?.batteryLevel ?: 0.0, 0.0)
            assertTrue(ui.hasData)
        }

    @Test
    fun blankSummaryIsEmptyPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(summary = listOf(success(WatchSummary())))
            val vm = WatchFacePageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary = listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            val vm = WatchFacePageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertTrue(ui.canRetry)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedSummaryWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary =
                        listOf(
                            Resource.Error(cached = sample(50.0), fetchedAt = 100L, stale = true, error = ApiError.Network()),
                        ),
                )
            val vm = WatchFacePageViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(50.0, ui.data?.batteryLevel ?: 0.0, 0.0)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    // ── Command dispatch (web useWatchCommand) ────────────────────────────────────
    @Test
    fun sendCommandDispatchesEmitsSuccessOutcomeAndClearsSending() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary = listOf(success(sample(60.0))),
                    commandResult = Result.success(WatchCommandResult(success = true)),
                )
            val vm = WatchFacePageViewModel(source, RecordingLogger(), backgroundScope, vehicleId = 7L)
            val events = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.events.collect { events.add(it) } }

            vm.sendCommand("lock")
            advanceUntilIdle()

            assertEquals("lock", source.lastCommand)
            assertEquals(7L, source.lastCommandVehicleId)
            val outcome = events.filterIsInstance<UiEvent.CommandOutcome>().last()
            assertEquals("lock", outcome.commandKey)
            assertTrue(outcome.success)
            assertFalse(vm.sending.value)
        }

    @Test
    fun rejectedCommandEmitsFailureOutcome() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary = listOf(success(sample(60.0))),
                    commandResult = Result.success(WatchCommandResult(success = false)),
                )
            val vm = WatchFacePageViewModel(source, RecordingLogger(), backgroundScope)
            val events = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.events.collect { events.add(it) } }

            vm.sendCommand("climate_on")
            advanceUntilIdle()

            val outcome = events.filterIsInstance<UiEvent.CommandOutcome>().last()
            assertEquals("climate_on", outcome.commandKey)
            assertFalse(outcome.success)
        }

    @Test
    fun transportFailureEmitsFailureOutcome() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    summary = listOf(success(sample(60.0))),
                    commandResult = Result.failure(ApiError.Network()),
                )
            val vm = WatchFacePageViewModel(source, RecordingLogger(), backgroundScope)
            val events = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.events.collect { events.add(it) } }

            vm.sendCommand("unlock")
            advanceUntilIdle()

            assertFalse(events.filterIsInstance<UiEvent.CommandOutcome>().last().success)
        }

    // ── refresh / retry / telemetry ───────────────────────────────────────────────
    @Test
    fun refreshReFetchesAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(summary = listOf(success(sample(80.0))))
            val vm = WatchFacePageViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            val before = source.summaryCalls

            vm.refresh()
            advanceUntilIdle()

            assertTrue(source.summaryCalls > before)
            assertTrue(logger.records.any { it.event == "watchFace.refresh" })
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = WatchFacePageViewModel(FakeSource(summary = emptyList()), logger, backgroundScope)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("WatchFacePage", opened.first().fields["surface"])
        }

    // ── pure model: projection + bands + tone ─────────────────────────────────────
    @Test
    fun projectionConvertsSiAndFlagsForContent() {
        val display =
            WatchFaceProjection.project(
                sample(73.0).copy(rangeKm = 312.0, insideTempC = 21.0, isLocked = true, sentryMode = true),
                UnitFormatter.default(),
            )
        assertTrue(display.hasData)
        assertEquals("Model 3", display.vehicleName)
        assertEquals(BatteryColorBand.Green, display.colorBand)
        assertTrue(display.rangeText.isNotBlank())
        assertTrue(display.cabinTempText.isNotBlank())
        assertTrue(display.isLocked)
        assertTrue(display.sentryMode)
    }

    @Test
    fun batteryBandThresholdsMatchWebPage() {
        // web getBatteryColor: > 40 green, > 20 amber, else red.
        assertEquals(BatteryColorBand.Green, BatteryColorBand.forLevel(41.0))
        assertEquals(BatteryColorBand.Amber, BatteryColorBand.forLevel(40.0))
        assertEquals(BatteryColorBand.Amber, BatteryColorBand.forLevel(21.0))
        assertEquals(BatteryColorBand.Red, BatteryColorBand.forLevel(20.0))
        assertEquals(BatteryColorBand.Red, BatteryColorBand.forLevel(0.0))
    }

    @Test
    fun stateToneMatchesWebVariant() {
        assertEquals(WatchStateTone.Info, WatchStateTone.forState("driving"))
        assertEquals(WatchStateTone.Success, WatchStateTone.forState("charging"))
        assertEquals(WatchStateTone.Neutral, WatchStateTone.forState("online"))
        assertEquals(WatchStateTone.Neutral, WatchStateTone.forState("asleep"))
    }

    @Test
    fun projectionIsEmptyForBlankSummary() {
        assertFalse(WatchFaceProjection.project(WatchSummary(), UnitFormatter.default()).hasData)
        assertTrue(WatchFaceProjection.isEmpty(WatchSummary()))
    }

    @Test
    fun parsesLastUpdatedStamp() {
        assertTrue((WatchFaceProjection.parseLastUpdatedMillis("2026-06-11T18:25:00Z") ?: 0L) > 0L)
        assertEquals(null, WatchFaceProjection.parseLastUpdatedMillis(""))
        assertEquals(null, WatchFaceProjection.parseLastUpdatedMillis("not-a-date"))
    }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val summary: List<Resource<WatchSummary>>,
        private val commandResult: Result<WatchCommandResult> = Result.success(WatchCommandResult(success = true)),
    ) : WatchFacePageSource {
        var summaryCalls = 0
            private set
        var lastCommand: String? = null
            private set
        var lastCommandVehicleId: Long? = null
            private set

        override fun watchSummary(vehicleId: Long?): Flow<Resource<WatchSummary>> {
            summaryCalls++
            return summary.asFlow()
        }

        override suspend fun sendWatchCommand(
            vehicleId: Long?,
            command: String,
        ): Result<WatchCommandResult> {
            lastCommand = command
            lastCommandVehicleId = vehicleId
            return commandResult
        }
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records.add(LogRecord(level, event, fields))
        }
    }

    private fun success(summary: WatchSummary): Resource<WatchSummary> = Resource.Success(summary, fetchedAt = 100L, stale = false)

    private fun sample(level: Double): WatchSummary =
        WatchSummary(
            vehicleName = "Model 3",
            state = "online",
            batteryLevel = level,
            rangeKm = 312.0,
            isLocked = true,
            insideTempC = 21.0,
            lastUpdated = "2026-06-11T18:25:00Z",
        )
}
