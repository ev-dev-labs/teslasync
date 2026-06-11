package io.teslasync.android.push

/**
 * A decoded push payload (P3/A6). It carries the display fields and any extra string data the backend
 * included so the dispatcher can present an in-app banner or a system notification and deep-link the
 * tap — all without holding a background stream open (ADR-009).
 */
data class PushPayload(
    val kind: String,
    val title: String?,
    val body: String?,
    val category: String?,
    val data: Map<String, String>,
) {
    companion object {
        /** The kind used when a payload could not be decoded into a known shape. */
        const val UNKNOWN_KIND = "unknown"

        /** An empty, undecodable payload. */
        val Unknown = PushPayload(UNKNOWN_KIND, null, null, null, emptyMap())
    }
}
