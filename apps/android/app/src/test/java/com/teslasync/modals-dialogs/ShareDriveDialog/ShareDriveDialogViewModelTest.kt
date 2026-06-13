// Off-device unit coverage for [ShareDriveDialogViewModel] over a controllable fake [ShareDriveDialogSource]: the
// share-link-feed projection + the create / revoke orchestration the web mutations own (web/src/features/driving/
// components/ShareDriveDialog.tsx). Covers the feed → UiState mapping (content / empty / error / loading), the create
// happy path (the new token stored → result panel, no lingering busy flag, the assembled request), the create in-flight
// guard (a second create while one runs is ignored — web disabled button), the create failure (no token, busy cleared),
// the revoke (the in-flight token tracked then cleared, the store call), the revoke in-flight guard, the "create
// another"/reset clear, the refresh delegation, and the once-only PII-safe `view.opened` diagnostic. No Compose /
// Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sharedrivedialog

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.sharing.CreateShareRequest
import io.teslasync.shared.core.presentation.sharing.CreateShareResponse
import io.teslasync.shared.core.presentation.sharing.ShareToken
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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ShareDriveDialogViewModelTest {
    private class FakeSource(
        initial: Resource<List<ShareToken>> = Resource.Success(emptyList(), FETCHED_AT, stale = false),
        private val createResult: Result<CreateShareResponse> = Result.success(sampleResponse()),
        private val revokeResult: Result<Unit> = Result.success(Unit),
    ) : ShareDriveDialogSource {
        val feed = MutableStateFlow(initial)
        var createCalls = 0
        var revokeCalls = 0
        var refreshCalls = 0
        var lastCreateRequest: CreateShareRequest? = null
        var lastRevokeToken: String? = null
        var holdCreate = false
        var holdRevoke = false
        val createGate = CompletableDeferred<Unit>()
        val revokeGate = CompletableDeferred<Unit>()

        override fun shareLinks(): StateFlow<Resource<List<ShareToken>>> = feed

        override suspend fun createShareLink(request: CreateShareRequest): Result<CreateShareResponse> {
            createCalls++
            lastCreateRequest = request
            if (holdCreate) createGate.await()
            return createResult
        }

        override suspend fun revokeShareLink(token: String): Result<Unit> {
            revokeCalls++
            lastRevokeToken = token
            if (holdRevoke) revokeGate.await()
            return revokeResult
        }

        override fun refresh() {
            refreshCalls++
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

    // ── feed → UiState mapping ──────────────────────────────────────────────────────────────────

    @Test
    fun shares_nonEmptyListMapsToContent() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(listOf(sampleToken()), FETCHED_AT, stale = false)))
            subscribeShares(vm)
            advanceUntilIdle()

            val state = vm.shares.value
            assertTrue(state.isContent)
            assertEquals(1, state.data?.size)
        }

    @Test
    fun shares_emptyListMapsToEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Success(emptyList(), FETCHED_AT, stale = false)))
            subscribeShares(vm)
            advanceUntilIdle()

            assertTrue(vm.shares.value.isEmpty)
        }

    @Test
    fun shares_errorWithNoCacheMapsToError() =
        runTest(UnconfinedTestDispatcher()) {
            val error = Resource.Error<List<ShareToken>>(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom"))
            val vm = viewModel(FakeSource(error))
            subscribeShares(vm)
            advanceUntilIdle()

            assertTrue(vm.shares.value.isError)
        }

    @Test
    fun shares_loadingWithNoCacheMapsToLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val loading = Resource.Loading<List<ShareToken>>(cached = null, fetchedAt = null, stale = false)
            val vm = viewModel(FakeSource(loading))
            subscribeShares(vm)
            advanceUntilIdle()

            assertTrue(vm.shares.value.isLoading)
        }

    // ── create ──────────────────────────────────────────────────────────────────────────────────

    @Test
    fun create_successStoresTokenAndClearsBusy() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)

            vm.create(CreateShareRequest(title = "SF to LA"))
            advanceUntilIdle()

            assertEquals(1, source.createCalls)
            assertEquals("SF to LA", source.lastCreateRequest?.title)
            assertEquals("tok-123", vm.createdToken.value)
            assertFalse(vm.creating.value)
        }

    @Test
    fun create_whileInFlightIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource().apply { holdCreate = true }
            val vm = viewModel(source)

            vm.create(CreateShareRequest())
            assertTrue(vm.creating.value)
            vm.create(CreateShareRequest())
            assertEquals(1, source.createCalls)

            source.createGate.complete(Unit)
            advanceUntilIdle()
            assertFalse(vm.creating.value)
            assertEquals(1, source.createCalls)
            assertEquals("tok-123", vm.createdToken.value)
        }

    @Test
    fun create_failureClearsBusyAndStoresNoToken() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(createResult = Result.failure(IllegalStateException("server exploded")))
            val vm = viewModel(source)

            vm.create(CreateShareRequest())
            advanceUntilIdle()

            assertNull(vm.createdToken.value)
            assertFalse(vm.creating.value)
        }

    // ── revoke ──────────────────────────────────────────────────────────────────────────────────

    @Test
    fun revoke_callsSourceAndClearsTheInFlightToken() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)

            vm.revoke("abc")
            advanceUntilIdle()

            assertEquals(1, source.revokeCalls)
            assertEquals("abc", source.lastRevokeToken)
            assertTrue(vm.revoking.value.isEmpty())
        }

    @Test
    fun revoke_tracksTheTokenWhileInFlightAndIgnoresADuplicate() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource().apply { holdRevoke = true }
            val vm = viewModel(source)

            vm.revoke("abc")
            assertTrue(vm.revoking.value.contains("abc"))
            vm.revoke("abc")
            assertEquals(1, source.revokeCalls)

            source.revokeGate.complete(Unit)
            advanceUntilIdle()
            assertTrue(vm.revoking.value.isEmpty())
        }

    @Test
    fun revoke_blankTokenIsIgnored() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)

            vm.revoke("   ")
            advanceUntilIdle()

            assertEquals(0, source.revokeCalls)
        }

    // ── reset / refresh ─────────────────────────────────────────────────────────────────────────

    @Test
    fun createAnotherAndReset_clearTheCreatedToken() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)

            vm.create(CreateShareRequest())
            advanceUntilIdle()
            assertEquals("tok-123", vm.createdToken.value)

            vm.createAnother()
            assertNull(vm.createdToken.value)

            vm.create(CreateShareRequest())
            advanceUntilIdle()
            vm.reset()
            assertNull(vm.createdToken.value)
        }

    @Test
    fun refresh_delegatesToTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource()
            val vm = viewModel(source)

            vm.refresh()

            assertEquals(1, source.refreshCalls)
        }

    @Test
    fun recordViewOpened_emitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(), logger)

            vm.recordViewOpened()
            vm.recordViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ShareDriveDialog"), opened.single().second)
        }

    private fun TestScope.viewModel(
        source: ShareDriveDialogSource,
        logger: Logger = NoopLogger,
    ): ShareDriveDialogViewModel = ShareDriveDialogViewModel(source, logger, backgroundScope)

    private fun TestScope.subscribeShares(vm: ShareDriveDialogViewModel) {
        backgroundScope.launch { vm.shares.collect { } }
    }

    private companion object {
        const val FETCHED_AT = 1_700_000_000_000L

        fun sampleToken(): ShareToken =
            ShareToken(
                id = 1L,
                token = "abc",
                driveId = 7L,
                includeMap = true,
                includeTelemetry = false,
                includeSpeed = true,
                views = 4,
                createdAt = "2025-01-01T00:00:00Z",
            )

        fun sampleResponse(): CreateShareResponse =
            CreateShareResponse(token = "tok-123", url = "https://teslasync.example/s/tok-123", id = 9L)
    }
}
