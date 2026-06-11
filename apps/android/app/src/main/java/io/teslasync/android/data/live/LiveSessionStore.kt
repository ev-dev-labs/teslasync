package io.teslasync.android.data.live

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.sse.Connection
import io.teslasync.shared.core.net.sse.LiveEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * App-scoped holder that binds the shared [io.teslasync.shared.core.net.sse.SseClient] (via the
 * [LiveFeed] seam) to Android's foreground + auth + page lifecycle, the single source of truth every
 * live surface observes (ADR-009). It is deliberately NOT a `ViewModel`: the live pipe is app-global
 * (one stream feeds every page/widget), so — like the auth state — it is built once in the DI graph
 * and projected by page ViewModels.
 *
 * The subscription is opened only while **all three** hold, and is torn down (closing the SSE
 * connection) the moment any drops:
 *  1. the app is **foreground** — driven by `ProcessLifecycleOwner` through [setForeground]
 *     ([AppLifecycleSseBinder]); a backgrounded app holds no stream (ADR-009: push, not held streams);
 *  2. the session is **authenticated** — a signed-out/expired session streams nothing, and a fresh
 *     sign-in / re-auth (authenticated flips back true) transparently reopens with the new credential;
 *  3. a **page is observing** [state] — the `WhileSubscribed` re-share means the upstream is collected
 *     only while a lifecycle-aware consumer (`collectAsStateWithLifecycle`) is mounted, and is dropped
 *     a short timeout after the last screen leaves.
 *
 * While open it folds the shared client's `Connection` lifecycle + `LiveEvent`s into [LiveSessionState]:
 * connection/staleness verbatim from the client (ADR-013's 2-minute stale window lives in the client),
 * and `vehicle_update` / `signal_change` payloads merged per-vehicle so a panel never blanks. Last-known
 * values are retained when the wire drops or goes stale — they are flagged, never hidden.
 *
 * @param feed the live-stream seam (production wraps the single shared `SseClient`).
 * @param authenticated whether the session can stream (true for SignedIn/Refreshing); gates + re-auths.
 * @param scope the app-scoped coroutine scope the re-share runs in.
 * @param logger the single sanctioned redacting logger (ADR-016) — only redacted event metadata.
 * @param nowMillis client clock stamped on each merge / last-message; injectable for deterministic tests.
 * @param onReauth nudged on an explicit [reconnect] so a stuck/401 stream picks up a refreshed token on
 *   the next open — the SSE re-auth seam, with no per-page token code (default no-op).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LiveSessionStore(
    private val feed: LiveFeed,
    private val authenticated: StateFlow<Boolean>,
    private val scope: CoroutineScope,
    private val logger: Logger,
    private val nowMillis: () -> Long = { System.currentTimeMillis() },
    private val onReauth: suspend () -> Unit = {},
) {
    private val foreground = MutableStateFlow(false)
    private val epoch = MutableStateFlow(0)

    /**
     * The live pipeline snapshot. Cold until observed: collecting it (through a page ViewModel) opens
     * the gated subscription; the last observer leaving closes it after [STOP_TIMEOUT_MILLIS] (a short
     * config-change grace).
     */
    val state: StateFlow<LiveSessionState> =
        combine(foreground, authenticated, epoch) { fg, auth, ep -> Gate(active = fg && auth, epoch = ep) }
            .distinctUntilChanged()
            .flatMapLatest { gate -> if (gate.active) sessionFrames() else flowOf(Frame.Closed) }
            .scan(LiveSessionState.Initial) { acc, frame -> reduce(acc, frame) }
            .stateIn(scope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), LiveSessionState.Initial)

    /**
     * Reports the app's foreground state (called by [AppLifecycleSseBinder] from `ProcessLifecycleOwner`).
     * `true` lets the stream open (with the other gates); `false` tears it down — no background streams.
     */
    fun setForeground(value: Boolean) {
        if (foreground.value == value) return
        logger.info("live.foreground", mapOf("foreground" to value.toString()))
        foreground.value = value
    }

    /**
     * Forces a fresh connection now (user "retry", or recovery from a stuck/stale stream) and nudges
     * [onReauth] so the reopened stream carries a refreshed credential. A no-op effect while the stream
     * is gated closed except that, once it reopens, it starts from a clean attempt.
     */
    fun reconnect() {
        logger.info("live.reconnect")
        epoch.update { it + 1 }
        scope.launch { onReauth() }
    }

    /**
     * One live session: opens the [feed], forwards its `Connection` lifecycle and `LiveEvent`s as
     * [Frame]s, and closes the underlying connection when this flow is cancelled (gate change / last
     * observer leaving) — the clean-cancellation contract. `channelFlow` is buffered, so the two
     * producers (connection + events) never deadlock on a slow collector.
     */
    private fun sessionFrames(): Flow<Frame> =
        channelFlow {
            val stream = feed.open()
            val connectionJob =
                launch {
                    stream.connection.collect { send(Frame.Conn(it)) }
                }
            try {
                stream.events.collect { send(Frame.Event(it)) }
            } finally {
                connectionJob.cancel()
            }
        }

    private fun reduce(
        acc: LiveSessionState,
        frame: Frame,
    ): LiveSessionState =
        when (frame) {
            Frame.Closed -> acc.copy(connection = Connection.Closed)
            is Frame.Conn ->
                acc.copy(
                    connection = frame.connection,
                    hasEverConnected = acc.hasEverConnected || frame.connection == Connection.Open,
                )

            is Frame.Event -> reduceEvent(acc, frame.event)
        }

    private fun reduceEvent(
        acc: LiveSessionState,
        event: LiveEvent,
    ): LiveSessionState {
        val now = nowMillis()
        return acc.copy(
            hasEverConnected = true,
            lastMessageAtMillis = now,
            vehicles = mergeLiveEvent(acc.vehicles, event, now),
        )
    }

    /** Internal projection of one collected frame from a live session. */
    private sealed interface Frame {
        /** The gate closed the session (background / signed-out): the wire is down. */
        data object Closed : Frame

        /** The shared client's connection lifecycle advanced. */
        data class Conn(
            val connection: Connection,
        ) : Frame

        /** A typed live event arrived. */
        data class Event(
            val event: LiveEvent,
        ) : Frame
    }

    /** The combined gate: whether to stream, and a bump-able epoch so [reconnect] forces a fresh open. */
    private data class Gate(
        val active: Boolean,
        val epoch: Int,
    )

    private companion object {
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
