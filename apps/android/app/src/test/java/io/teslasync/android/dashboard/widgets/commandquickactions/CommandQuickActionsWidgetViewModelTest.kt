package io.teslasync.android.dashboard.widgets.commandquickactions

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.vehiclecommand.CommandResult
import kotlinx.coroutines.CompletableDeferred
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
 * Drives [CommandQuickActionsWidgetViewModel] over controllable fakes, covering the full
 * cache-then-network state matrix the web component renders (loading / content / empty / hard error +
 * retry / stale-offline + retry / refresh re-fetch) plus the command-dispatch behaviour: the in-flight
 * [CommandQuickActionsWidgetViewModel.activeCommand] flag, the disable-while-running gate, the terminal
 * `CommandOutcome` event for success / rejected / failure, the no-vehicle no-op, and the PII-safe
 * `view.opened` diagnostic — end to end through the real [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CommandQuickActionsWidgetViewModelTest {
    private val withVehicle = CommandQuickActionsSnapshot(vehicleId = 7L)
    private val noVehicle = CommandQuickActionsSnapshot(vehicleId = 0L)

    private class FakeSource(
        var emissions: List<Resource<CommandQuickActionsSnapshot>>,
    ) : CommandQuickActionsSource {
        override fun stream(): Flow<Resource<CommandQuickActionsSnapshot>> = flow { emissions.forEach { emit(it) } }
    }

    private class FakeCommander(
        var result: Result<CommandResult> = Result.success(CommandResult(success = true, message = "ok")),
    ) : CommandQuickActionsCommander {
        val sent = mutableListOf<Pair<Long, String>>()
        var gate: CompletableDeferred<Unit>? = null

        override suspend fun send(
            vehicleId: Long,
            command: String,
        ): Result<CommandResult> {
            sent += vehicleId to command
            gate?.await()
            return result
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

    // ---- state matrix ----------------------------------------------------------------

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenVehicleResolved() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(withVehicle, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(7L, requireNotNull(vm.state.value.data).vehicleId)
        }

    @Test
    fun emptyWhenNoVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(noVehicle, 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network()))),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertTrue(vm.state.value.canRetry)
        }

    @Test
    fun staleOfflineKeepsScopeWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(withVehicle, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            src.emissions = listOf(Resource.Error(withVehicle, 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(7L, state.data?.vehicleId)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshReFetchesUpdatedScope() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(withVehicle, 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(7L, requireNotNull(vm.state.value.data).vehicleId)

            src.emissions = listOf(Resource.Success(CommandQuickActionsSnapshot(9L), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(9L, requireNotNull(vm.state.value.data).vehicleId)
        }

    // ---- command dispatch ------------------------------------------------------------

    @Test
    fun sendCommandRunsThenClearsActiveAndEmitsSuccessOutcome() =
        runTest(UnconfinedTestDispatcher()) {
            val commander = FakeCommander().apply { gate = CompletableDeferred() }
            val vm = viewModel(FakeSource(listOf(Resource.Success(withVehicle, 100L, false))), commander = commander)
            val outcomes = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.state.collect {} }
            backgroundScope.launch { vm.events.collect { outcomes += it } }
            advanceUntilIdle()

            vm.sendCommand("lock")
            advanceUntilIdle()
            // In flight: the command is dispatched and the active flag is set while it awaits.
            assertEquals(listOf(7L to "lock"), commander.sent)
            assertEquals("lock", vm.activeCommand.value)

            commander.gate?.complete(Unit)
            advanceUntilIdle()
            assertNull(vm.activeCommand.value)
            val outcome = outcomes.filterIsInstance<UiEvent.CommandOutcome>().single()
            assertEquals("lock", outcome.commandKey)
            assertTrue(outcome.success)
        }

    @Test
    fun sendCommandNoOpWithoutVehicle() =
        runTest(UnconfinedTestDispatcher()) {
            val commander = FakeCommander()
            val vm = viewModel(FakeSource(listOf(Resource.Success(noVehicle, 100L, false))), commander = commander)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.sendCommand("lock")
            advanceUntilIdle()
            assertTrue(commander.sent.isEmpty())
            assertNull(vm.activeCommand.value)
        }

    @Test
    fun sendCommandIgnoredWhileAnotherIsInFlight() =
        runTest(UnconfinedTestDispatcher()) {
            val commander = FakeCommander().apply { gate = CompletableDeferred() }
            val vm = viewModel(FakeSource(listOf(Resource.Success(withVehicle, 100L, false))), commander = commander)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            vm.sendCommand("lock")
            advanceUntilIdle()
            vm.sendCommand("unlock")
            advanceUntilIdle()
            // The second tap is rejected while "lock" is still running (web disables every button).
            assertEquals(listOf(7L to "lock"), commander.sent)

            commander.gate?.complete(Unit)
            advanceUntilIdle()
        }

    @Test
    fun sendCommandFailureClearsActiveAndEmitsFailureOutcome() =
        runTest(UnconfinedTestDispatcher()) {
            val commander = FakeCommander(result = Result.failure(ApiError.Network()))
            val vm = viewModel(FakeSource(listOf(Resource.Success(withVehicle, 100L, false))), commander = commander)
            val outcomes = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.state.collect {} }
            backgroundScope.launch { vm.events.collect { outcomes += it } }
            advanceUntilIdle()

            vm.sendCommand("flash_lights")
            advanceUntilIdle()
            assertNull(vm.activeCommand.value)
            val outcome = outcomes.filterIsInstance<UiEvent.CommandOutcome>().single()
            assertEquals("flash_lights", outcome.commandKey)
            assertFalse(outcome.success)
        }

    @Test
    fun sendCommandRejectedResultEmitsUnsuccessfulOutcome() =
        runTest(UnconfinedTestDispatcher()) {
            val commander = FakeCommander(result = Result.success(CommandResult(success = false, message = "declined")))
            val vm = viewModel(FakeSource(listOf(Resource.Success(withVehicle, 100L, false))), commander = commander)
            val outcomes = mutableListOf<UiEvent>()
            backgroundScope.launch { vm.state.collect {} }
            backgroundScope.launch { vm.events.collect { outcomes += it } }
            advanceUntilIdle()

            vm.sendCommand("honk_horn")
            advanceUntilIdle()
            val outcome = outcomes.filterIsInstance<UiEvent.CommandOutcome>().single()
            assertEquals("honk_horn", outcome.commandKey)
            assertFalse(outcome.success)
        }

    // ---- diagnostics -----------------------------------------------------------------

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger = logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "CommandQuickActionsWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "commandQuickActions.refresh" })
        }

    private fun TestScope.viewModel(
        source: CommandQuickActionsSource,
        commander: CommandQuickActionsCommander = FakeCommander(),
        logger: Logger = NoopLogger,
    ): CommandQuickActionsWidgetViewModel = CommandQuickActionsWidgetViewModel(source, commander, logger, backgroundScope)
}
