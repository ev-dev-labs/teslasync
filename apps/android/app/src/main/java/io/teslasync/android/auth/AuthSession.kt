// File holds the AuthSession seam plus its production implementation (a supporting declaration).
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthService
import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.auth.TokenSet
import io.teslasync.shared.core.net.TokenProvider
import kotlinx.coroutines.flow.StateFlow

/**
 * App-facing seam over the shared-core `AuthService`. The core service is a concrete class whose
 * successful token grants are built through an internal constructor, so it cannot be faked across
 * the module boundary. Depending on this small interface instead lets [AuthController] be exercised
 * in plain JVM unit tests with a fake that emits hand-built [AuthState]s (the public [TokenSet] is
 * constructible) without ever touching real crypto, storage, or the network.
 */
interface AuthSession {
    /** The observable session state machine (see shared-core `AuthState`). */
    val state: StateFlow<AuthState>

    /** Rehydrates session state from secure storage on startup. */
    suspend fun restore()

    /** Runs the full interactive OIDC PKCE sign-in. */
    suspend fun signIn(): Result<TokenSet>

    /** Revokes (best-effort) and clears all local credentials. */
    suspend fun signOut()

    /** The networking auth seam: attaches the bearer and performs single-flight 401 refresh. */
    fun asTokenProvider(): TokenProvider
}

/** Production [AuthSession] delegating to the shared-core [AuthService] (ADR-008). */
class RealAuthSession(
    private val service: AuthService,
) : AuthSession {
    override val state: StateFlow<AuthState> get() = service.state

    override suspend fun restore() = service.restore()

    override suspend fun signIn(): Result<TokenSet> = service.signIn()

    override suspend fun signOut() = service.signOut()

    override fun asTokenProvider(): TokenProvider = service.asTokenProvider()
}
