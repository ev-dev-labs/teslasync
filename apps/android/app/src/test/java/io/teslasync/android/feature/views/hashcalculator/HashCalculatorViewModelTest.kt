package io.teslasync.android.feature.views.hashcalculator

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [HashCalculatorViewModel] over a controllable fake [HashCalculatorEngine], covering every state the
 * surface renders (empty → content on compute, blank-input no-op, hard error + retry, failing-recompute keeps
 * the last-known digest stale, retry recovery) and the PII-safe `view.opened` + compute diagnostics (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HashCalculatorViewModelTest {
    @Test
    fun startsEmptyBeforeAnyCompute() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine())
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Empty, ui.phase)
            assertTrue(ui.data?.isBlank == true)
        }

    @Test
    fun computeProducesContentWithTheDigest() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine())
            vm.compute("abc")
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(ABC_HEX, ui.data?.hex)
            assertFalse(ui.stale)
        }

    @Test
    fun blankInputResetsToEmptyWithoutTouchingTheEngine() =
        runTest(UnconfinedTestDispatcher()) {
            val engine = FakeEngine()
            val vm = viewModel(engine)
            vm.compute("")
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertEquals(0, engine.calls)
        }

    @Test
    fun computeFailureWithNoPriorDigestShowsErrorWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine(fail = true))
            vm.compute("abc")
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertEquals(ErrorKind.Unknown, ui.errorKind)
            assertTrue(ui.canRetry)
            assertFalse(ui.hasData)
        }

    @Test
    fun failingRecomputeKeepsLastKnownDigestStale() =
        runTest(UnconfinedTestDispatcher()) {
            val engine = FakeEngine()
            val vm = viewModel(engine)
            vm.compute("abc")
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)

            engine.fail = true
            vm.compute("abcd")
            advanceUntilIdle()
            val ui = vm.state.value
            // The prior digest stays visible (never blanked) and is flagged stale/offline with a retry.
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(ABC_HEX, ui.data?.hex)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun retryRecomputesAfterAFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val engine = FakeEngine(fail = true)
            val vm = viewModel(engine)
            vm.compute("abc")
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)

            engine.fail = false
            vm.retry("abc")
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(
                ABC_HEX,
                vm.state.value.data
                    ?.hex,
            )
        }

    @Test
    fun differentInputsProduceDifferentDigests() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine())
            vm.compute("abc")
            advanceUntilIdle()
            val first =
                vm.state.value.data
                    ?.hex
            vm.compute("abcd")
            advanceUntilIdle()
            assertNotEquals(
                first,
                vm.state.value.data
                    ?.hex,
            )
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeEngine(), logger)

            vm.onAppear()
            vm.onAppear()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "HashCalculator"), opened.single().second)
        }

    @Test
    fun computeIsLoggedWithSurfaceSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeEngine(), logger)

            vm.compute("abc")
            advanceUntilIdle()

            val compute = logger.events.filter { it.first == "hashCalculator.compute" }
            assertEquals(1, compute.size)
            // PII-safe: only the surface slug is recorded — never the input text or the digest.
            assertEquals(mapOf("surface" to "HashCalculator"), compute.single().second)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        engine: HashCalculatorEngine,
        logger: Logger = NoopLogger,
    ): HashCalculatorViewModel = HashCalculatorViewModel(engine, logger, backgroundScope, clock = { FIXED_NOW })

    private class FakeEngine(
        var fail: Boolean = false,
    ) : HashCalculatorEngine {
        var calls = 0
            private set

        override suspend fun digest(input: String): HashDigest {
            calls++
            if (fail) error("digest unavailable")
            return HashCalculatorProjection.digest(input)
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

    private companion object {
        const val ABC_HEX = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        const val FIXED_NOW = 100L
    }
}
