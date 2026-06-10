package io.teslasync.shared.core.net.sse

/**
 * One dispatched Server-Sent-Events frame: the accumulated `event`, `data`, `id` and
 * `retry` fields between two blank-line boundaries (W3C EventSource framing).
 *
 * [data] is the multi-line `data:` payload joined with `\n` (the spec's dispatch
 * rule). [id] is the most recent `id:` field of THIS frame, or `null` when the frame
 * carried none. [retry] is the server-suggested reconnection delay in milliseconds,
 * when a valid `retry:` field was present.
 */
internal data class SseFrame(
    val event: String?,
    val data: String,
    val id: String?,
    val retry: Long?,
)

/**
 * Incremental, allocation-light parser for the SSE wire format. Feed it arbitrary
 * text chunks (lines may be split across chunk boundaries) via [feed]; it returns the
 * frames completed by that chunk. State persists across [feed] calls so a frame split
 * over several reads is assembled correctly.
 *
 * Mirrors the framing the web `EventSource` does natively, which the KMP transport
 * must reproduce by hand because no native EventSource exists off-browser.
 */
internal class SseFrameParser {
    private val buffer = StringBuilder()
    private var event: String? = null
    private val dataLines = mutableListOf<String>()
    private var id: String? = null
    private var retry: Long? = null
    private var hasField = false

    /** Feeds a raw text [chunk] and returns any frames completed by it. */
    fun feed(chunk: String): List<SseFrame> {
        buffer.append(chunk)
        val frames = mutableListOf<SseFrame>()
        while (true) {
            val newline = buffer.indexOf("\n")
            if (newline < 0) break
            var line = buffer.substring(0, newline)
            buffer.deleteRange(0, newline + 1)
            if (line.endsWith("\r")) {
                line = line.substring(0, line.length - 1)
            }
            if (line.isEmpty()) {
                buildFrame()?.let { frames.add(it) }
                resetFrame()
            } else {
                parseLine(line)
            }
        }
        return frames
    }

    private fun parseLine(line: String) {
        // A leading colon marks a comment/heartbeat-keepalive line: ignore per spec.
        if (line[0] == ':') return
        val colon = line.indexOf(':')
        val field: String
        var value: String
        if (colon < 0) {
            field = line
            value = ""
        } else {
            field = line.substring(0, colon)
            value = line.substring(colon + 1)
            if (value.startsWith(" ")) {
                value = value.substring(1)
            }
        }
        hasField = true
        when (field) {
            "event" -> event = value
            "data" -> dataLines.add(value)
            "id" -> id = value
            "retry" -> value.toLongOrNull()?.let { retry = it }
        }
    }

    private fun buildFrame(): SseFrame? {
        if (!hasField) return null
        return SseFrame(
            event = event,
            data = dataLines.joinToString("\n"),
            id = id,
            retry = retry,
        )
    }

    private fun resetFrame() {
        event = null
        dataLines.clear()
        id = null
        retry = null
        hasField = false
    }
}
