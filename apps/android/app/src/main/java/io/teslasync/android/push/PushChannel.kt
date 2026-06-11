package io.teslasync.android.push

/**
 * A platform-agnostic projection of an FCM registration token (P3/A6, ADR-009). The app obtains one
 * from a [PushTokenProvider] wrapping Firebase Cloud Messaging; the headless registration logic and
 * the unit tests consume only this immutable shape so they never depend on the Firebase SDK.
 *
 * [token] is the secret push address Firebase assigns — it is treated as a credential: it is sent to
 * the backend over TLS but is never persisted locally in plaintext nor written to any log (see
 * [PushRedaction]). FCM tokens carry no fixed expiry, so [expiresAtMillis] is null for the FCM
 * transport; the field exists for cross-provider parity with WNS/APNs channels.
 */
data class PushChannel(
    val token: String,
    val expiresAtMillis: Long? = null,
)
