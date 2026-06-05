package io.teslasync.shared.core.presentation.totp

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TOTPRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Verifies the S8 [TOTPStore] folds the S7 [TOTPRepository] into a shared, refreshable status feed
 * and routes each of the five mutations to the right repository call + the web-faithful behaviour:
 * enroll / verify / revoke / regenerate refresh the feed on success (`totpKeys.status`), step-up does
 * NOT refresh but hands the minted token to the [SudoTokenSink] (`setCachedSudoToken`), and a failed
 * mutation refreshes nothing. Uses a fake repository, so no network or cache is involved.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TOTPStoreTest {
    /**
     * Fake S7 port: each status collection re-counts (so a refresh is observable) and emits
     * Loading→Success with a configurable response; each mutation records that it was called and
     * succeeds (configurably).
     */
    private class FakeTOTPRepository(
        private val response: TOTPStatus = TOTPStatus.Session(activated = true, backupCodesRemaining = 5),
    ) : TOTPRepository {
        var collections: Int = 0
            private set
        var enrollCalls: Int = 0
            private set
        var verifiedCodes: MutableList<String> = mutableListOf()
        var stepUpArgs: MutableList<Pair<String?, String?>> = mutableListOf()
        var revokeCalls: Int = 0
            private set
        var regenerateCalls: Int = 0
            private set
        var mutationSucceeds = true
        var sudoExpiresAt: String = "2026-01-01T00:00:00Z"

        override fun status(): Flow<Resource<TOTPStatus>> =
            flow {
                collections += 1
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(Resource.Success(data = response, fetchedAt = 1L, stale = false))
            }

        override suspend fun enroll(): Result<TOTPEnrollment> {
            enrollCalls += 1
            return if (mutationSucceeds) {
                Result.success(
                    TOTPEnrollment(
                        secret = "SECRET",
                        otpauthUri = "otpauth://totp/x",
                        qrDataUri = "data:image/png;base64,AAAA",
                        backupCodes = listOf("c1", "c2"),
                        expiresAt = "2026-01-01T00:15:00Z",
                    ),
                )
            } else {
                Result.failure(IllegalStateException("500"))
            }
        }

        override suspend fun verify(code: String): Result<TOTPVerifyResult> {
            verifiedCodes += code
            return if (mutationSucceeds) {
                Result.success(
                    TOTPVerifyResult(activated = true),
                )
            } else {
                Result.failure(IllegalStateException("400"))
            }
        }

        override suspend fun stepUp(
            code: String?,
            backupCode: String?,
        ): Result<TOTPSudoToken> {
            stepUpArgs += (code to backupCode)
            return if (mutationSucceeds) {
                Result.success(TOTPSudoToken(mode = "session", sudoToken = "SUDO-XYZ", expiresAt = sudoExpiresAt))
            } else {
                Result.failure(IllegalStateException("403"))
            }
        }

        override suspend fun revoke(): Result<Unit> {
            revokeCalls += 1
            return if (mutationSucceeds) Result.success(Unit) else Result.failure(IllegalStateException("500"))
        }

        override suspend fun regenerateBackupCodes(): Result<TOTPBackupCodesResponse> {
            regenerateCalls += 1
            return if (mutationSucceeds) {
                Result.success(TOTPBackupCodesResponse(backupCodes = listOf("n1", "n2", "n3")))
            } else {
                Result.failure(IllegalStateException("500"))
            }
        }
    }

    /** Recording [SudoTokenSink] capturing the cached (token, expiresAtMillis) pairs. */
    private class RecordingSink : SudoTokenSink {
        val cached: MutableList<Pair<String, Long>> = mutableListOf()

        override fun cache(
            token: String,
            expiresAtMillis: Long,
        ) {
            cached += (token to expiresAtMillis)
        }
    }

    // ---- Read ---------------------------------------------------------------------

    @Test
    fun startsAtLoadingBeforeAnySubscriber() =
        runTest {
            val store = TOTPStore(FakeTOTPRepository(), backgroundScope)
            assertTrue(store.status.value is Resource.Loading)
        }

    @Test
    fun readEmitsCacheThenNetwork() =
        runTest {
            val store = TOTPStore(FakeTOTPRepository(), backgroundScope)
            val seen = mutableListOf<Resource<TOTPStatus>>()
            backgroundScope.launch { store.status.collect { seen += it } }
            runCurrent()

            assertTrue(seen.first() is Resource.Loading, "first emission is Loading (cache slot)")
            val last = seen.last()
            assertTrue(last is Resource.Success, "terminal emission is the network Success")
            val data = last.data
            assertTrue(data is TOTPStatus.Session)
            assertEquals(5, data.backupCodesRemaining)
            assertTrue(data.activated)
        }

    @Test
    fun openModeResponseFlowsThroughUnchanged() =
        runTest {
            val store = TOTPStore(FakeTOTPRepository(TOTPStatus.Open), backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()

            val value = store.status.value
            assertTrue(value is Resource.Success)
            assertEquals(TOTPStatus.Open, value.data)
        }

    // ---- Mutations ----------------------------------------------------------------

    @Test
    fun enrollDelegatesAndRefreshesTheFeed() =
        runTest {
            val repo = FakeTOTPRepository()
            val store = TOTPStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            val result = store.enroll()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals("SECRET", result.getOrThrow().secret)
            assertEquals(1, repo.enrollCalls)
            assertEquals(2, repo.collections, "successful enroll refreshes the status feed")
        }

    @Test
    fun verifyPassesCodeAndRefreshesTheFeed() =
        runTest {
            val repo = FakeTOTPRepository()
            val store = TOTPStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()

            val result = store.verify("123456")
            runCurrent()

            assertTrue(result.isSuccess)
            assertTrue(result.getOrThrow().activated)
            assertEquals(listOf("123456"), repo.verifiedCodes)
            assertEquals(2, repo.collections, "successful verify refreshes the status feed")
        }

    @Test
    fun stepUpPassesArgsCachesTokenAndDoesNotRefresh() =
        runTest {
            val repo = FakeTOTPRepository()
            repo.sudoExpiresAt = "2026-01-01T00:00:00Z"
            val sink = RecordingSink()
            val store = TOTPStore(repo, backgroundScope, sink)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            val result = store.stepUp(code = "654321")
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf<Pair<String?, String?>>("654321" to null), repo.stepUpArgs)
            assertEquals(1, sink.cached.size, "successful step-up parks the minted token")
            assertEquals("SUDO-XYZ", sink.cached.single().first)
            assertEquals(1767225600000L, sink.cached.single().second, "expiry parsed from ISO to epoch millis")
            assertEquals(1, repo.collections, "step-up does NOT refresh the status feed")
        }

    @Test
    fun stepUpWithBackupCodeForwardsBackupArg() =
        runTest {
            val repo = FakeTOTPRepository()
            val store = TOTPStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()

            store.stepUp(backupCode = "ABCD-EFGH")
            runCurrent()

            assertEquals(listOf<Pair<String?, String?>>(null to "ABCD-EFGH"), repo.stepUpArgs)
        }

    @Test
    fun failedStepUpCachesNothing() =
        runTest {
            val repo = FakeTOTPRepository()
            repo.mutationSucceeds = false
            val sink = RecordingSink()
            val store = TOTPStore(repo, backgroundScope, sink)

            val result = store.stepUp(code = "000000")
            runCurrent()

            assertTrue(result.isFailure)
            assertTrue(sink.cached.isEmpty(), "a failed step-up parks no token")
        }

    @Test
    fun revokeDelegatesAndRefreshesTheFeed() =
        runTest {
            val repo = FakeTOTPRepository()
            val store = TOTPStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()

            val result = store.revoke()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.revokeCalls)
            assertEquals(2, repo.collections, "successful revoke refreshes the status feed")
        }

    @Test
    fun regenerateBackupCodesDelegatesReturnsCodesAndRefreshes() =
        runTest {
            val repo = FakeTOTPRepository()
            val store = TOTPStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()

            val result = store.regenerateBackupCodes()
            runCurrent()

            assertTrue(result.isSuccess)
            assertEquals(listOf("n1", "n2", "n3"), result.getOrThrow().backupCodes)
            assertEquals(1, repo.regenerateCalls)
            assertEquals(2, repo.collections, "successful regenerate refreshes the status feed")
        }

    @Test
    fun failedMutationDoesNotRefresh() =
        runTest {
            val repo = FakeTOTPRepository()
            repo.mutationSucceeds = false
            val store = TOTPStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            val result = store.verify("000000")
            runCurrent()

            assertTrue(result.isFailure)
            assertEquals(1, repo.collections, "onError ⇒ no invalidation")
        }

    @Test
    fun refreshReFetchesTheObservedFeed() =
        runTest {
            val repo = FakeTOTPRepository()
            val store = TOTPStore(repo, backgroundScope)
            backgroundScope.launch { store.status.collect {} }
            runCurrent()
            assertEquals(1, repo.collections)

            store.refresh()
            runCurrent()
            assertEquals(2, repo.collections, "refresh re-collects the status feed")
        }

    @Test
    fun refreshIsNoOpWithoutASubscriber() =
        runTest {
            val repo = FakeTOTPRepository()
            val store = TOTPStore(repo, backgroundScope)

            store.refresh()
            runCurrent()
            assertEquals(0, repo.collections, "an unobserved feed never fetches")
        }

    @Test
    fun defaultSinkIsInertNoop() =
        runTest {
            // No sink supplied ⇒ SudoTokenSink.Noop; a successful step-up must not throw.
            val repo = FakeTOTPRepository()
            val store = TOTPStore(repo, backgroundScope)

            val result = store.stepUp(code = "111111")
            runCurrent()
            assertTrue(result.isSuccess)
            assertNull(repo.stepUpArgs.single().second)
        }
}
