package io.teslasync.shared.core.net.sse

import kotlinx.coroutines.flow.Flow

/**
 * One SSE connection attempt's intent. [path] is the API path WITHOUT the `/api/v1`
 * prefix (the transport adds it), mirroring the resilient HTTP client's contract.
 * [lastEventId] is forwarded as the `Last-Event-ID` request header so the server can
 * resume the stream after a reconnect; `null` on a fresh connection.
 */
public data class SseRequest(
    val path: String,
    val lastEventId: String?,
)

/**
 * The transport seam [SseClient] streams through — the SSE analogue of the HTTP
 * client's engine. Implementations open one connection per [open] call and emit the
 * response body as raw UTF-8 text chunks (line boundaries need NOT align with chunk
 * boundaries; the client's [SseFrameParser] reassembles frames).
 *
 * The returned [Flow]:
 *  - completes normally when the server closes the stream (the client reconnects);
 *  - throws to signal a transport failure (the client reconnects with backoff);
 *  - is cancelled when the collector cancels (the client closes the connection).
 *
 * Production uses [KtorSseTransport]; tests inject a scripted fake so no real network
 * or wall-clock sleeping is involved.
 */
public fun interface SseTransport {
    /** Opens a streaming connection for [request], emitting raw text chunks. */
    public fun open(request: SseRequest): Flow<String>
}
