// The stream state holder for the AIAutoTripNameSuggestion shared surface (P1/S8) — the native analogue of the
// web `useAiStream` hook that owns the propose-only trip-name draft lifecycle
// (web/src/components/ai/AIAutoTripNameSuggestion.tsx over web/src/hooks/useAiStream.ts). No Compose, no HTTP
// of its own: the streamed bytes arrive over the injected [TripNameDraftTransport] seam (the SseTransport
// analogue the shared SSE client itself is built on), and every wire/lifecycle decision delegates to the pure
// AIAutoTripNameSuggestionModel functions, so this holder is fully unit-tested off-device by the
// :android:testReleaseUnitTest gate with a scripted transport — no real network, no wall-clock waiting.
//
// Binding (P1/S8): the composable owns no fetch. It constructs this holder over a host-supplied transport (in
// production a Ktor POST → text/event-stream reader against `/ai/trips/{id}/name/draft`; in tests/previews a
// scripted chunk flow) and a Compose-lifecycle [kotlinx.coroutines.CoroutineScope], then renders
// `state.collectAsStateWithLifecycle()` and calls [suggest]. That keeps HTTP entirely out of the view, exactly
// as the web component delegates the fetch to `useAiStream` rather than opening its own stream.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIAutoTripNameSuggestion) cannot form a valid Kotlin package identifier, so
// the package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located transport seam.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aiautotripnamesuggestion

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
 * The transport seam the draft stream flows through — the surface-local analogue of the shared
 * `io.teslasync.shared.core.net.sse.SseTransport`. An implementation opens one POST connection per [open] call
 * (web `useAiStream` POSTs an empty body with `Accept: text/event-stream`) and emits the response body as raw
 * UTF-8 text chunks; line boundaries need NOT align with chunk boundaries — [SseFrameAccumulator] reassembles
 * frames. The returned [Flow] completes when the server closes the stream, throws to signal a transport
 * failure, and is cancelled when the collector cancels. Production wires a Ktor reader against
 * `${api}/api/v1{path}`; tests inject a scripted fake.
 */
fun interface TripNameDraftTransport {
    /** Opens a streaming connection for the draft [path] (no `/api/v1` prefix), emitting raw text chunks. */
    fun open(path: String): Flow<String>
}

/**
 * Owns the trip-name draft stream lifecycle for one trip — the native `useAiStream` analogue. Exposes the
 * cache-free [state] the composable renders and a [suggest] action that opens the stream over [transport],
 * reassembles + parses frames via the pure model, and folds them through [reduceDraft]. Cancellation (on
 * [cancel] or Compose disposal) closes the connection and returns an in-flight stream to idle — the web hook's
 * AbortController-on-unmount contract.
 *
 * @param transport the injected SSE seam (production Ktor POST reader; test/preview scripted flow).
 * @param tripId the trip being named; a blank / null id leaves [canStart] false (web `canStart = !!tripId`).
 * @param online whether connectivity is available; offline leaves [canStart] false so the action never opens a
 *   doomed stream (the native offline affordance the P3 contract requires of an action surface).
 * @param scope the Compose-lifecycle scope the stream runs in (injected as the test scope off-device).
 * @param logger the sanctioned redacting logger for the PII-safe `view.opened` diagnostic.
 */
class AutoTripNameDraftController(
    private val transport: TripNameDraftTransport,
    private val tripId: String?,
    private val online: Boolean,
    private val scope: CoroutineScope,
    private val logger: Logger,
) {
    private val mutableState = MutableStateFlow(TripNameDraftUiState.IDLE)

    /** The render-ready stream state (web `useAiStream` `{ state, text, error }` slice). */
    val state: StateFlow<TripNameDraftUiState> = mutableState.asStateFlow()

    private var job: Job? = null
    private var viewOpenedRecorded = false

    /** Whether the action can fire — a present trip id and connectivity (web `canStart` plus offline gating). */
    val canStart: Boolean get() = !tripId.isNullOrBlank() && online

    /** Emits the PII-safe `view.opened` diagnostic once per holder (idempotent across recompositions). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        AutoTripNameSuggestionDiagnostics.recordViewOpened(logger)
    }

    /**
     * Opens the draft stream — the web hook `start()`. A no-op while a stream is already in flight (web's
     * `runningRef` coalescing) or when [canStart] is false. Resets to a fresh streaming state, then accumulates
     * `delta` text and settles on `done`/`error`; a clean close with no terminal frame settles to done (web's
     * `setState(cur => cur === 'streaming' ? 'done' : cur)`).
     */
    fun suggest() {
        if (mutableState.value.isStreaming || !canStart) return
        cancel()
        mutableState.value = TripNameDraftUiState(phase = DraftPhase.Streaming)
        job = scope.launch { runStream() }
    }

    /**
     * Cancels an in-flight stream and returns it to idle — the web AbortController path (`cancel()` + the
     * unmount effect). A settled (done/error) state is left intact so the last proposal stays readable.
     */
    fun cancel() {
        job?.cancel()
        job = null
        mutableState.update { if (it.isStreaming) TripNameDraftUiState.IDLE else it }
    }

    @Suppress("TooGenericExceptionCaught") // web parity: any transport failure becomes the terminal error state.
    private suspend fun runStream() {
        val accumulator = SseFrameAccumulator()
        try {
            transport.open(draftPath(tripId)).collect { chunk ->
                for (frame in accumulator.feed(chunk)) {
                    apply(parseSseFrame(frame))
                }
            }
            apply(accumulator.drain()?.let { parseSseFrame(it) })
            mutableState.update { if (it.isStreaming) it.copy(phase = DraftPhase.Done) else it }
        } catch (cancellation: CancellationException) {
            mutableState.update { if (it.isStreaming) TripNameDraftUiState.IDLE else it }
            throw cancellation
        } catch (failure: Exception) {
            mutableState.update { it.copy(phase = DraftPhase.Failed, error = failure.message ?: UNKNOWN_ERROR) }
        }
    }

    private fun apply(event: AiStreamEvent?) {
        if (event == null) return
        mutableState.update { reduceDraft(it, event) }
    }
}
