// The data port the AISuggestNewGeofences surface binds to — the native analogue of the web `useAiStream` hook
// this component consumes (web/src/hooks/useAiStream.ts, opened against POST /ai/geofences/draft with the
// location_id carried in the JSON body — the backend route has no path parameter). The view never touches the
// network itself; it binds the [AISuggestNewGeofencesViewModel], which binds this [AiGeofenceDraftSource] seam, so
// a test fake stands in for the whole transport and the surface is verified off-device.
//
// Layering (P1/S8): the surface owns the DECODE + projection (the parity-critical substance), not the socket.
//   - [AiGeofenceDraftTransport] is the raw-bytes seam — `open(locationId)` yields the `text/event-stream` body as
//     UTF-8 text chunks (line boundaries need NOT align with chunk boundaries). It is intentionally framework-
//     free: the app module performs no raw HTTP (DataContainer's contract), so the production Ktor-backed
//     transport is supplied by the host's network graph — exactly as the shared GET live stream is wired with
//     `KtorSseTransport` in AuthContainer. This keeps the app module dependency-clean and the seam test-fakeable.
//   - [SseAiGeofenceDraftSource] is the real decoder: it reassembles frames from the chunk stream (the web
//     `buffer.split(/\r?\n\r?\n/)` read loop) and parses each into a typed [AiStreamEvent] via the off-device
//     tested [AiGeofenceDraftReducer.parseFrame]. This is the genuine port of the web hook's parser, not a stub.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located transport seam +
// reassembler + binding adapter.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisuggestnewgeofences

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/**
 * The single seam the [AISuggestNewGeofencesViewModel] depends on, so it binds to an abstraction (real decoder
 * over a Ktor transport ↔ test fake) rather than to concrete networking. [draft] opens one propose-only Helix
 * draft stream for [locationId] and emits the typed [AiStreamEvent]s in arrival order (the native `useAiStream`
 * for `/ai/geofences/draft`). The returned [Flow] is cold — collecting it opens the stream; cancelling the
 * collection closes it (web: AbortController on unmount / location change).
 */
fun interface AiGeofenceDraftSource {
    /** Opens a draft stream for [locationId], emitting decoded events until the server closes it or it errors. */
    fun draft(locationId: Long): Flow<AiStreamEvent>
}

/**
 * The raw `text/event-stream` transport seam — the SSE analogue of the resilient HTTP client's engine, scoped to
 * this surface's POST endpoint. An implementation opens one connection per [open] call (POSTing the
 * `{ location_id }` JSON body the web component sends — the backend reads its only input from that body) and
 * emits the response body as UTF-8 text chunks.
 *
 * The returned [Flow]:
 *  - completes normally when the server closes the stream;
 *  - throws to signal a transport failure (no connectivity / non-2xx) — the view-model maps this to the error
 *    state with a retry affordance (the honest "offline" branch: there is no cached proposal to fall back to);
 *  - is cancelled when the collector cancels (the stream is closed).
 *
 * Production is a thin Ktor `preparePost { … }.execute { bodyAsChannel().readUTF8Line() }` supplied by the host
 * network graph (mirroring [io.teslasync.shared.core.net.sse.KtorSseTransport] for the GET live stream); tests
 * inject a scripted fake so no real network or wall-clock is involved.
 */
fun interface AiGeofenceDraftTransport {
    /** Opens a streaming POST connection for [locationId], emitting raw `text/event-stream` text chunks. */
    fun open(locationId: Long): Flow<String>
}

/**
 * Reassembles complete SSE frames from a stream of arbitrarily-chunked UTF-8 text — the native port of the web
 * `useAiStream` read loop (`buffer += chunk; parts = buffer.split(/\r?\n\r?\n/); buffer = parts.pop()`). Frames
 * are blank-line delimited (`\n\n`, tolerant of `\r\n\r\n`); a partial trailing frame is held until the next
 * [feed], and [flush] drains any final frame that arrived without a trailing blank line (some intermediaries
 * strip it). Stateful and single-collector — one instance per stream.
 */
class SseFrameReassembler {
    private val buffer = StringBuilder()

    /** Appends [chunk] and returns every complete, non-blank frame it newly closed (the partial tail is kept). */
    fun feed(chunk: String): List<String> {
        buffer.append(chunk)
        val parts = buffer.toString().split(FRAME_DELIMITER)
        // The last fragment may be incomplete — keep it for the next read.
        val tail = parts.last()
        buffer.setLength(0)
        buffer.append(tail)
        return parts.dropLast(1).filter { it.isNotBlank() }
    }

    /** Returns the final buffered frame if it is non-blank (a frame with no trailing blank line); else `null`. */
    fun flush(): String? {
        val remaining = buffer.toString()
        buffer.setLength(0)
        return remaining.takeIf { it.isNotBlank() }
    }

    private companion object {
        /** Blank-line frame terminator, tolerant of CRLF normalisation (web `SSE_DELIM_RE`). */
        val FRAME_DELIMITER = Regex("\\r?\\n\\r?\\n")
    }
}

/**
 * The production [AiGeofenceDraftSource]: decodes the [transport]'s raw `text/event-stream` chunks into typed
 * [AiStreamEvent]s. It reassembles frames with an [SseFrameReassembler] and parses each through the off-device
 * tested [AiGeofenceDraftReducer.parseFrame], draining the final partial frame on stream end — a faithful port of
 * the web hook's read-parse-emit loop. A transport failure propagates (the view-model surfaces it as the error
 * state); cancellation closes the stream.
 */
class SseAiGeofenceDraftSource(
    private val transport: AiGeofenceDraftTransport,
) : AiGeofenceDraftSource {
    override fun draft(locationId: Long): Flow<AiStreamEvent> =
        flow {
            val reassembler = SseFrameReassembler()
            transport.open(locationId).collect { chunk ->
                for (frame in reassembler.feed(chunk)) {
                    AiGeofenceDraftReducer.parseFrame(frame)?.let { emit(it) }
                }
            }
            reassembler.flush()?.let { frame ->
                AiGeofenceDraftReducer.parseFrame(frame)?.let { emit(it) }
            }
        }
}

/**
 * Binds the surface to a real [SseAiGeofenceDraftSource] over the host-supplied [transport] — the production
 * wiring a host passes when constructing the surface's view-model. Tests inject a fake [AiGeofenceDraftSource] (or
 * a fake [AiGeofenceDraftTransport]) instead.
 */
fun bindAiGeofenceDraftSource(transport: AiGeofenceDraftTransport): AiGeofenceDraftSource = SseAiGeofenceDraftSource(transport)
