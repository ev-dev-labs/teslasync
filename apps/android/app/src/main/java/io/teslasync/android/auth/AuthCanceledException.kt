package io.teslasync.android.auth

/**
 * Raised when the user dismisses the system browser / Custom Tab before the authorization
 * server redirects back (e.g. taps Back or closes the tab). It is intentionally a plain
 * [Exception] — NOT a `CancellationException` — so the shared-core `AuthService.signIn()`
 * treats it as a terminal sign-in outcome rather than coroutine cancellation, and the app's
 * [AuthUiState] mapper can recognise it and fall back to the signed-out surface (no error
 * banner) instead of showing a failure.
 */
class AuthCanceledException : Exception("Authorization was canceled by the user")
