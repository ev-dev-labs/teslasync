package io.teslasync.android.featureviews.advancedsettings

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
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [AdvancedSettingsViewModel] over a controllable fake [ConfirmSilenceStore], covering every state
 * the surface renders (loading → content with sorted prompts, loading → empty, restore removing one,
 * restore-all clearing, a hard read error + retry, a failing re-read keeping the last list stale, retry
 * recovery) and the PII-safe `view.opened` / restore diagnostics (P1/S11 — surface slug only, never the
 * action ids).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AdvancedSettingsViewModelTest {
    @Test
    fun loadsSortedContentForSilencedPrompts() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeStore(initial = setOf("unsaved-navigation", "discard-draft")))
            vm.onAppear()
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(listOf("discard-draft", "unsaved-navigation"), ui.data?.keys)
            assertFalse(ui.stale)
        }

    @Test
    fun loadsEmptyWhenNothingSilenced() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeStore())
            vm.onAppear()
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Empty, ui.phase)
            assertTrue(ui.data?.isBlank == true)
        }

    @Test
    fun restoreRemovesASinglePrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeStore(initial = setOf("discard-draft", "unsaved-navigation")))
            vm.onAppear()
            advanceUntilIdle()

            vm.restore("discard-draft")
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(listOf("unsaved-navigation"), ui.data?.keys)
        }

    @Test
    fun restoreAllClearsEveryPrompt() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeStore(initial = setOf("discard-draft", "unsaved-navigation")))
            vm.onAppear()
            advanceUntilIdle()

            vm.restoreAll()
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Empty, ui.phase)
            assertTrue(ui.data?.isBlank == true)
        }

    @Test
    fun readFailureWithNoPriorShowsErrorWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeStore(fail = true))
            vm.onAppear()
            advanceUntilIdle()
            val ui = vm.state.value
            assertEquals(UiPhase.Error, ui.phase)
            assertEquals(ErrorKind.Unknown, ui.errorKind)
            assertTrue(ui.canRetry)
            assertFalse(ui.hasData)
        }

    @Test
    fun failingReloadKeepsLastKnownListStale() =
        runTest(UnconfinedTestDispatcher()) {
            val store = FakeStore(initial = setOf("discard-draft", "unsaved-navigation"))
            val vm = viewModel(store)
            vm.onAppear()
            advanceUntilIdle()
            val initial = vm.state.value
            assertEquals(UiPhase.Content, initial.phase)
            val priorKeys = requireNotNull(initial.data).keys

            store.fail = true
            vm.refresh()
            advanceUntilIdle()
            val ui = vm.state.value
            // The prior list stays visible (never blanked) and is flagged stale/offline with a retry.
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(priorKeys, ui.data?.keys)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun retryReloadsAfterAFailure() =
        runTest(UnconfinedTestDispatcher()) {
            val store = FakeStore(fail = true, initial = setOf("discard-draft"))
            val vm = viewModel(store)
            vm.onAppear()
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)

            store.fail = false
            vm.retry()
            advanceUntilIdle()
            val recovered = vm.state.value
            assertEquals(UiPhase.Content, recovered.phase)
            assertEquals(listOf("discard-draft"), recovered.data?.keys)
        }

    @Test
    fun onAppearEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeStore(), logger)

            vm.onAppear()
            advanceUntilIdle()
            vm.onAppear()
            advanceUntilIdle()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "AdvancedSettings"), opened.single().second)
        }

    @Test
    fun restoreAndRestoreAllAreLoggedWithSurfaceSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeStore(initial = setOf("discard-draft", "unsaved-navigation")), logger)
            vm.onAppear()
            advanceUntilIdle()

            vm.restore("discard-draft")
            advanceUntilIdle()
            vm.restoreAll()
            advanceUntilIdle()

            val restore = logger.events.filter { it.first == "advancedSettings.restore" }
            val restoreAll = logger.events.filter { it.first == "advancedSettings.restoreAll" }
            assertEquals(1, restore.size)
            assertEquals(1, restoreAll.size)
            // PII-safe: only the surface slug is recorded — never the silenced action id.
            assertEquals(mapOf("surface" to "AdvancedSettings"), restore.single().second)
            assertEquals(mapOf("surface" to "AdvancedSettings"), restoreAll.single().second)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.viewModel(
        store: ConfirmSilenceStore,
        logger: Logger = NoopLogger,
    ): AdvancedSettingsViewModel = AdvancedSettingsViewModel(store, logger, backgroundScope, clock = { FIXED_NOW })

    private class FakeStore(
        var fail: Boolean = false,
        initial: Set<String> = emptySet(),
    ) : ConfirmSilenceStore {
        private val current = initial.toMutableSet()

        override suspend fun list(): Set<String> {
            if (fail) error("prefs unavailable")
            return current.toSet()
        }

        override suspend fun unsilence(key: String): Set<String> {
            if (fail) error("prefs unavailable")
            current.remove(key)
            return current.toSet()
        }

        override suspend fun clearAll(): Set<String> {
            if (fail) error("prefs unavailable")
            current.clear()
            return current.toSet()
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
