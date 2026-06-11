package io.teslasync.android.push

/**
 * The seam over the platform push-token APIs (P3/A6, ADR-009). The app implementation
 * ([FcmPushTokenProvider]) wraps `FirebaseMessaging`; the headless core and the unit tests use a fake
 * so the registration logic is verified without the Firebase SDK or a configured FirebaseApp.
 */
interface PushTokenProvider {
    /**
     * Requests (or refreshes) the current push token. Throws [PushChannelUnavailableException] when no
     * token can be obtained (e.g. the default FirebaseApp is not configured). The returned
     * [PushChannel.token] is credential-grade material.
     */
    suspend fun currentToken(): PushChannel

    /**
     * Removes the current token so the transport stops routing to it (used during unregister /
     * sign-out cleanup). Best-effort: it never throws — a missing or already-removed token is a no-op.
     */
    suspend fun deleteToken()
}
