package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.net.TokenProvider
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Global, lifecycle-independent holder that adapts the shared-core auth state machine to the
 * Compose [AuthUiState] surface and exposes the sign-in / sign-out / refresh actions.
 *
 * It is intentionally NOT a `ViewModel`: auth state is app-global (one signed-in session), so it is
 * built once in [AuthContainer] and provided through `LocalAuthController`. The shared
 * [AuthSession] owns all token logic; this holder only observes [AuthSession.state], applies the
 * pure [authUiStateOf] mapper, and tracks the small amount of context that distinguishes a user
 * sign-out (→ [AuthUiState.SignedOut]) from a server-side invalidation (→ [AuthUiState.ReauthRequired]).
 *
 * @param onSignedOut hook run after a successful [signOut] — used to clear the offline cache so a
 *   signed-out session can never surface the previous user's data (ADR-013).
 * @param nowEpochSeconds clock seam (injectable for deterministic tests) for the expiry check.
 */
class AuthController(
    private val session: AuthSession,
    private val scope: CoroutineScope,
    private val onSignedOut: suspend () -> Unit = {},
    private val nowEpochSeconds: () -> Long = { System.currentTimeMillis() / MILLIS_PER_SECOND },
) {
    // Starts as Authorizing (a neutral loading surface) so a cold start with a stored session never
    // flashes the sign-in screen before restore() resolves.
    private val mutableUiState = MutableStateFlow<AuthUiState>(AuthUiState.Authorizing)

    /** The current auth surface to render. */
    val uiState: StateFlow<AuthUiState> = mutableUiState.asStateFlow()

    private var hadSession = false
    private var userInitiatedSignOut = false
    private var started = false
    private var restoreComplete = false

    /** Begins observing session state and rehydrates from secure storage. Idempotent. */
    fun start() {
        if (started) return
        started = true
        scope.launch { session.state.collect(::onCoreState) }
        scope.launch {
            session.restore()
            restoreComplete = true
            // Re-map once restore is done: a no-session restore leaves state at SignedOut, which the
            // collector mapped to the loading surface while restore was still in flight.
            onCoreState(session.state.value)
        }
    }

    /** Launches the interactive OIDC PKCE sign-in. */
    fun signIn() {
        userInitiatedSignOut = false
        scope.launch { session.signIn() }
    }

    /** Signs out (revoke + clear) and clears cached data via [onSignedOut]. */
    fun signOut() {
        userInitiatedSignOut = true
        scope.launch {
            session.signOut()
            onSignedOut()
        }
    }

    /** Nudges a token read so a near-expiry/expired session refreshes through the token provider. */
    fun refresh() {
        scope.launch { session.asTokenProvider().token() }
    }

    /** The networking auth seam; pages never handle tokens — the shared client owns the bearer + 401 refresh. */
    fun tokenProvider(): TokenProvider = session.asTokenProvider()

    private fun onCoreState(core: AuthState) {
        if (core is AuthState.SignedIn || core is AuthState.Refreshing) hadSession = true
        if (core is AuthState.Authenticating || core is AuthState.SignedIn) userInitiatedSignOut = false
        val previous = mutableUiState.value
        val next =
            if (!restoreComplete && core == AuthState.SignedOut) {
                // Still hydrating from secure storage: keep the neutral loading surface.
                AuthUiState.Authorizing
            } else {
                authUiStateOf(core, hadSession, userInitiatedSignOut, nowEpochSeconds())
            }
        mutableUiState.value = next
        // On first entering Expired, kick a silent refresh; staying Expired (refresh failing) waits
        // for the user's explicit retry so we never hammer the token endpoint in a tight loop.
        if (next is AuthUiState.Expired && previous !is AuthUiState.Expired) refresh()
    }

    private companion object {
        const val MILLIS_PER_SECOND = 1_000L
    }
}
