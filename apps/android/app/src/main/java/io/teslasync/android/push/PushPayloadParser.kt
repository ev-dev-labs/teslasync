package io.teslasync.android.push

/**
 * Decodes an FCM message into a typed [PushPayload] (P3/A6). FCM already delivers the data part as a
 * `Map<String, String>`, so no JSON parsing is needed; the optional notification title/body (present
 * on notification-style messages) are folded in as fallbacks. The parser is tolerant: an empty
 * message yields [PushPayload.Unknown] so a malformed push can never crash the foreground pump. It
 * mirrors the backend `notification-worker` envelope (`kind`/`type`, `title`, `body`/`message`,
 * `category` plus arbitrary string `data`).
 */
object PushPayloadParser {
    /** Parses the FCM [data] map plus any notification title/body; returns [PushPayload.Unknown] when empty. */
    fun parse(
        data: Map<String, String>,
        notificationTitle: String? = null,
        notificationBody: String? = null,
    ): PushPayload {
        if (data.isEmpty() && notificationTitle == null && notificationBody == null) {
            return PushPayload.Unknown
        }
        val kind = data["kind"] ?: data["type"] ?: PushPayload.UNKNOWN_KIND
        val title = data["title"] ?: notificationTitle
        val body = data["body"] ?: data["message"] ?: notificationBody
        return PushPayload(kind, title, body, data["category"], data)
    }
}
