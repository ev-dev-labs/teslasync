package io.teslasync.android.data

import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests the confirm-then-run command state machine (ADR-013: commands are never cached as applied). */
@OptIn(ExperimentalCoroutinesApi::class)
class CommandRunnerTest {
    @Test
    fun startsIdle() =
        runTest {
            val runner = CommandRunner("wake", backgroundScope, NoopLogger)

            assertEquals(CommandPhase.Idle, runner.state.value.phase)
        }

    @Test
    fun requestMovesToAwaitingConfirmation() =
        runTest {
            val runner = CommandRunner("wake", backgroundScope, NoopLogger)

            runner.request()

            assertTrue(runner.state.value.isConfirming)
        }

    @Test
    fun dismissReturnsToIdle() =
        runTest {
            val runner = CommandRunner("wake", backgroundScope, NoopLogger)

            runner.request()
            runner.dismiss()

            assertEquals(CommandPhase.Idle, runner.state.value.phase)
        }

    @Test
    fun confirmRunsActionThenSucceedsAndAppliesEffect() =
        runTest {
            var applied = 0
            val runner = CommandRunner("wake", backgroundScope, NoopLogger, onApplied = { applied++ })

            runner.request()
            runner.confirm { Result.success(Unit) }
            runCurrent()

            assertEquals(CommandPhase.Succeeded, runner.state.value.phase)
            assertEquals(1, applied)
        }

    @Test
    fun confirmFailureSurfacesErrorKindAndSkipsEffect() =
        runTest {
            var applied = 0
            val runner = CommandRunner("wake", backgroundScope, NoopLogger, onApplied = { applied++ })

            runner.request()
            runner.confirm { Result.failure<Unit>(ApiError.Http(status = 408)) }
            runCurrent()

            assertEquals(CommandPhase.Failed, runner.state.value.phase)
            assertEquals(ErrorKind.Http, runner.state.value.errorKind)
            assertEquals(408, runner.state.value.httpStatus)
            assertEquals(0, applied)
        }

    @Test
    fun confirmWithoutAPendingConfirmationIsNoOp() =
        runTest {
            val runner = CommandRunner("wake", backgroundScope, NoopLogger)

            runner.confirm { Result.success(Unit) }
            runCurrent()

            assertEquals(CommandPhase.Idle, runner.state.value.phase)
        }
}
