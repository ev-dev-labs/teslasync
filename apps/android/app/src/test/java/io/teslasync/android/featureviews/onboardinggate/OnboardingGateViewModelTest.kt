package io.teslasync.android.featureviews.onboardinggate

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.onboarding.OnboardingStatus
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
 * Drives [OnboardingGateViewModel] over a fake [OnboardingGateSource] — covering every state the gate read
 * projects (loading / content / hard error / offline-cached), the one-shot `view.opened` diagnostic, and the
 * refresh + retry re-fetch that also restarts the shared store's poll. Mirrors the web `useOnboardingStatus`
 * lifecycle (web/src/features/onboarding/components/OnboardingGate.tsx). Run by the offline
 * `:android:testReleaseUnitTest` gate; the Compose render + accessibility live in OnboardingGateUiTest.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingGateViewModelTest {
    @Test
    fun loadsContentFromAResolvedStatus() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(loading(), success(incomplete)))
            val vm = OnboardingGateViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()

            val ui = vm.status.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(incomplete, ui.data)
            assertFalse(ui.data!!.isComplete)
        }

    @Test
    fun loadingWithNoCacheIsLoadingPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(loading()))
            val vm = OnboardingGateViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()

            assertEquals(UiPhase.Loading, vm.status.value.phase)
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(listOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())))
            val vm = OnboardingGateViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()

            val ui = vm.status.value
            assertEquals(UiPhase.Error, ui.phase)
            assertTrue(ui.hasError)
            assertFalse(ui.hasData)
        }

    @Test
    fun offlineKeepsCachedStatusWithStaleAndRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    listOf(Resource.Error(cached = incomplete, fetchedAt = 100L, stale = true, error = ApiError.Network())),
                )
            val vm = OnboardingGateViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()

            val ui = vm.status.value
            assertEquals(UiPhase.Content, ui.phase)
            assertEquals(incomplete, ui.data)
            assertTrue(ui.stale)
            assertTrue(ui.isOffline)
            assertTrue(ui.canRetry)
        }

    @Test
    fun viewOpenedEmitsDiagnosticsOnceWithSurfaceSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = OnboardingGateViewModel(FakeSource(emptyList()), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("OnboardingGate", opened.single().fields["surface"])
        }

    @Test
    fun refreshReCollectsTheFeedCallsSourceRefreshAndLogs() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(listOf(success(incomplete)))
            val vm = OnboardingGateViewModel(source, logger, backgroundScope)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            val statusBefore = source.statusCalls

            vm.refresh()
            advanceUntilIdle()

            assertEquals(1, source.refreshCalls)
            assertTrue(source.statusCalls > statusBefore)
            assertTrue(logger.records.any { it.event == "onboardingGate.refresh" })
        }

    @Test
    fun retryAlsoReCollectsAndRefreshes() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(listOf(success(incomplete)))
            val vm = OnboardingGateViewModel(source, RecordingLogger(), backgroundScope)
            backgroundScope.launch { vm.status.collect {} }
            advanceUntilIdle()
            val statusBefore = source.statusCalls

            vm.retry()
            advanceUntilIdle()

            assertEquals(1, source.refreshCalls)
            assertTrue(source.statusCalls > statusBefore)
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────
    private class FakeSource(
        private val emissions: List<Resource<OnboardingStatus>>,
    ) : OnboardingGateSource {
        var statusCalls = 0
            private set
        var refreshCalls = 0
            private set

        override fun status(): Flow<Resource<OnboardingStatus>> {
            statusCalls++
            return emissions.asFlow()
        }

        override fun refresh() {
            refreshCalls++
        }
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private companion object {
        val incomplete =
            OnboardingStatus(teslaConnected = true, vehicleCount = 1, dataFlowing = false, isComplete = false)

        fun success(status: OnboardingStatus): Resource<OnboardingStatus> = Resource.Success(status, fetchedAt = 100L, stale = false)

        fun loading(): Resource<OnboardingStatus> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
