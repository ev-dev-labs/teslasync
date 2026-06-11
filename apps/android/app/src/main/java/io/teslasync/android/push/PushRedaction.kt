package io.teslasync.android.push

import java.security.MessageDigest

/**
 * Credential redaction helpers for the push layer (P3/A6, ADR-016 observability). An FCM token is a
 * secret: it is never written to a log or persisted locally in plaintext. [fingerprint] derives a
 * stable, non-reversible tag from a token so renewal can detect a token change and diagnostics can
 * correlate registrations without ever revealing the token itself.
 */
object PushRedaction {
    private const val FINGERPRINT_BYTES = 6
    private const val BYTE_MASK = 0xFF

    /**
     * A stable, non-reversible fingerprint of [token] (a truncated SHA-256 hex digest, prefixed with
     * `fcm:`). Used as the local change-detection key and in diagnostics; it can never be expanded
     * back into the token. An empty/absent token yields the sentinel `fcm:none`.
     */
    fun fingerprint(token: String?): String {
        if (token.isNullOrEmpty()) return "fcm:none"
        val digest = MessageDigest.getInstance("SHA-256").digest(token.encodeToByteArray())
        val hex = digest.take(FINGERPRINT_BYTES).joinToString("") { byte -> "%02x".format(byte.toInt() and BYTE_MASK) }
        return "fcm:$hex"
    }
}
