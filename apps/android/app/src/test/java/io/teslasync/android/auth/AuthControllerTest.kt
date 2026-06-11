package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.auth.TokenSet
import io.teslasync.shared.core.net.NoopTokenProvider
import io.teslasync.shared.core.net.TokenProvider
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM unit tests for [AuthController]. A fake [AuthSession] (emitting hand-built [AuthState]s, no
 * real crypto/storage/network) drives the controller so its state mapping and sign-in / sign-out /
 * cache-clear orchestration are verified deterministically on the test scheduler.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AuthControllerTest {
    private fun signedIn(expiresAt: Long): AuthState.SignedIn = AuthState.SignedIn(TokenSet("a", "r", null, expiresAt))

    @Test
    fun coldStartWithNoStoredSessionResolvesToSignedOut() =
        runTest {
            val session = FakeAuthSession()
            val controller = AuthController(session, backgroundScope, nowEpochSeconds = { NOW })

            controller.start()
            runCurrent()

            assertEquals(1, session.restoreCount)
            assertEquals(AuthUiState.SignedOut, controller.uiState.value)
        }

    @Test
    fun restoredSessionResolvesToAuthenticated() =
        runTest {
            val session = FakeAuthSession()
            session.onRestore = { session.emit(signedIn(NOW + 100)) }
            val controller = AuthController(session, backgroundScope, nowEpochSeconds = { NOW })

            controller.start()
            runCurrent()

            assertEquals(AuthUiState.Authenticated, controller.uiState.value)
        }

    @Test
    fun signInDelegatesToTheSession() =
        runTest {
            val session = FakeAuthSession()
            val controller = AuthController(session, backgroundScope, nowEpochSeconds = { NOW })
            controller.start()
            runCurrent()

            controller.signIn()
            runCurrent()

            assertEquals(1, session.signInCount)
        }

    @Test
    fun signOutReturnsToSignedOutAndClearsCachedData() =
        runTest {
            val session = FakeAuthSession()
            var cacheCleared = false
            val controller =
                AuthController(session, backgroundScope, onSignedOut = { cacheCleared = true }, nowEpochSeconds = { NOW })
            controller.start()
            runCurrent()
            session.emit(signedIn(NOW + 100))
            runCurrent()
            assertEquals(AuthUiState.Authenticated, controller.uiState.value)

            controller.signOut()
            runCurrent()

            assertEquals(1, session.signOutCount)
            assertTrue("cache must be cleared on sign-out", cacheCleared)
            assertEquals(AuthUiState.SignedOut, controller.uiState.value)
        }

    @Test
    fun serverInvalidatedSessionSurfacesReauthRequired() =
        runTest {
            val session = FakeAuthSession()
            val controller = AuthController(session, backgroundScope, nowEpochSeconds = { NOW })
            controller.start()
            runCurrent()
            session.emit(signedIn(NOW + 100))
            runCurrent()

            // No user sign-out: a drop to SignedOut means the session was invalidated server-side.
            session.emit(AuthState.SignedOut)
            runCurrent()

            assertEquals(AuthUiState.ReauthRequired, controller.uiState.value)
        }

    @Test
    fun expiredAccessTokenSurfacesExpired() =
        runTest {
            val session = FakeAuthSession()
            val controller = AuthController(session, backgroundScope, nowEpochSeconds = { NOW })
            controller.start()
            runCurrent()

            session.emit(signedIn(NOW - 1))
            runCurrent()

            assertEquals(AuthUiState.Expired, controller.uiState.value)
        }

    @Test
    fun tokenProviderIsTheSessionsProvider() =
        runTest {
            val session = FakeAuthSession()
            val controller = AuthController(session, backgroundScope, nowEpochSeconds = { NOW })
            assertSame(NoopTokenProvider, controller.tokenProvider())
        }

    private class FakeAuthSession : AuthSession {
        private val mutableState = MutableStateFlow<AuthState>(AuthState.SignedOut)
        override val state: StateFlow<AuthState> = mutableState

        var restoreCount = 0
        var signInCount = 0
        var signOutCount = 0
        var onRestore: () -> Unit = {}

        fun emit(next: AuthState) {
            mutableState.value = next
        }

        override suspend fun restore() {
            restoreCount += 1
            onRestore()
        }

        override suspend fun signIn(): Result<TokenSet> {
            signInCount += 1
            mutableState.value = AuthState.Authenticating
            return Result.failure(AuthCanceledException())
        }

        override suspend fun signOut() {
            signOutCount += 1
            mutableState.value = AuthState.SignedOut
        }

        override fun asTokenProvider(): TokenProvider = NoopTokenProvider
    }

    private companion object {
        const val NOW = 1_000L
    }
}
