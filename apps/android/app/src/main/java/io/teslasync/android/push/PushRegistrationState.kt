package io.teslasync.android.push

/**
 * The observable state of FCM device registration (P3/A6, ADR-009). It is PII-safe — it never carries
 * a token, only the backend registration id and the non-reversible channel fingerprint — so it can
 * drive UI and diagnostics directly.
 */
sealed interface PushRegistrationState {
    /** No active registration: the device has not registered (or was unregistered). */
    data object Unregistered : PushRegistrationState

    /** A registration / renewal round-trip is in progress. */
    data object Registering : PushRegistrationState

    /**
     * Registered: the backend assigned [registrationId]; [channelFingerprint] is the non-reversible
     * tag of the token this registration was created for (so a token change is detectable on renew).
     */
    data class Registered(
        val registrationId: String,
        val channelFingerprint: String,
    ) : PushRegistrationState

    /**
     * Registration could not complete. [reason] is a short, PII-free code (e.g. `channel_unavailable`,
     * `register_rejected`) suitable for logs and UI.
     */
    data class Failed(
        val reason: String,
    ) : PushRegistrationState

    /** True while a usable backend registration exists. */
    val isRegistered: Boolean get() = this is Registered
}
