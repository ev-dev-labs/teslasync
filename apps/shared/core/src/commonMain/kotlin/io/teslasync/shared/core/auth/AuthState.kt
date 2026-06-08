package io.teslasync.shared.core.auth

/**
 * Observable authentication session state, exposed by [AuthService] as a
 * `StateFlow`. A transparent refresh moves [SignedIn] → [Refreshing] → [SignedIn];
 * both carry the current [TokenSet] so a UI can keep signed-in content visible while
 * a refresh is in flight rather than flashing a signed-out view.
 */
public sealed interface AuthState {
    /** No credentials: the user must run the sign-in flow. */
    public data object SignedOut : AuthState

    /** A sign-in flow is in progress (authorize round-trip + code exchange). */
    public data object Authenticating : AuthState

    /** Signed in with a valid (or soon-to-be-refreshed) [tokens]. */
    public data class SignedIn(
        public val tokens: TokenSet,
    ) : AuthState

    /** A token refresh is in flight; [tokens] is the credential being replaced. */
    public data class Refreshing(
        public val tokens: TokenSet,
    ) : AuthState

    /** A sign-in attempt failed; [cause] is the originating error when available. */
    public data class Error(
        public val message: String,
        public val cause: Throwable? = null,
    ) : AuthState
}
