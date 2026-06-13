// The stream state holder for the AIWatchFaceNLResponse shared surface (P1/S8) — the native analogue of the web
// `useAiStream` hook that owns the watch-face narration lifecycle (web/src/components/ai/AIWatchFaceNLResponse.tsx
// over web/src/hooks/useAiStream.ts). No Compose, no HTTP of its own: the streamed bytes arrive over the injected
// [WatchRespondTransport] seam (the SseTransport analogue the shared SSE client itself is built on), and every
// wire/lifecycle decision delegates to the pure AIWatchFaceNLResponseModel functions, so this holder is fully
// unit-tested off-device by the :android:testReleaseUnitTest gate with a scripted transport — no real network, no
// wall-clock waiting.
//
// Binding (P1/S8): the composable owns no fetch. It constructs this holder over a host-supplied transport (in
// production a Ktor POST → text/event-stream reader against `/ai/watch/respond` carrying the optional `{ message }`
// JSON body; in tests/previews a scripted chunk flow) and a Compose-lifecycle CoroutineScope, then renders
// `state.collectAsStateWithLifecycle()` + `message.collectAsStateWithLifecycle()` and calls [setMessage]/[ask].
// That keeps HTTP entirely out of the view, exactly as the web component delegates the fetch to `useAiStream`
// rather than opening its own stream. A transport failure that throws is classified into the
// [io.teslasync.android.data.ErrorKind] taxonomy (so a dropped connection becomes the offline surface, not a
// generic error), while an in-band `error` frame settles with its server message.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIWatchFaceNLResponse) cannot form a valid Kotlin package identifier, so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located transport seam.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiwatchfacenlresponse

import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The transport seam the respond stream flows through — the surface-local analogue of the shared
 * `io.teslasync.shared.core.net.sse.SseTransport`. An implementation opens one POST connection per [open] call
 * (web `useAiStream` POSTs the optional `{ message }` JSON [body] with `Accept: text/event-stream`) and emits the
 * response body as raw UTF-8 text chunks; line boundaries need NOT align with chunk boundaries —
 * [SseFrameAccumulator] reassembles frames. The returned [Flow] completes when the server closes the stream,
 * throws to signal a transport failure, and is cancelled when the collector cancels. Production wires a Ktor
 * reader against `${api}/api/v1{path}`; tests inject a scripted fake.
 */
fun interface WatchRespondTransport {
    /** Opens a streaming connection for the respond [path] (no `/api/v1` prefix) with the JSON [body]. */
    fun open(
        path: String,
        body: String,
    ): Flow<String>
}

/**
 * Owns the watch-face narration stream lifecycle — the native `useAiStream` analogue. Holds the optional
 * [message] bound to the textarea, exposes the cache-free [state] the composable renders, and an [ask] action
 * that opens the stream over [transport], reassembles + parses frames via the pure model, and folds them through
 * [reduceWatchRespond]. Cancellation (on [cancel] or Compose disposal) closes the connection and returns an
 * in-flight stream to idle — the web hook's AbortController-on-unmount contract.
 *
 * @param transport the injected SSE seam (production Ktor POST reader; test/preview scripted flow).
 * @param online whether connectivity is available; offline leaves [canStart] false so the action never opens a
 *   doomed stream (the native offline affordance the P3 contract requires of an action surface).
 * @param scope the Compose-lifecycle scope the stream runs in (injected as the test scope off-device).
 * @param logger the sanctioned redacting logger for the PII-safe `view.opened` diagnostic.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class WatchRespondController(
    private val transport: WatchRespondTransport,
    private val online: Boolean,
    private val scope: CoroutineScope,
    private val logger: Logger,
    private val clock: () -> Long = { System.currentTimeMillis() },
) {
    private val mutableState = MutableStateFlow(WatchRespondUiState())

    /** The render-ready stream state (web `useAiStream` `{ state, text, error }` slice + last-known narration). */
    val state: StateFlow<WatchRespondUiState> = mutableState.asStateFlow()

    private val mutableMessage = MutableStateFlow("")

    /** The optional free-text question bound to the textarea (web `message` state); two-way via [setMessage]. */
    val message: StateFlow<String> = mutableMessage.asStateFlow()

    private var job: Job? = null
    private var viewOpenedRecorded = false

    /**
     * Whether the action can fire — a within-cap message, a non-paused stream, and connectivity (web `canStart`
     * plus the offline gate). An EMPTY question is allowed: the backend applies its default-summary prompt.
     */
    val canStart: Boolean get() = isWatchRespondReady(mutableMessage.value, mutableState.value.phase, online)

    /**
     * Records the user's question, capped to [MAX_MESSAGE_CHARS] (web Textarea `maxLength`). It is a request
     * input — re-running [ask] submits the latest trimmed value (web `body.message`).
     */
    fun setMessage(text: String) {
        mutableMessage.value = capMessage(text)
    }

    /** Emits the PII-safe `view.opened` diagnostic once per holder (idempotent across recompositions). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        WatchRespondDiagnostics.recordViewOpened(logger)
    }

    /**
     * Opens the respond stream — the web hook `start()`. A no-op while a stream is already in flight (web's
     * `runningRef` coalescing) or when [canStart] is false (over-cap / paused / offline). Resets to a fresh
     * streaming state (retaining the last narration for an offline fallback), then accumulates `delta` text and
     * settles on `done`/`error`; a clean close with no terminal frame settles to done (web's
     * `setState(cur => cur === 'streaming' ? 'done' : cur)`).
     */
    fun ask() {
        if (mutableState.value.isStreaming || !canStart) return
        val body = watchRespondRequestBody(mutableMessage.value)
        logger.info("aiWatchFaceNLResponse.ask")
        cancel()
        mutableState.update { it.startAsking() }
        job = scope.launch { runStream(body) }
    }

    /** Retry after a failure — identical to [ask]; backs the error/offline surfaces' retry affordance. */
    fun retry() = ask()

    /**
     * Cancels an in-flight stream and returns it to idle — the web AbortController path (`cancel()` + the unmount
     * effect). A settled (done/error) state is left intact so the last narration stays readable.
     */
    fun cancel() {
        job?.cancel()
        job = null
        mutableState.update { if (it.isStreaming) it.copy(phase = WatchRespondPhase.Idle, streamingText = "") else it }
    }

    @Suppress("TooGenericExceptionCaught") // web parity: any transport failure becomes the terminal error state.
    private suspend fun runStream(body: String) {
        val accumulator = SseFrameAccumulator()
        try {
            transport.open(WATCH_RESPOND_PATH, body).collect { chunk ->
                for (frame in accumulator.feed(chunk)) {
                    apply(parseWatchFrame(frame))
                }
            }
            apply(accumulator.drain()?.let { parseWatchFrame(it) })
            mutableState.update { it.finishIfStreaming(clock()) }
        } catch (cancellation: CancellationException) {
            mutableState.update { if (it.isStreaming) it.copy(phase = WatchRespondPhase.Idle, streamingText = "") else it }
            throw cancellation
        } catch (failure: Exception) {
            mutableState.update { it.markFailed(failure.message, errorKindOf(failure)) }
        }
    }

    private fun apply(event: AiStreamEvent?) {
        if (event == null) return
        mutableState.update { it.reduceWatchRespond(event, clock()) }
    }
}
