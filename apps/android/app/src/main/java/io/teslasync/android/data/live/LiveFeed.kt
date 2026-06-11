// File holds the LiveFeed seam plus its production factory + stream type (supporting declarations).
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.data.live

import io.teslasync.shared.core.net.sse.Connection
import io.teslasync.shared.core.net.sse.LiveEvent
import io.teslasync.shared.core.net.sse.SseClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * One opened live stream: the cold [events] flow paired with the [connection] lifecycle it drives.
 * The Android analogue of the shared `LiveSubscription`, but a public type the app can construct so
 * tests inject a scripted stream without reaching the shared module's `internal` constructor.
 *
 * Collecting [events] opens the underlying SSE connection (the shared client's contract); cancelling
 * that collection closes it. [connection] mirrors the same subscription's state.
 */
class LiveStream(
    val events: Flow<LiveEvent>,
    val connection: StateFlow<Connection>,
)

/**
 * The seam [LiveSessionStore] streams through — the app-side indirection over the shared [SseClient].
 * Each [open] yields one fresh [LiveStream]. Production wraps `SseClient.subscribe()` (see the
 * [LiveFeed] factory); tests pass a scripted fake so lifecycle gating, folding, reconnect, staleness,
 * re-auth, and cancellation are exercised deterministically with no real network or clock.
 */
fun interface LiveFeed {
    /** Opens a fresh live stream. */
    public fun open(): LiveStream
}

/**
 * Builds the production [LiveFeed] over the shared [sseClient]: each [LiveFeed.open] starts a new
 * cold `subscribe()` on [path] (the shared client adds the `/api/v1` prefix and resumes with
 * `Last-Event-ID` across its own reconnects). The single client is wired in the auth/networking graph
 * over the same token provider as the REST client, so every (re)connection carries the current bearer.
 */
fun LiveFeed(
    sseClient: SseClient,
    path: String? = null,
): LiveFeed =
    LiveFeed {
        val subscription = if (path != null) sseClient.subscribe(path) else sseClient.subscribe()
        LiveStream(subscription.events, subscription.connection)
    }
