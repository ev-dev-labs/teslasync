package io.teslasync.android.support

import io.teslasync.android.auth.AuthSession
import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.auth.TokenSet
import io.teslasync.shared.core.net.NoopTokenProvider
import io.teslasync.shared.core.net.TokenProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Instrumented-test [AuthSession] that emits hand-built [AuthState]s with no crypto, storage, or
 * network — the device-side counterpart of the JVM `AuthControllerTest` fake. It lets the on-device
 * [io.teslasync.android.auth.AuthScaffold] be driven through every A4 auth surface by mutating
 * [emit] (or seeding [onRestore]); the androidTest source set cannot see the `test` source set's
 * fake, so the small amount of duplication is intentional.
 */
class FakeAuthSession(
    initial: AuthState = AuthState.SignedOut,
) : AuthSession {
    private val mutableState = MutableStateFlow(initial)
    override val state: StateFlow<AuthState> = mutableState.asStateFlow()

    /** Invoked by [restore]; seed it to rehydrate a stored session (e.g. emit a SignedIn state). */
    var onRestore: () -> Unit = {}

    var restoreCount: Int = 0
        private set
    var signInCount: Int = 0
        private set
    var signOutCount: Int = 0
        private set

    /** Pushes a new core [AuthState] so the collecting controller re-maps its surface. */
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
        return Result.success(TokenSet("access", "refresh", expiresAtEpochSeconds = Long.MAX_VALUE))
    }

    override suspend fun signOut() {
        signOutCount += 1
        mutableState.value = AuthState.SignedOut
    }

    override fun asTokenProvider(): TokenProvider = NoopTokenProvider
}

/** A live (future-expiry) signed-in state for a given clock, for the Authenticated surface. */
fun signedInState(nowEpochSeconds: Long): AuthState.SignedIn =
    AuthState.SignedIn(TokenSet("access", "refresh", expiresAtEpochSeconds = nowEpochSeconds + ONE_HOUR_SECONDS))

/** An already-expired signed-in state for a given clock, for the Expired surface. */
fun expiredSignedInState(nowEpochSeconds: Long): AuthState.SignedIn =
    AuthState.SignedIn(TokenSet("access", "refresh", expiresAtEpochSeconds = nowEpochSeconds - 1))

private const val ONE_HOUR_SECONDS = 3_600L
