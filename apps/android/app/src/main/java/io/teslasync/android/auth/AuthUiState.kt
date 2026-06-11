// File holds the auth UI-state model plus its pure mapper (a supporting declaration).
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthState

/**
 * The auth states the Compose UI renders, derived from the shared-core [AuthState] machine plus a
 * little app-side context (whether the user explicitly signed out, and whether a session had been
 * established). The two states the core does not model directly — [Expired] and [ReauthRequired] —
 * are refinements of "no live session" that drive distinct, actionable surfaces (ADR-008 / A4 spec:
 * signed-out, authorizing, authenticated, refreshing, expired, error, reauth-required).
 */
sealed interface AuthUiState {
    /** No credentials, or the user explicitly signed out: show the sign-in surface. */
    data object SignedOut : AuthUiState

    /** A sign-in flow is in progress (authorize round-trip + code exchange): show a loading surface. */
    data object Authorizing : AuthUiState

    /** Signed in with a live access token: the gated app shell is shown. */
    data object Authenticated : AuthUiState

    /** A token refresh is in flight; the shell stays visible so content does not flash signed-out. */
    data object Refreshing : AuthUiState

    /** The stored access token is past expiry and a silent refresh has not yet restored it. */
    data object Expired : AuthUiState

    /** A previously live session was invalidated (refresh failed): the user must sign in again. */
    data object ReauthRequired : AuthUiState

    /** A sign-in attempt failed with [message]: show the error surface with a retry. */
    data class Error(
        val message: String,
    ) : AuthUiState
}

/**
 * Pure mapping from the shared-core [AuthState] (+ app context) to the [AuthUiState] surface.
 *
 * - A `SignedOut` core state is [AuthUiState.ReauthRequired] when a session had been established and
 *   the user did not ask to sign out (a server-side invalidation), otherwise [AuthUiState.SignedOut].
 * - A `SignedIn` core state whose access token is already past [nowEpochSeconds] surfaces as
 *   [AuthUiState.Expired] (a silent refresh is expected to follow), otherwise [AuthUiState.Authenticated].
 * - A user cancellation (an [AuthCanceledException] carried by `Error.cause`) is not a failure; it
 *   returns to [AuthUiState.SignedOut] with no error banner.
 */
internal fun authUiStateOf(
    core: AuthState,
    hadSession: Boolean,
    userInitiatedSignOut: Boolean,
    nowEpochSeconds: Long,
): AuthUiState =
    when (core) {
        AuthState.SignedOut ->
            if (!userInitiatedSignOut && hadSession) AuthUiState.ReauthRequired else AuthUiState.SignedOut
        AuthState.Authenticating -> AuthUiState.Authorizing
        is AuthState.SignedIn ->
            if (nowEpochSeconds >= core.tokens.expiresAtEpochSeconds) AuthUiState.Expired else AuthUiState.Authenticated
        is AuthState.Refreshing -> AuthUiState.Refreshing
        is AuthState.Error ->
            if (core.cause is AuthCanceledException) AuthUiState.SignedOut else AuthUiState.Error(core.message)
    }
