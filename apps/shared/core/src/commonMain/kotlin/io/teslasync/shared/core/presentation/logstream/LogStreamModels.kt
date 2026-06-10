package io.teslasync.shared.core.presentation.logstream

import kotlinx.serialization.json.JsonObject

/**
 * Maximum number of events kept in the rolling client-side buffer, mirroring the web
 * `LOG_STREAM_MAX_EVENTS`. Older events are evicted FIFO; the backend already drops
 * events when its per-subscriber buffer fills, so this is purely a memory ceiling.
 */
public const val LOG_STREAM_MAX_EVENTS: Int = 1000

/**
 * Default SSE path relative to the API root, mirroring the web `LOG_STREAM_PATH`. The
 * resilient transport adds the `/api/v1` prefix (see `internal/api/router.go`'s
 * `/admin/logs/stream` route).
 */
public const val LOG_STREAM_PATH: String = "/admin/logs/stream"

/**
 * Severity threshold for the server-side filter, mirroring the web `LogStreamLevel`
 * union. Matches the levels the backend handler supports (`debug` includes everything
 * down to debug; `error` only surfaces error/fatal/panic).
 *
 * [wire] is the lowercase token sent as the `level` query parameter — the exact string
 * the Go `parseLogStreamLevel` expects.
 */
public enum class LogStreamLevel(
    public val wire: String,
) {
    Debug("debug"),
    Info("info"),
    Warn("warn"),
    Error("error"),
}

/**
 * A single parsed log row, mirroring the web `LogStreamEvent` interface.
 *
 * [payload] is the raw zerolog JSON line so consumers can render arbitrary fields
 * without pre-modelling them; [parsed] is the lazily-decoded object form (or `null`
 * when the payload isn't valid JSON — the consumer falls back to the raw text).
 *
 * [seq] is a monotonic counter assigned on receive so list keys stay stable across
 * re-renders even when two events share the same timestamp. [receivedAt] is the
 * client clock value (epoch millis) at receive time.
 */
public data class LogStreamEvent(
    val seq: Int,
    val receivedAt: Long,
    val payload: String,
    val parsed: JsonObject?,
    val level: String,
)

/**
 * Immutable UI-free snapshot of the log stream, mirroring the web hook's
 * `UseLogStreamResult` (minus the `clear` callback, which is a [LogStreamStore]
 * method).
 *
 * @property events the current rolling buffer, oldest-first / newest-last (exactly the
 *   append order the web hook's `prev.concat(batch)` produces).
 * @property isConnected whether the underlying stream is currently open.
 * @property error the most recent transport error message, or `null` when healthy.
 * @property drops total dropped-event count reported by the server since connect.
 * @property totalReceived total events received since the holder was created (NOT just
 *   those still in the rolling buffer).
 */
public data class LogStreamState(
    val events: List<LogStreamEvent> = emptyList(),
    val isConnected: Boolean = false,
    val error: String? = null,
    val drops: Int = 0,
    val totalReceived: Int = 0,
)
