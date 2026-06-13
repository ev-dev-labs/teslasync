package io.teslasync.android.sharedsurfaces.reloadprompt

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ReloadPromptViewModel] over a controllable fake [ReloadPromptSource], covering the full lifecycle
 * the web component renders (web/src/components/feedback/ReloadPrompt.tsx): a fresh "update available" signal
 * arming the three-second auto-reload, the countdown expiring into an automatic reload request, "Later"
 * cancelling the countdown without reloading, "Reload Now" requesting a manual reload, the "up to date" and
 * error/offline branches, retry re-collecting, and the PII-safe `view.opened` + action diagnostics — end to
 * end through the real `toUiState` projection and virtual time.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ReloadPromptViewModelTest {
    private class FakeSource(
        initial: Resource<ReloadAvailability>,
    ) : ReloadPromptSource {
        val flow = MutableStateFlow(initial)
        var calls: Int = 0

        override fun availability(): Flow<Resource<ReloadAvailability>> {
            calls++
            return flow
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

    @Test
    fun freshUpdateArmsTheCountdownAtThreeSeconds() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(available()))
            runCurrent()

            val state = vm.state.value
            assertEquals(ReloadPromptPhase.Available, state.phase)
            assertEquals(ReloadCountdown.SECONDS, state.countdownSeconds)
            assertTrue(state.autoReloadArmed)
            assertTrue(state.showLater)
        }

    @Test
    fun countdownExpiresIntoAnAutomaticReload() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(available()))
            val reloads = collectReloads(vm)
            runCurrent()
            assertEquals(ReloadCountdown.SECONDS, vm.state.value.countdownSeconds)

            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(2, vm.state.value.countdownSeconds)

            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(1, vm.state.value.countdownSeconds)

            advanceTimeBy(1_000)
            runCurrent()
            assertEquals(listOf(ReloadRequest(automatic = true)), reloads)
            assertFalse(vm.state.value.autoReloadArmed)
        }

    @Test
    fun laterCancelsTheCountdownAndReloadsNothing() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(available()))
            val reloads = collectReloads(vm)
            runCurrent()

            vm.dismiss()
            advanceUntilIdle()

            assertTrue(reloads.isEmpty())
            val state = vm.state.value
            assertEquals(ReloadPromptPhase.Available, state.phase)
            assertFalse(state.autoReloadArmed)
            assertFalse(state.showLater)
        }

    @Test
    fun reloadNowRequestsAManualReload() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(available()))
            val reloads = collectReloads(vm)
            runCurrent()

            vm.reloadNow()
            advanceUntilIdle()

            assertEquals(listOf(ReloadRequest(automatic = false)), reloads)
            assertFalse(vm.state.value.autoReloadArmed)
        }

    @Test
    fun noUpdateRendersUpToDateAndNeverReloads() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(ReloadAvailability(updateAvailable = false), STAMP, stale = false)))
            val reloads = collectReloads(vm)
            advanceUntilIdle()

            assertEquals(ReloadPromptPhase.UpToDate, vm.state.value.phase)
            assertTrue(reloads.isEmpty())
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom"))),
                )
            runCurrent()
            assertEquals(ReloadPromptPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
        }

    @Test
    fun cachedAfterErrorFlagsOfflineWithoutAutoReload() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = ReloadAvailability(updateAvailable = false, version = "0.1.0")
            val vm =
                viewModel(
                    FakeSource(Resource.Error(cached = cached, fetchedAt = STAMP, stale = true, error = RuntimeException("net"))),
                )
            val reloads = collectReloads(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertTrue(state.offline)
            assertFalse(state.autoReloadArmed)
            assertTrue(reloads.isEmpty())
        }

    @Test
    fun retryReCollectsTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(available())
            val vm = viewModel(source)
            runCurrent()
            assertEquals(1, source.calls)

            vm.retry()
            advanceUntilIdle()
            assertEquals(2, source.calls)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(available()), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ReloadPrompt"), opened.single().second)
        }

    @Test
    fun dismissAndReloadEmitPiiSafeDiagnostics() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(available()), logger)
            runCurrent()

            vm.dismiss()
            val dismiss = logger.events.single { it.first == "reloadPrompt.dismiss" }
            assertEquals(mapOf("surface" to "ReloadPrompt"), dismiss.second)

            vm.reloadNow()
            val reload = logger.events.single { it.first == "reloadPrompt.reload" }
            assertEquals(mapOf("surface" to "ReloadPrompt", "auto" to "false"), reload.second)
        }

    private fun available(): Resource<ReloadAvailability> =
        Resource.Success(ReloadAvailability(updateAvailable = true, version = "0.2.0"), STAMP, stale = false)

    private fun TestScope.viewModel(
        source: ReloadPromptSource,
        logger: Logger = NoopLogger,
    ): ReloadPromptViewModel = ReloadPromptViewModel(source, logger, backgroundScope)

    private fun TestScope.collectReloads(vm: ReloadPromptViewModel): List<ReloadRequest> {
        val reloads = mutableListOf<ReloadRequest>()
        backgroundScope.launch { vm.reloadRequests.collect { reloads += it } }
        return reloads
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
