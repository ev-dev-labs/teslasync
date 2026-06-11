package io.teslasync.android.dashboard.widgets.mqttstatus

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.VehicleTelemetry
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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [MQTTStatusWidgetViewModel] over a controllable fake [MqttStatusSource], covering the
 * cache-then-network state matrix the web `MQTTStatusWidget` renders: loading (no cache), content on
 * success, hard error (no cache), the stale/offline branch (cached status kept visible with the stale +
 * error flags — web `WidgetShell` freshness), the refresh re-fetch (web `refetch()`), and the PII-safe
 * `view.opened` diagnostic.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MQTTStatusWidgetViewModelTest {
    /** A fake whose feed is re-read on every (re)collection, so a mutation before `refresh()` is observed. */
    private class FakeSource : MqttStatusSource {
        var emissions: List<Resource<TelemetryStatus>> = listOf(loading())

        override fun stream(): Flow<Resource<TelemetryStatus>> = flow { emissions.forEach { emit(it) } }
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
            val vm = viewModel(FakeSource())
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isLoading)
            assertNull(vm.state.value.data)
        }

    @Test
    fun contentOnSuccess() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(status(connected = true), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertTrue(state.isContent)
            assertNotNull(state.data)
            assertEquals(100L, state.fetchedAt)
            assertFalse(state.hasError)
        }

    @Test
    fun errorWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(loading(), Resource.Error(null, null, false, ApiError.Network()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)
            assertNull(vm.state.value.data)
        }

    @Test
    fun staleOfflineKeepsCachedStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Error(status(connected = false), 100L, true, ApiError.Timeout()))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val state = vm.state.value
            assertNotNull(state.data)
            assertTrue(state.stale)
            assertTrue(state.hasError)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun refreshReFetchesStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource()
            src.emissions = listOf(Resource.Success(status(connected = true), 100L, false))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(100L, vm.state.value.fetchedAt)

            src.emissions = listOf(Resource.Success(status(connected = true), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(200L, vm.state.value.fetchedAt)
        }

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "MQTTStatusWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticWithoutPii() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "mqttStatus.refresh" })
            assertFalse(logger.events.any { it.second.containsKey("broker") || it.second.containsKey("vin") })
        }

    private fun TestScope.viewModel(
        source: MqttStatusSource,
        logger: Logger = NoopLogger,
    ): MQTTStatusWidgetViewModel = MQTTStatusWidgetViewModel(source, logger, backgroundScope)

    private companion object {
        fun loading(): Resource<TelemetryStatus> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

        fun status(connected: Boolean): TelemetryStatus =
            TelemetryStatus(
                connected = connected,
                broker = "tcp://mosquitto:1883",
                uptimeSeconds = 1.0,
                vehicles =
                    listOf(
                        VehicleTelemetry(
                            vin = "5YJ3E1EA1KF000001",
                            vehicleId = 1L,
                            state = "streaming",
                            signalCount = 10L,
                            batchCount = 2L,
                            signalsPerSecond = 3.5,
                            lastReceived = "2026-01-01T00:00:00Z",
                            isStreaming = true,
                            dataSource = "fleet_telemetry",
                            latencyMs = null,
                        ),
                    ),
                topics = emptyList(),
            )
    }
}
