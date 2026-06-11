package io.teslasync.android.dashboard.widgets.onboardingchecklist

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
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
 * Drives [OnboardingChecklistWidgetViewModel] over controllable fakes, covering the cache-then-network
 * state matrix the web component renders (loading cold start / content / stale-offline + retry / refresh
 * re-fetch), the dismiss + restart writes (web `setChecklistDismissed` / `restartChecklist`), the
 * `completedAt` stamping effect (web `useChecklistTasks` 100%-stamp + un-complete clear), and the PII-safe
 * `view.opened` diagnostic — end to end through the real [io.teslasync.android.data.UiState] projection.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingChecklistWidgetViewModelTest {
    private val fixedNow = 1_700_000_000_000L

    private class FakeSource(
        var emissions: List<Resource<OnboardingChecklistInputs>>,
    ) : OnboardingChecklistSource {
        override fun stream(): Flow<Resource<OnboardingChecklistInputs>> = flow { emissions.forEach { emit(it) } }
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

    private fun inputs(
        allComplete: Boolean = false,
        dismissed: Boolean = false,
        completedAt: Long? = null,
    ) = if (allComplete) {
        OnboardingChecklistInputs(1, 1, 1, "tesla-red", true, true, true, dismissed, completedAt)
    } else {
        OnboardingChecklistInputs(0, 0, 0, "neon-cyan", false, false, false, dismissed, completedAt)
    }

    // ---- state matrix ----------------------------------------------------------------

    @Test
    fun loadingWhenColdStart() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
        }

    @Test
    fun contentWhenInputsResolved() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(inputs(), 100L, false))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(0, requireNotNull(vm.state.value.data).vehicleCount)
        }

    @Test
    fun staleOfflineKeepsInputsWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(inputs(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            src.emissions = listOf(Resource.Error(inputs(), 100L, true, ApiError.Timeout()))
            vm.refresh()
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
        }

    @Test
    fun refreshReFetchesUpdatedInputs() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(inputs(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(0, requireNotNull(vm.state.value.data).vehicleCount)

            src.emissions = listOf(Resource.Success(inputs(allComplete = true), 200L, false))
            vm.refresh()
            advanceUntilIdle()
            assertEquals(1, requireNotNull(vm.state.value.data).vehicleCount)
        }

    // ---- dismiss / restart -----------------------------------------------------------

    @Test
    fun dismissPersistsTheDismissedFlag() =
        runTest(UnconfinedTestDispatcher()) {
            val prefs = InMemoryOnboardingChecklistPreferences()
            val vm = viewModel(FakeSource(emptyList()), prefs)

            vm.dismiss()
            advanceUntilIdle()
            assertTrue(prefs.dismissed.value)
        }

    @Test
    fun restartClearsDismissAndCompletionStamp() =
        runTest(UnconfinedTestDispatcher()) {
            val prefs = InMemoryOnboardingChecklistPreferences(dismissed = true, completedAt = 99L)
            val vm = viewModel(FakeSource(emptyList()), prefs)

            vm.restart()
            advanceUntilIdle()
            assertFalse(prefs.dismissed.value)
            assertNull(prefs.completedAt.value)
        }

    // ---- completion stamping ---------------------------------------------------------

    @Test
    fun stampsCompletedAtTheFirstTimeEverythingIsComplete() =
        runTest(UnconfinedTestDispatcher()) {
            val prefs = InMemoryOnboardingChecklistPreferences()
            val vm = viewModel(FakeSource(listOf(Resource.Success(inputs(allComplete = true, completedAt = null), 10L, false))), prefs)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertEquals(fixedNow, prefs.completedAt.value)
        }

    @Test
    fun clearsCompletedAtWhenATaskIsUndone() =
        runTest(UnconfinedTestDispatcher()) {
            val prefs = InMemoryOnboardingChecklistPreferences(completedAt = 123L)
            val vm = viewModel(FakeSource(listOf(Resource.Success(inputs(allComplete = false, completedAt = 123L), 10L, false))), prefs)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertNull(prefs.completedAt.value)
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
            assertEquals(mapOf("surface" to "OnboardingChecklistWidget"), opened.single().second)
        }

    @Test
    fun refreshEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger = logger)

            vm.refresh()

            assertTrue(logger.events.any { it.first == "onboardingChecklist.refresh" })
        }

    private fun TestScope.viewModel(
        source: OnboardingChecklistSource,
        preferences: OnboardingChecklistPreferences = InMemoryOnboardingChecklistPreferences(),
        logger: Logger = NoopLogger,
    ): OnboardingChecklistWidgetViewModel =
        OnboardingChecklistWidgetViewModel(source, preferences, logger, now = { fixedNow }, scope = backgroundScope)
}
