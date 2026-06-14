package io.teslasync.android.featureviews.backendtool

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [BackendToolViewModel] over a controllable fake [BackendToolPort], covering the full mutation
 * lifecycle the surface renders (idle → running → done-success / done-failure), the in-flight double-run
 * guard (web `mutation.isPending` disables the button), the offline/transport-failure fold into the
 * failure branch (the non-throwing `apiFetch` catch contract), and the PII-safe `view.opened` + run
 * diagnostics (P1/S11 — surface slug only, never the payload).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BackendToolViewModelTest {
    @Test
    fun startsIdle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = BackendToolViewModel(backendToolPort(success()), NoopLogger, backgroundScope)
            assertEquals(BackendToolActionState.Idle, vm.state.value)
        }

    @Test
    fun runTransitionsIdleToRunningToDoneSuccess() =
        runTest(UnconfinedTestDispatcher()) {
            val gate = CompletableDeferred<Unit>()
            val port = GatedPort(gate, success())
            val vm = BackendToolViewModel(port, NoopLogger, backgroundScope)

            vm.run()
            // The port is suspended at the gate, so the surface is in its loading (running) state.
            assertEquals(BackendToolActionState.Running, vm.state.value)
            assertTrue(vm.state.value.isRunning)

            gate.complete(Unit)
            advanceUntilIdle()

            val done = vm.state.value
            assertTrue(done is BackendToolActionState.Done)
            assertFalse((done as BackendToolActionState.Done).response.isError)
            assertEquals(1, port.runCount)
        }

    @Test
    fun runWithBackendErrorEnvelopeEndsInFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val response = BackendToolResponse.of(buildJsonObject { put("error", "boom") })
            val vm = BackendToolViewModel(backendToolPort(response), NoopLogger, backgroundScope)

            vm.run()
            advanceUntilIdle()

            val done = vm.state.value as BackendToolActionState.Done
            assertTrue(done.response.isError)
            assertEquals("boom", done.response.error)
        }

    @Test
    fun offlineTransportFailureFoldsIntoFailure() =
        runTest(UnconfinedTestDispatcher()) {
            // apiFetch catch → { error }: a no-connectivity run resolves to an error response, not a crash.
            val vm = BackendToolViewModel(backendToolPort(BackendToolResponse.ofError("network unreachable")), NoopLogger, backgroundScope)

            vm.run()
            advanceUntilIdle()

            val done = vm.state.value as BackendToolActionState.Done
            assertTrue(done.response.isError)
            assertEquals("network unreachable", done.response.error)
        }

    @Test
    fun doubleRunWhileInFlightIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val gate = CompletableDeferred<Unit>()
            val port = GatedPort(gate, success())
            val vm = BackendToolViewModel(port, NoopLogger, backgroundScope)

            vm.run()
            vm.run() // ignored — a run is already in flight (web button is disabled by `loading`).
            assertEquals(1, port.runCount)

            gate.complete(Unit)
            advanceUntilIdle()
            assertEquals(1, port.runCount)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = BackendToolViewModel(backendToolPort(success()), logger, backgroundScope)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "BackendTool"), opened.single().second)
        }

    @Test
    fun runLogsStartAndSuccessOutcomeWithoutPayload() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = BackendToolViewModel(backendToolPort(success()), logger, backgroundScope)

            vm.run()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "backendTool.run" })
            assertTrue(logger.events.any { it.first == "backendTool.run.ok" })
            // PII-safe: only the surface slug, never the payload.
            assertEquals(mapOf("surface" to "BackendTool"), logger.events.first { it.first == "backendTool.run" }.second)
        }

    @Test
    fun runLogsFailureOutcomeOnError() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = BackendToolViewModel(backendToolPort(BackendToolResponse.ofError("nope")), logger, backgroundScope)

            vm.run()
            advanceUntilIdle()

            assertTrue(logger.events.any { it.first == "backendTool.run.fail" })
            assertFalse(logger.events.any { it.first == "backendTool.run.ok" })
        }

    // ── fakes / helpers ─────────────────────────────────────────────────────────────

    private fun success(): BackendToolResponse = BackendToolResponse.of(buildJsonObject { put("ok", true) })

    /** A port that suspends at [gate] before returning [response], so the Running state is observable. */
    private class GatedPort(
        private val gate: CompletableDeferred<Unit>,
        private val response: BackendToolResponse,
    ) : BackendToolPort {
        var runCount = 0
            private set

        override suspend fun run(): BackendToolResponse {
            runCount++
            gate.await()
            return response
        }
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
}
