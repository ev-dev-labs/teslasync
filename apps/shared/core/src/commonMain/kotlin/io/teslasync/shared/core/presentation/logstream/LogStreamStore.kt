package io.teslasync.shared.core.presentation.logstream

import io.teslasync.shared.core.net.sse.SseFrameParser
import io.teslasync.shared.core.net.sse.SseRequest
import io.teslasync.shared.core.net.sse.SseTransport
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * UI-free shared state holder for the admin live-log feed — the cross-platform port of
 * the web `useLogStream` hook (`web/src/api/hooks/useLogStream.ts`). Every native
 * LiveLogs surface (Android/Apple via KMP, Windows via the C# port) binds to this
 * single holder rather than re-implementing the SSE framing and rolling-buffer rules.
 *
 * It opens ONE streaming connection to `/admin/logs/stream?level=…[&grep=…]` through
 * the injected [SseTransport] (the same transport the live `SseClient` uses), parses
 * the `text/event-stream` body with the shared [SseFrameParser], and folds frames into
 * [state] via [LogStreamReducer]:
 *  - `log`        → append to the rolling buffer (FIFO-bounded to [maxEvents]);
 *  - `drop`       → accumulate the server-reported drop count;
 *  - `connected` / `heartbeat` / unnamed → ignored.
 *
 * Like the web hook it does NOT auto-reconnect: when the stream ends or fails the
 * connection simply closes (a failure surfaces through [LogStreamState.error]).
 * [setPaused] mirrors the hook's `paused` flag — it stops appending `log` events
 * WITHOUT tearing the connection down (so the server keeps the buffer filling while the
 * user reads); drop counting continues while paused. The rolling buffer is transient:
 * restarting the holder (or the app) clears it, matching the hook's page-refresh
 * semantics.
 *
 * The web hook batches appends via `requestAnimationFrame` purely as a renderer
 * optimisation; that batching changes nothing about the resulting buffer contents or
 * counters, so this holder folds each event synchronously — the data behaviour is
 * identical.
 *
 * @property transport the SSE transport the connection streams through. Production
 *   passes a `KtorSseTransport`; tests pass a scripted fake.
 * @property scope the coroutine scope the SSE collection runs in. Cancelling it tears
 *   the subscription down; the holder launches no work outside it.
 * @property level severity threshold sent as the `level` query parameter.
 * @property grep optional server-side regex filter; omitted from the URL when blank.
 * @property maxEvents rolling-buffer ceiling (FIFO eviction), defaulting to
 *   [LOG_STREAM_MAX_EVENTS].
 * @property basePath SSE path root, defaulting to [LOG_STREAM_PATH].
 * @property nowMillis client clock seam stamped onto each event's `receivedAt`;
 *   injectable so tests are deterministic.
 */
public class LogStreamStore(
    private val transport: SseTransport,
    private val scope: CoroutineScope,
    private val level: LogStreamLevel,
    private val grep: String = "",
    private val maxEvents: Int = LOG_STREAM_MAX_EVENTS,
    private val basePath: String = LOG_STREAM_PATH,
    private val nowMillis: () -> Long = { 0L },
) {
    init {
        require(maxEvents >= 1) { "maxEvents must be >= 1, was $maxEvents" }
    }

    private val _state = MutableStateFlow(LogStreamState())

    /** The current UI-free snapshot of the log stream. */
    public val state: StateFlow<LogStreamState> = _state.asStateFlow()

    private var job: Job? = null
    private var paused: Boolean = false
    private var seqCounter: Int = 0

    /**
     * Opens the live subscription and begins folding frames into [state]. Idempotent:
     * a second call while already running is a no-op.
     */
    public fun start() {
        if (job?.isActive == true) return
        val path = LogStreamReducer.buildLogStreamPath(level, grep, basePath)
        job =
            scope.launch {
                _state.update { it.copy(error = null) }
                val parser = SseFrameParser()
                try {
                    transport.open(SseRequest(path, null)).collect { chunk ->
                        _state.update { if (it.isConnected) it else it.copy(isConnected = true) }
                        for (frame in parser.feed(chunk)) {
                            handleFrame(frame.event, frame.data)
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    _state.update { it.copy(error = e.message ?: e.toString()) }
                } finally {
                    _state.update { it.copy(isConnected = false) }
                }
            }
    }

    /**
     * Closes the live subscription. The retained buffer and counters are left
     * untouched, matching the web hook's in-memory list surviving an unmounted effect.
     */
    public fun stop() {
        job?.cancel()
        job = null
    }

    /**
     * Toggles the paused flag. While paused the holder stays connected but stops
     * appending `log` events ([LogStreamState.events] / `totalReceived` freeze); drop
     * counting continues — exactly the web hook's `paused` behaviour.
     */
    public fun setPaused(value: Boolean) {
        paused = value
    }

    /**
     * Drops the in-memory buffer and resets the dropped/received counters, mirroring
     * the web hook's `clear`. The connection (if open) is left running.
     */
    public fun clear() {
        _state.update { LogStreamReducer.cleared(it) }
    }

    private fun handleFrame(
        event: String?,
        data: String,
    ) {
        when (event) {
            "log" -> {
                if (paused) return
                val nextSeq = nextSeq()
                val logEvent = LogStreamReducer.buildLogEvent(data, nextSeq, nowMillis())
                _state.update { LogStreamReducer.appendLog(it, logEvent, maxEvents) }
            }

            "drop" -> {
                val count = LogStreamReducer.parseDropCount(data)
                if (count > 0) {
                    _state.update { LogStreamReducer.applyDrop(it, count) }
                }
            }

            // "connected", "heartbeat", and unnamed/other frames carry no buffer
            // mutation — the web hook ignores them too.
            else -> Unit
        }
    }

    private fun nextSeq(): Int {
        seqCounter = (seqCounter + 1) and 0x7FFFFFFF
        return seqCounter
    }
}
