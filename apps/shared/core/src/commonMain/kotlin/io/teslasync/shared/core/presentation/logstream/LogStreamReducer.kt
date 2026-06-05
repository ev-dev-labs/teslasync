package io.teslasync.shared.core.presentation.logstream

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Pure, side-effect-free reduction logic for the LogStream live feed, extracted so the
 * KMP state holder ([LogStreamStore]), its golden tests, and the future Windows C#
 * port all reduce identically (ADR-004). Every function mirrors a piece of the web
 * `useLogStream` hook (`web/src/api/hooks/useLogStream.ts`).
 */
public object LogStreamReducer {
    private val json: Json =
        Json {
            ignoreUnknownKeys = true
            isLenient = true
        }

    /**
     * Builds the SSE path the holder subscribes to, mirroring the web
     * `buildLogStreamUrl`: `level` is always present; `grep` is appended only when it
     * is non-blank (after trimming). Both values are form-url-encoded exactly like the
     * web `URLSearchParams` (space → `+`), so the resulting query string is
     * byte-identical across platforms.
     *
     * @param base path root, defaulting to [LOG_STREAM_PATH]; the transport adds the
     *   `/api/v1` prefix.
     */
    public fun buildLogStreamPath(
        level: LogStreamLevel,
        grep: String,
        base: String = LOG_STREAM_PATH,
    ): String {
        val params = StringBuilder()
        params.append("level=").append(formUrlEncode(level.wire))
        val trimmed = grep.trim()
        if (trimmed.isNotEmpty()) {
            params.append("&grep=").append(formUrlEncode(trimmed))
        }
        return "$base?$params"
    }

    /**
     * Determines the level a payload reports, mirroring the web `detectLevel`: the
     * `level` string field when present, otherwise `"info"` (what zerolog itself
     * defaults to).
     */
    public fun detectLevel(parsed: JsonObject?): String {
        val primitive = parsed?.get("level") as? JsonPrimitive ?: return "info"
        return if (primitive.isString) primitive.content else "info"
    }

    /**
     * Builds a [LogStreamEvent] from a raw `data:` payload, mirroring the web
     * `buildLogEvent`. A payload that is not a JSON object decodes to [parsed] `null`
     * (the consumer renders the raw text), and the level falls back to `"info"`.
     */
    public fun buildLogEvent(
        payload: String,
        seq: Int,
        receivedAt: Long,
    ): LogStreamEvent {
        val parsed = parseObject(payload)
        return LogStreamEvent(
            seq = seq,
            receivedAt = receivedAt,
            payload = payload,
            parsed = parsed,
            level = detectLevel(parsed),
        )
    }

    /**
     * Reads the dropped-event count from a `drop` frame's `data:` payload, mirroring
     * the web hook's `parsed.count` read.
     *
     * NOTE — deliberate web-parity (not silent drift): the live backend
     * (`internal/api/adminlogstream/handler.go`) emits a drop frame with `missed` /
     * `total` keys, NOT `count`, so the web hook's drop counter does not advance
     * against the real server. The cross-platform mandate for this artifact is parity
     * with the WEB HOOK, so we reproduce its `count` read verbatim; the C# port must
     * do the same so the three clients stay byte-identical. Reconciling the key name
     * with the backend is a separate web-side change, out of scope here.
     */
    public fun parseDropCount(payload: String): Int {
        val obj = parseObject(payload) ?: return 0
        val primitive = obj["count"] as? JsonPrimitive ?: return 0
        if (primitive.isString) return 0
        val number = primitive.doubleOrNull ?: return 0
        return number.toInt()
    }

    /**
     * Appends [event] to [state]'s rolling buffer and increments `totalReceived`,
     * mirroring the web `flushPending`: concatenate, then keep only the last
     * [maxEvents] (FIFO eviction of the oldest). `totalReceived` counts EVERY appended
     * event, even ones later evicted.
     */
    public fun appendLog(
        state: LogStreamState,
        event: LogStreamEvent,
        maxEvents: Int = LOG_STREAM_MAX_EVENTS,
    ): LogStreamState {
        val merged = state.events + event
        val bounded =
            if (merged.size <= maxEvents) {
                merged
            } else {
                merged.subList(merged.size - maxEvents, merged.size).toList()
            }
        return state.copy(events = bounded, totalReceived = state.totalReceived + 1)
    }

    /**
     * Adds [count] to the drop tally, mirroring the web hook's
     * `setDrops((prev) => prev + count)`. Callers apply the web hook's `count > 0`
     * guard before invoking this (see [LogStreamStore]); a non-positive [count] is a
     * no-op here too for safety.
     */
    public fun applyDrop(
        state: LogStreamState,
        count: Int,
    ): LogStreamState = if (count > 0) state.copy(drops = state.drops + count) else state

    /**
     * Drops the in-memory buffer and resets the dropped/received counters, mirroring
     * the web hook's `clear`. Connection flags ([LogStreamState.isConnected],
     * [LogStreamState.error]) are intentionally preserved.
     */
    public fun cleared(state: LogStreamState): LogStreamState = state.copy(events = emptyList(), drops = 0, totalReceived = 0)

    private fun parseObject(raw: String): JsonObject? =
        try {
            json.parseToJsonElement(raw) as? JsonObject
        } catch (e: Exception) {
            null
        }

    // application/x-www-form-urlencoded, matching the browser URLSearchParams.toString
    // the web hook relies on (space → '+'; unreserved chars pass through; everything
    // else is percent-encoded from its UTF-8 bytes).
    private fun formUrlEncode(value: String): String {
        val out = StringBuilder()
        for (byte in value.encodeToByteArray()) {
            val code = byte.toInt() and 0xFF
            val ch = code.toChar()
            when {
                ch == ' ' -> out.append('+')
                ch in 'A'..'Z' ||
                    ch in 'a'..'z' ||
                    ch in '0'..'9' ||
                    ch == '*' ||
                    ch == '-' ||
                    ch == '.' ||
                    ch == '_' -> out.append(ch)
                else -> {
                    out.append('%')
                    out.append(HEX[code shr 4])
                    out.append(HEX[code and 0x0F])
                }
            }
        }
        return out.toString()
    }

    private val HEX = "0123456789ABCDEF"
}
