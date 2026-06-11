package io.teslasync.android.featureviews.uuidgenerator

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
 * Drives [UuidGeneratorViewModel] over a controllable fake [UuidEngine], covering every state the surface
 * renders (empty → content on generate, newest-first accumulation capped at ten, hard error + retry, a
 * failing re-generate keeping the last list stale, retry recovery, uniqueness) and the PII-safe `view.opened`
 * + generate diagnostics (P1/S11 — surface slug only, never the generated ids).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UuidGeneratorViewModelTest {
    @Test
    fun startsEmptyBeforeAnyGenerate() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine())
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Empty, ui.phase)
            assertTrue(ui.data?.isBlank == true)
        }

    @Test
    fun generateProducesContentWithOneCanonicalUuid() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine())
            vm.generate()
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(1, ui.data?.size)
            assertTrue(UuidGeneratorProjection.isCanonicalV4(ui.data!!.ids.first()))
            assertFalse(ui.stale)
        }

    @Test
    fun repeatedGenerateAccumulatesNewestFirstCappedAtTen() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine())
            repeat(12) {
                vm.generate()
                advanceUntilIdle()
            }
            val ui = vm.state.value
            val ids = requireNotNull(ui.data).ids
            assertEquals(UuidGeneratorProjection.MAX_RETAINED, ids.size)
            // Every retained id is distinct (each generate drew a fresh value).
            assertEquals(ids.size, ids.distinct().size)
        }

    @Test
    fun generateFailureWithNoPriorShowsErrorWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine(fail = true))
            vm.generate()
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertEquals(ErrorKind.Unknown, ui.errorKind)
            assertTrue(ui.canRetry)
            assertFalse(ui.hasData)
        }

    @Test
    fun failingRegenerateKeepsLastKnownListStale() =
        runTest(UnconfinedTestDispatcher()) {
            val engine = FakeEngine()
            val vm = viewModel(engine)
            vm.generate()
            advanceUntilIdle()
            val initial = vm.state.value
            assertEquals(UiPhase.Content, initial.phase)
            val priorIds = requireNotNull(initial.data).ids

            engine.fail = true
            vm.generate()
            advanceUntilIdle()
            val ui = vm.state.value
            // The prior list stays visible (never blanked) and is flagged stale/offline with a retry.
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(priorIds, ui.data?.ids)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun retryRegeneratesAfterAFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val engine = FakeEngine(fail = true)
            val vm = viewModel(engine)
            vm.generate()
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)

            engine.fail = false
            vm.retry()
            advanceUntilIdle()
            val recovered = vm.state.value
            assertEquals(UiPhase.Content, recovered.phase)
            assertEquals(1, recovered.data?.size)
        }

    @Test
    fun consecutiveGeneratesProduceDifferentIds() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeEngine())
            vm.generate()
            advanceUntilIdle()
            val firstState = vm.state.value
            val first = requireNotNull(firstState.data).ids.first()
            vm.generate()
            advanceUntilIdle()
            val secondState = vm.state.value
            val second = requireNotNull(secondState.data).ids.first()
            assertNotEquals(first, second)
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
            assertEquals(mapOf("surface" to "UuidGenerator"), opened.single().second)
        }

    @Test
    fun generateIsLoggedWithSurfaceSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeEngine(), logger)

            vm.generate()
            advanceUntilIdle()

            val generate = logger.events.filter { it.first == "uuidGenerator.generate" }
            assertEquals(1, generate.size)
            // PII-safe: only the surface slug is recorded — never the generated id.
            assertEquals(mapOf("surface" to "UuidGenerator"), generate.single().second)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        engine: UuidEngine,
        logger: Logger = NoopLogger,
    ): UuidGeneratorViewModel = UuidGeneratorViewModel(engine, logger, backgroundScope, clock = { FIXED_NOW })

    private class FakeEngine(
        var fail: Boolean = false,
    ) : UuidEngine {
        var calls = 0
            private set

        override suspend fun next(): String {
            calls++
            if (fail) error("uuid generator unavailable")
            // Deterministic but distinct per call so accumulation/uniqueness assertions are exact.
            val bytes = ByteArray(UuidGeneratorProjection.UUID_BYTE_COUNT)
            bytes[0] = calls.toByte()
            bytes[1] = (calls ushr Byte.SIZE_BITS).toByte()
            return UuidGeneratorProjection.formatV4(bytes)
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
        const val FIXED_NOW = 100L
    }
}
