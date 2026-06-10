package io.teslasync.shared.core.auth

/**
 * Structured authentication failures surfaced by the auth core.
 *
 *  - [OAuth]            the provider returned a standard OAuth error (e.g.
 *                       `invalid_grant`, `access_denied`); [error] drives recovery
 *                       (an `invalid_grant` on refresh wipes stored tokens).
 *  - [InvalidResponse]  a 2xx token response was malformed or missing required
 *                       fields.
 *  - [StateMismatch]    the callback `state` did not match the value we generated
 *                       (possible CSRF / mixed-up flow).
 *  - [RedirectMismatch] the callback URI did not match the configured redirect.
 *  - [Transport]        a network/transport failure talking to the provider.
 */
public sealed class AuthException(
    message: String,
    cause: Throwable? = null,
) : Exception(message, cause) {
    public class OAuth(
        public val error: String,
        public val description: String? = null,
    ) : AuthException("OAuth error: $error" + (description?.let { " ($it)" } ?: "")) {
        /** True for the refresh-token-invalid signal that forces a full re-auth. */
        public val isInvalidGrant: Boolean get() = error.equals("invalid_grant", ignoreCase = true)
    }

    public class InvalidResponse(
        message: String,
    ) : AuthException(message)

    public class StateMismatch : AuthException("Authorization response state did not match the request")

    public class RedirectMismatch(
        message: String,
    ) : AuthException(message)

    public class Transport(
        message: String,
        cause: Throwable? = null,
    ) : AuthException(message, cause)
}

/**
 * The result of a platform browser round-trip: the full callback URI the
 * authorization server redirected to (carrying `code`+`state`, or an `error`).
 */
public class RedirectResult(
    public val callbackUri: String,
)

/**
 * Platform seam for the interactive authorize step. The shared core owns all crypto
 * and token logic and only delegates the system-browser round-trip to the platform
 * (ASWebAuthenticationSession on Apple, Custom Tabs on Android, WebAuthenticationBroker
 * on Windows) — those `actual` browsers live in the platform UI modules, not here.
 *
 * Implementations open [authorizeUrl], wait for the redirect back to the registered
 * callback, and return it as a [RedirectResult]. A user cancellation should surface
 * as a thrown exception.
 */
public fun interface AuthBrowser {
    public suspend fun authorize(authorizeUrl: String): RedirectResult
}
