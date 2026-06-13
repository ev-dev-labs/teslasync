package io.teslasync.android.sharedsurfaces.requiresauth

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.AuthModeCapabilities
import io.teslasync.shared.core.data.repo.AuthModeResponse
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [RequiresAuthViewModel] over a controllable fake [RequiresAuthSource], covering the cached-then-network
 * lifecycle the web wrapper + the bound auth-mode feed resolve: a first load → the locked notice, a forward-auth
 * contract with the capability → unlocked, an open-mode contract → locked with the provider hint, a hard error
 * with nothing cached → the locked notice, a cached contract after a failed refresh → still gated from the cache
 * (offline), refresh re-fetching + the PII-safe `refresh` / `view.opened` diagnostics — end to end through the
 * real `toUiState` adapter + the pure projection. The VM's `state` is a `WhileSubscribed` feed, so each case keeps
 * an active collector alive on the background scope. Runs in the :android:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RequiresAuthViewModelTest {
    private class FakeSource(
        initial: Resource<AuthModeResponse>,
    ) : RequiresAuthSource {
        val flow = MutableStateFlow(initial)
        override val authMode: StateFlow<Resource<AuthModeResponse>> = flow
        var refreshCount = 0

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
    fun loadingResolvesToUnlockedWhenAForwardAuthContractArrives() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.state.value.phase)
            assertNull(vm.state.value.data)
            assertEquals(RequiresAuthSurface.Locked(providerHint = null), surface(vm))

            source.flow.value = Resource.Success(forwardAuth(sessionList = true), fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertNotNull(vm.state.value.data)
            assertEquals(RequiresAuthSurface.Unlocked, surface(vm))
        }

    @Test
    fun openModeContractProjectsLockedWithTheProviderHint() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(openMode("Authentik"), fetchedAt = STAMP, stale = false)))
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.state.value.phase)
            assertEquals(RequiresAuthSurface.Locked(providerHint = "Authentik"), surface(vm))
        }

    @Test
    fun forwardAuthWithTheCapabilityDisabledProjectsLocked() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(Resource.Success(forwardAuth(sessionList = false, hint = "Authelia"), fetchedAt = STAMP, stale = false)),
                )
            observe(vm)
            advanceUntilIdle()
            assertEquals(RequiresAuthSurface.Locked(providerHint = "Authelia"), surface(vm))
        }

    @Test
    fun hardErrorWithNoCacheIsErrorPhaseAndLockedWithoutHint() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(UiPhase.Error, vm.state.value.phase)
            assertNotNull(vm.state.value.errorKind)
            assertEquals(RequiresAuthSurface.Locked(providerHint = null), surface(vm))
        }

    @Test
    fun cachedContractAfterAFailedRefreshStaysGatedFromTheCacheOffline() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(
                    Resource.Error(cached = openMode("oauth2-proxy"), fetchedAt = STAMP, stale = true, error = RuntimeException("net")),
                )
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()

            val state = vm.state.value
            assertEquals(UiPhase.Content, state.phase)
            assertTrue(state.stale)
            assertNotNull(state.errorKind)
            assertEquals(RequiresAuthSurface.Locked(providerHint = "oauth2-proxy"), surface(vm))
        }

    @Test
    fun refreshReFetchesTheSourceAndEmitsTheRefreshDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(Resource.Success(openMode("Authentik"), fetchedAt = STAMP, stale = false))
            val vm = viewModel(source, logger)
            observe(vm)
            advanceUntilIdle()

            vm.refresh()
            advanceUntilIdle()

            assertEquals(1, source.refreshCount)
            val refresh = logger.events.single { it.first == "requiresAuth.refresh" }
            assertEquals(mapOf("surface" to "RequiresAuth"), refresh.second)
        }

    @Test
    fun retryDelegatesToRefresh() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Success(openMode("Authentik"), fetchedAt = STAMP, stale = false))
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
            val vm = viewModel(FakeSource(Resource.Success(openMode("Authentik"), fetchedAt = STAMP, stale = false)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "RequiresAuth"), opened.single().second)
        }

    private fun surface(
        vm: RequiresAuthViewModel,
        capability: RequiresAuthCapability = RequiresAuthCapability.SessionList,
    ): RequiresAuthSurface = RequiresAuthProjection.project(vm.state.value, capability)

    private fun forwardAuth(
        sessionList: Boolean = true,
        hint: String? = null,
    ): AuthModeResponse =
        AuthModeResponse(
            mode = "forward_auth",
            providerHint = hint,
            capabilities = AuthModeCapabilities(sessionList = sessionList),
        )

    private fun openMode(hint: String?): AuthModeResponse =
        AuthModeResponse(mode = "open", providerHint = hint, capabilities = AuthModeCapabilities())

    private fun TestScope.viewModel(
        source: RequiresAuthSource,
        logger: Logger = NoopLogger,
    ): RequiresAuthViewModel = RequiresAuthViewModel(source, logger, backgroundScope)

    private fun TestScope.observe(vm: RequiresAuthViewModel) {
        backgroundScope.launch { vm.state.collect {} }
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
