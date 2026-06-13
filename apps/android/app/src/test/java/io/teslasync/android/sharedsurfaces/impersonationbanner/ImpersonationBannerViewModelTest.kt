package io.teslasync.android.sharedsurfaces.impersonationbanner

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ImpersonationBannerViewModel] over a controllable fake [ImpersonationBannerSource], covering the
 * cached-then-network lifecycle the web bar + the bound impersonation feed render: a first load → loading, an
 * active session → content, a non-active session → the hidden (empty) phase, a cached active session after a
 * failed refresh → the offline (stale + cached) projection, the end mutation toggling [ImpersonationBannerViewModel.ending]
 * and invoking the source, retry re-fetching, and the PII-safe `view.opened` + refresh diagnostics — end to end
 * through the real `toUiState` adapter + the pure projection. The VM's `state` is a `WhileSubscribed` feed, so
 * each case keeps an active collector alive on the background scope. Runs in the :android:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ImpersonationBannerViewModelTest {
    private class FakeSource(
        initial: Resource<ImpersonationStatus>,
    ) : ImpersonationBannerSource {
        val flow = MutableStateFlow(initial)
        override val status: StateFlow<Resource<ImpersonationStatus>> = flow
        var refreshCount = 0
        var endCount = 0
        var endGate: CompletableDeferred<Unit>? = null

        override suspend fun endImpersonation(): Result<Unit> {
            endCount++
            endGate?.await()
            return Result.success(Unit)
        }

        override fun refresh() {
            refreshCount++
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
    fun loadingResolvesToTheActiveSessionWhenItArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
            assertEquals(ImpersonationBannerSurface.Loading, surface(vm))

            source.flow.value = Resource.Success(active(), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(ImpersonationMode.Active, state.data?.mode)
            assertEquals("alice", state.data?.target)
            assertEquals(ImpersonationBannerSurface.Active, surface(vm))
        }

    @Test
    fun aNonActiveSessionMapsToTheEmptyPhaseAndHiddenSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(ImpersonationStatus.Inactive, fetchedAt = STAMP, stale = false)))
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Empty, vm.state.value.phase)
            assertEquals(ImpersonationBannerSurface.Hidden, surface(vm))
        }

    @Test
    fun openModeMapsToHiddenSurface() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(ImpersonationStatus.Open, fetchedAt = STAMP, stale = false)))
            observe(vm)
            advanceUntilIdle()
            assertEquals(ImpersonationBannerSurface.Hidden, surface(vm))
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
            assertEquals(ImpersonationBannerSurface.Error, surface(vm))
        }

    @Test
    fun cachedActiveSessionAfterAFailedRefreshProjectsOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    Resource.Error(cached = active(), fetchedAt = STAMP, stale = true, error = RuntimeException("net")),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals("alice", state.data?.target)
            assertEquals(ImpersonationBannerSurface.Offline, surface(vm))
        }

    @Test
    fun endImpersonationTogglesTheEndingFlagAndInvokesTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(active(), fetchedAt = STAMP, stale = false))
            val gate = CompletableDeferred<Unit>()
            source.endGate = gate
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertFalse(vm.ending.value)

            vm.endImpersonation()
            assertTrue(vm.ending.value)
            assertEquals(1, source.endCount)

            gate.complete(Unit)
            advanceUntilIdle()
            assertFalse(vm.ending.value)
        }

    @Test
    fun endImpersonationGuardsAgainstADoubleFireWhileInFlight() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(active(), fetchedAt = STAMP, stale = false))
            source.endGate = CompletableDeferred()
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            vm.endImpersonation()
            vm.endImpersonation()
            assertEquals(1, source.endCount)
        }

    @Test
    fun refreshReFetchesTheSourceAndEmitsTheRefreshDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(Resource.Success(active(), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source, logger)
            observe(vm)
            advanceUntilIdle()

            vm.refresh()
            advanceUntilIdle()

            assertEquals(1, source.refreshCount)
            val refresh = logger.events.single { it.first == "impersonationBanner.refresh" }
            assertEquals(mapOf("surface" to "ImpersonationBanner"), refresh.second)
        }

    @Test
    fun retryDelegatesToRefresh() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(active(), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()
            assertEquals(1, source.refreshCount)
        }

    @Test
    fun viewOpenedEmitsTheSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(Resource.Success(active(), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ImpersonationBanner"), opened.single().second)
        }

    private fun surface(vm: ImpersonationBannerViewModel): ImpersonationBannerSurface =
        ImpersonationBannerProjection.project(vm.state.value, NOW, vm.ending.value).surface

    private fun active(): ImpersonationStatus.Active =
        ImpersonationStatus.Active(originalAdmin = "admin", target = "alice", expiresAt = "2026-01-01T00:05:25Z")

    private fun TestScope.viewModel(
        source: ImpersonationBannerSource,
        logger: Logger = NoopLogger,
    ): ImpersonationBannerViewModel = ImpersonationBannerViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: ImpersonationBannerViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val NOW = 1_767_225_600_000L
    }
}
