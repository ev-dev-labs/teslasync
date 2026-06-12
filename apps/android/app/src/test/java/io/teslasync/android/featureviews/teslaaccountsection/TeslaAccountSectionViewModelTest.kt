package io.teslasync.android.featureviews.teslaaccountsection

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.presentation.settings.AuthStatus
import io.teslasync.shared.core.presentation.settings.AuthUrlResult
import io.teslasync.shared.core.presentation.settings.SyncVehiclesResult
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [TeslaAccountSectionViewModel] over a controllable fake [TeslaAccountSource], covering the full
 * cache-then-network state matrix the auth-status feed can be in (loading / content / hard error + retry /
 * stale-offline + retry), the re-auth signal pass-through (web `pillDisconnected`), every mutation's typed
 * [TeslaAccountToast] + delegation (the OAuth-URL open, token refresh, disconnect, and sync — including the
 * web-faithful no-success-toast sync that surfaces the synced count instead), and the PII-safe
 * `view.opened` + refresh diagnostics. Mirrors the web component's hook behaviour
 * (web/src/features/settings/components/TeslaAccountSection.tsx).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaAccountSectionViewModelTest {
    private fun authed(expiresAt: String? = "2027-01-01T00:00:00Z"): AuthStatus = AuthStatus(authenticated = true, expiresAt = expiresAt)

    // ── auth-status state matrix ────────────────────────────────────────────────────

    @Test
    fun loadingWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Loading(null, null, false))))
            backgroundScope.launch { vm.authStatus.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Loading, vm.authStatus.value.phase)
        }

    @Test
    fun contentWhenStatusPresent() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Success(authed(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.authStatus.collect {} }
            advanceUntilIdle()

            val state = vm.authStatus.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(authed(), state.data)
            assertEquals(100L, state.fetchedAt)
        }

    @Test
    fun notConnectedStatusStillResolvesToContentNeverEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            // Web parity: the panel always renders (Not-connected IS the friendly content), never an Empty branch.
            val vm = viewModel(FakeSource(listOf(Resource.Success(AuthStatus(authenticated = false), 100L, false))))
            backgroundScope.launch { vm.authStatus.collect {} }
            advanceUntilIdle()
            assertEquals(UiPhase.Content, vm.authStatus.value.phase)
        }

    @Test
    fun hardErrorWithRetryWhenNoCache() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Loading(null, null, false), Resource.Error(null, null, false, ApiError.Network())))
            val vm = viewModel(src)
            backgroundScope.launch { vm.authStatus.collect {} }
            advanceUntilIdle()

            val state = vm.authStatus.value
            assertEquals(UiPhase.Error, state.phase)
            assertEquals(ErrorKind.Network, state.errorKind)
            assertTrue(state.canRetry)
            assertFalse(state.hasData)
        }

    @Test
    fun staleOfflineKeepsCacheWithRetry() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(authed(), 100L, false)))
            val vm = viewModel(src)
            backgroundScope.launch { vm.authStatus.collect {} }
            advanceUntilIdle()
            assertEquals(authed(), vm.authStatus.value.data)

            src.statusEmissions = listOf(Resource.Error(authed(), 100L, true, ApiError.Timeout()))
            vm.retry()
            advanceUntilIdle()

            val state = vm.authStatus.value
            assertEquals(UiPhase.Content, state.phase)
            assertEquals(authed(), state.data)
            assertTrue(state.stale)
            assertTrue(state.isOffline)
            assertTrue(state.canRetry)
            assertEquals(ErrorKind.Timeout, state.errorKind)
        }

    @Test
    fun reauthSignalIsExposed() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(listOf(Resource.Success(authed(), 100L, false)), reauth = flowOf(true)))
            backgroundScope.launch { vm.reauthNeeded.collect {} }
            advanceUntilIdle()
            assertTrue(vm.reauthNeeded.value)
        }

    // ── mutations ───────────────────────────────────────────────────────────────────

    @Test
    fun connectEmitsOauthUrlOnSuccess() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(AuthStatus(authenticated = false), 100L, false)))
            src.authUrlResult = Result.success(AuthUrlResult(authUrl = "https://auth.tesla.com/oauth2/authorize?x=1"))
            val vm = viewModel(src)
            val urls = mutableListOf<String>()
            backgroundScope.launch { vm.openUrls.collect { urls += it } }

            vm.connect()
            advanceUntilIdle()

            assertEquals(1, src.authUrlCount)
            assertEquals(listOf("https://auth.tesla.com/oauth2/authorize?x=1"), urls)
            assertFalse(vm.actions.value.connecting)
        }

    @Test
    fun connectFailureEmitsNoUrlAndLogsWarning() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(AuthStatus(authenticated = false), 100L, false)))
            src.authUrlResult = Result.failure(ApiError.Network())
            val logger = RecordingLogger()
            val vm = viewModel(src, logger)
            val urls = mutableListOf<String>()
            backgroundScope.launch { vm.openUrls.collect { urls += it } }

            vm.connect()
            advanceUntilIdle()

            assertTrue(urls.isEmpty())
            assertTrue(logger.events.any { it.first == "teslaAccount.connectFailed" })
        }

    @Test
    fun refreshTokenSuccessRaisesToastAndDelegates() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(authed(), 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.refreshToken()
            advanceUntilIdle()

            assertEquals(1, src.refreshCount)
            assertEquals(listOf<TeslaAccountToast>(TeslaAccountToast.TokenRefreshed), received)
        }

    @Test
    fun refreshTokenFailureRaisesFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(authed(), 100L, false)))
            src.refreshResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.refreshToken()
            advanceUntilIdle()

            assertEquals(listOf<TeslaAccountToast>(TeslaAccountToast.TokenRefreshFailed), received)
        }

    @Test
    fun syncSuccessSetsSyncedCountWithNoToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(authed(), 100L, false)))
            src.syncResult = Result.success(SyncVehiclesResult(synced = 4))
            val vm = viewModel(src)
            val received = collectToasts(vm)
            backgroundScope.launch { vm.syncedCount.collect {} }

            vm.syncVehicles()
            advanceUntilIdle()

            assertEquals(1, src.syncCount)
            assertEquals(4, vm.syncedCount.value)
            assertTrue(received.isEmpty())
            assertFalse(vm.actions.value.syncing)
        }

    @Test
    fun syncFailureRaisesSyncFailedToastAndLeavesCountNull() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(authed(), 100L, false)))
            src.syncResult = Result.failure(ApiError.Timeout())
            val vm = viewModel(src)
            val received = collectToasts(vm)
            backgroundScope.launch { vm.syncedCount.collect {} }

            vm.syncVehicles()
            advanceUntilIdle()

            assertEquals(listOf<TeslaAccountToast>(TeslaAccountToast.SyncFailed), received)
            assertEquals(null, vm.syncedCount.value)
        }

    @Test
    fun disconnectSuccessRaisesDisconnectedToastAndDelegates() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(authed(), 100L, false)))
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.disconnect()
            advanceUntilIdle()

            assertEquals(1, src.disconnectCount)
            assertEquals(listOf<TeslaAccountToast>(TeslaAccountToast.Disconnected), received)
            assertFalse(vm.actions.value.disconnecting)
        }

    @Test
    fun disconnectFailureRaisesDisconnectFailedToast() =
        runTest(UnconfinedTestDispatcher()) {
            val src = FakeSource(listOf(Resource.Success(authed(), 100L, false)))
            src.disconnectResult = Result.failure(ApiError.Network())
            val vm = viewModel(src)
            val received = collectToasts(vm)

            vm.disconnect()
            advanceUntilIdle()

            assertEquals(listOf<TeslaAccountToast>(TeslaAccountToast.DisconnectFailed), received)
        }

    // ── diagnostics ─────────────────────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "TeslaAccountSection"), opened.single().second)
        }

    @Test
    fun retryEmitsDiagnosticEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(emptyList()), logger)

            vm.retry()

            assertTrue(logger.events.any { it.first == "teslaAccount.refresh" })
        }

    // ── fakes / helpers ───────────────────────────────────────────────────────────

    private fun TestScope.collectToasts(vm: TeslaAccountSectionViewModel): List<TeslaAccountToast> {
        val received = mutableListOf<TeslaAccountToast>()
        backgroundScope.launch { vm.toasts.collect { received += it } }
        return received
    }

    private fun TestScope.viewModel(
        source: TeslaAccountSource,
        logger: Logger = NoopLogger,
    ): TeslaAccountSectionViewModel = TeslaAccountSectionViewModel(source, logger, backgroundScope)

    private class FakeSource(
        var statusEmissions: List<Resource<AuthStatus>>,
        private val reauth: Flow<Boolean> = flowOf(false),
    ) : TeslaAccountSource {
        var authUrlResult: Result<AuthUrlResult> = Result.success(AuthUrlResult(authUrl = "https://example/auth"))
        var refreshResult: Result<Unit> = Result.success(Unit)
        var disconnectResult: Result<Unit> = Result.success(Unit)
        var syncResult: Result<SyncVehiclesResult> = Result.success(SyncVehiclesResult(synced = 1))
        var authUrlCount = 0
            private set
        var refreshCount = 0
            private set
        var disconnectCount = 0
            private set
        var syncCount = 0
            private set

        override fun authStatus(): Flow<Resource<AuthStatus>> = flow { statusEmissions.forEach { emit(it) } }

        override fun reauthNeeded(): Flow<Boolean> = reauth

        override suspend fun authUrl(): Result<AuthUrlResult> {
            authUrlCount++
            return authUrlResult
        }

        override suspend fun refreshAuth(): Result<Unit> {
            refreshCount++
            return refreshResult
        }

        override suspend fun disconnectAuth(): Result<Unit> {
            disconnectCount++
            return disconnectResult
        }

        override suspend fun syncVehicles(): Result<SyncVehiclesResult> {
            syncCount++
            return syncResult
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
}
