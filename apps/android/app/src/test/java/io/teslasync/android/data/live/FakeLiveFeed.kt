package io.teslasync.android.data.live

import io.teslasync.shared.core.net.sse.Connection
import io.teslasync.shared.core.net.sse.LiveEvent
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow

/**
 * A scriptable, in-memory [LiveFeed] for deterministic [LiveSessionStore] tests — no real `SseClient`,
 * network, or clock. The test drives the [connection] lifecycle directly and pushes [LiveEvent]s into
 * the currently-open stream via [emitEvent], while [opens] and [activeStreams] expose the open/close
 * bookkeeping so foreground/auth gating, reconnect, and clean cancellation are all assertable.
 */
internal class FakeLiveFeed : LiveFeed {
    /** Total number of [open] calls (one per session the store starts — gate flip / reconnect). */
    var opens: Int = 0
        private set

    /** Number of currently-collected event streams — must return to 0 on clean teardown. */
    var activeStreams: Int = 0
        private set

    /** The shared connection lifecycle the store mirrors; drive it with [setConnection]. */
    val connection: MutableStateFlow<Connection> = MutableStateFlow(Connection.Closed)

    private var current: Channel<LiveEvent>? = null

    override fun open(): LiveStream {
        opens += 1
        val channel = Channel<LiveEvent>(Channel.BUFFERED)
        current = channel
        val events: Flow<LiveEvent> =
            flow {
                activeStreams += 1
                try {
                    for (event in channel) {
                        emit(event)
                    }
                } finally {
                    activeStreams -= 1
                }
            }
        return LiveStream(events, connection)
    }

    /** Pushes [event] into the most-recently-opened stream. */
    suspend fun emitEvent(event: LiveEvent) {
        checkNotNull(current) { "no stream open" }.send(event)
    }

    /** Drives the shared connection lifecycle the store mirrors. */
    fun setConnection(value: Connection) {
        connection.value = value
    }
}
