// The AI explain stream seam the AIChargingCurveFingerprintClustering surface binds to (P1/S8), plus the
// real frame-assembly factory and the host-installable process transport — the native port of the web
// `useAiStream` SSE consumer (web/src/hooks/useAiStream.ts) for this surface. The view performs NO work of
// its own: it renders the lifecycle the ViewModel derives from this seam, satisfying the "data flows
// through the shared state holder" contract (ADR-002) and the prompt's "no direct HTTP from the view".
//
// The web `useAiStream` POSTs a JSON body and streams the SSE response over fetch + ReadableStream,
// parsing blank-line-delimited frames into typed events. This file reproduces that split across three
// seams, mirroring the shared SSE stack's [SseTransport] ↔ [SseClient] separation:
//   - [AiExplainTransport] is the POST-SSE byte transport (the analogue of the shared `SseTransport`,
//     but carrying a request body): one `open` per call, emitting raw UTF-8 chunks. Production installs a
//     Ktor-backed transport over the same auth token provider as the REST/live clients; tests script
//     chunks so no real network is touched.
//   - [AiExplainStream] is the typed seam the ViewModel binds to (the analogue of useAiStream itself):
//     one `open` per explain, emitting typed [AiStreamFrame]s. [aiExplainStream] is its production
//     factory — it feeds the transport's chunks through the framework-free [AiSseFrameAccumulator] +
//     [parseAiSseEvent] (unit-tested in the model), so the wire-parsing is identical to the web hook.
//   - [ProcessAiExplainStream] is the process-wide instance the surface defaults to, with [install] so
//     the host DI graph wires the real transport at startup (the byte transport needs the HTTP/auth graph
//     that lives outside this surface's allowed files). Until installed it answers every explain with a
//     single terminal error frame — the native analogue of the web off-mode path, where the explain route
//     returns 404 and useAiStream surfaces it as `state='error'` for the user to retry.
//
// `ktlint:standard:filename` + `MatchingDeclarationName` are suppressed because this file holds the seam
// plus its supporting transport / factory / process instance (no single matching top-level type), and
// `InvalidPackageDeclaration` because the mandated surface directory cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichargingcurvefingerprintclustering

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.Json

/**
 * The explain request — the native analogue of the web `useAiStream` body `{ vehicle_id }`. Carries the
 * resolved [vehicleId] (already validated by [haveInputs] / defaulted by [requestVehicleId]); the
 * transport serialises it to `{"vehicle_id": <id>}` and POSTs it to [AI_CLUSTERING_EXPLAIN_PATH].
 */
data class AiExplainRequest(
    val vehicleId: Long,
)

/**
 * The POST-SSE byte transport — the analogue of the shared `SseTransport`, carrying the request body.
 * Each [open] starts one connection for [request] and emits the response body as raw UTF-8 text chunks
 * (line boundaries need NOT align with chunk boundaries; [AiSseFrameAccumulator] reassembles frames).
 *
 * The returned [Flow]:
 *  - completes normally when the server closes the stream;
 *  - throws to signal a transport failure (the ViewModel maps it to the error lifecycle, web fetch catch);
 *  - is cancelled when the collector cancels (the connection closes, web AbortController).
 *
 * Production installs a Ktor-backed transport (POST + `Accept: text/event-stream`, the bearer from the
 * shared auth token provider) through [ProcessAiExplainStream.install]; tests pass a scripted fake.
 */
fun interface AiExplainTransport {
    /** Opens a streaming POST connection for [request], emitting raw text chunks. */
    fun open(request: AiExplainRequest): Flow<String>
}

/**
 * The typed stream seam the ViewModel binds to (P1/S8) — the native analogue of the web `useAiStream`
 * result. Each [open] yields a cold [Flow] of typed [AiStreamFrame]s for one explain; collecting it opens
 * the underlying transport, cancelling the collection closes it. A concrete adapter over the byte
 * [AiExplainTransport] (or a test fake) drives this seam; no HTTP ever touches the view.
 */
fun interface AiExplainStream {
    /** Opens a fresh explain stream for [request]. */
    fun open(request: AiExplainRequest): Flow<AiStreamFrame>
}

/**
 * Builds the production [AiExplainStream] over [transport]: each [AiExplainStream.open] starts a fresh
 * `transport.open(request)` and feeds its raw chunks through the framework-free [AiSseFrameAccumulator] +
 * [parseAiSseEvent], emitting the typed [AiStreamFrame]s in arrival order — the exact wire-parsing the web
 * `useAiStream` read loop performs. A trailing fragment with no closing blank line is drained at the end
 * (web "drain any final fragment"). [json] is the shared serializer used to decode each frame's payload.
 */
fun aiExplainStream(
    transport: AiExplainTransport,
    json: Json = Json,
): AiExplainStream =
    AiExplainStream { request ->
        flow {
            val accumulator = AiSseFrameAccumulator()
            transport.open(request).collect { chunk -> emitFrames(accumulator.feed(chunk), json) }
            accumulator.flush()?.let { emitFrames(listOf(it), json) }
        }
    }

/** Parses each raw [rawFrames] entry and emits every recognised [AiStreamFrame], skipping malformed ones. */
private suspend fun FlowCollector<AiStreamFrame>.emitFrames(
    rawFrames: List<String>,
    json: Json,
) {
    for (raw in rawFrames) {
        parseAiSseEvent(raw, json)?.let { emit(it) }
    }
}

/**
 * The stable error code the uninstalled [ProcessAiExplainStream] answers with — the native analogue of
 * the web off-mode `stream_http_404`: the explain service is not reachable, so the surface shows its
 * Helix-error state with the action available to retry once the host wires the transport.
 */
const val STREAM_UNAVAILABLE_CODE: String = "stream_unavailable"

/**
 * The process-wide [AiExplainStream] the surface defaults to — the native analogue of the web module-level
 * `useAiStream` every AI card shares. The host's auth/networking DI graph (outside this surface's allowed
 * files) calls [install] once at startup with the real Ktor-backed [AiExplainTransport]; until then every
 * explain answers with a single terminal error frame ([STREAM_UNAVAILABLE_CODE]) the card renders as its
 * error state. A test constructs its own [aiExplainStream] over a scripted transport, so this singleton is
 * never polluted across cases.
 */
object ProcessAiExplainStream : AiExplainStream {
    @Volatile
    private var delegate: AiExplainStream = unavailable()

    /** Wires the real byte [transport] (host DI, once at startup); subsequent explains stream through it. */
    fun install(
        transport: AiExplainTransport,
        json: Json = Json,
    ) {
        delegate = aiExplainStream(transport, json)
    }

    /** Restores the uninstalled (service-unavailable) default — used to tear down between test cases. */
    fun reset() {
        delegate = unavailable()
    }

    override fun open(request: AiExplainRequest): Flow<AiStreamFrame> = delegate.open(request)

    private fun unavailable(): AiExplainStream = AiExplainStream { flowOf(AiStreamFrame.Error(STREAM_UNAVAILABLE_CODE)) }
}
