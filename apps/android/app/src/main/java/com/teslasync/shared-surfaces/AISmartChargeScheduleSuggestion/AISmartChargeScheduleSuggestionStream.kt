// The stream state holder for the AISmartChargeScheduleSuggestion shared surface (P1/S8) — the native analogue of
// the web `useAiStream` hook that owns the smart-charge draft lifecycle (web/src/components/ai/
// AISmartChargeScheduleSuggestion.tsx over web/src/hooks/useAiStream.ts). No Compose, no HTTP of its own: the
// streamed bytes arrive over the injected [ScheduleDraftTransport] seam (the SseTransport analogue the shared SSE
// client itself is built on), and every wire/lifecycle decision delegates to the pure
// AISmartChargeScheduleSuggestionModel functions, so this holder is fully unit-tested off-device by the
// :android:testReleaseUnitTest gate with a scripted transport — no real network, no wall-clock waiting.
//
// Binding (P1/S8): the composable owns no fetch. It constructs this holder over a host-supplied transport (in
// production a Ktor POST → text/event-stream reader against `/ai/charging/schedule/draft` carrying the charge-plan
// JSON body; in tests/previews a scripted chunk flow), a Compose-lifecycle [kotlinx.coroutines.CoroutineScope],
// and a [java.time.Clock] (the depart_by-normalization seam), then renders `state.collectAsStateWithLifecycle()`
// and calls [draft]. That keeps HTTP entirely out of the view, exactly as the web component delegates the fetch to
// `useAiStream` rather than opening its own stream.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AISmartChargeScheduleSuggestion) cannot form a valid Kotlin package identifier,
// so the package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located transport seam.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aismartchargeschedulesuggestion

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
import java.time.Clock

/**
 * The transport seam the draft stream flows through — the surface-local analogue of the shared
 * `io.teslasync.shared.core.net.sse.SseTransport`. An implementation opens one POST connection per [open] call
 * (web `useAiStream` POSTs the charge-plan JSON [body] with `Accept: text/event-stream`) and emits the response
 * body as raw UTF-8 text chunks; line boundaries need NOT align with chunk boundaries — [SseFrameAccumulator]
 * reassembles frames. The returned [Flow] completes when the server closes the stream, throws to signal a
 * transport failure, and is cancelled when the collector cancels. Production wires a Ktor reader against
 * `${api}/api/v1{path}`; tests inject a scripted fake.
 */
fun interface ScheduleDraftTransport {
    /** Opens a streaming connection for the draft [path] (no `/api/v1` prefix) with the JSON [body]. */
    fun open(
        path: String,
        body: String,
    ): Flow<String>
}

/**
 * Owns the smart-charge draft stream lifecycle for one set of charge-plan inputs — the native `useAiStream`
 * analogue. Exposes the cache-free [state] the composable renders and a [draft] action that builds the request
 * body via the pure model (with [clock] as the depart_by-normalization seam), opens the stream over [transport],
 * reassembles + parses frames, and folds them through [reduceSchedule]. Cancellation (on [cancel] or Compose
 * disposal) closes the connection and returns an in-flight stream to idle — the web hook's
 * AbortController-on-unmount contract.
 *
 * @param transport the injected SSE seam (production Ktor POST reader; test/preview scripted flow).
 * @param inputs the charge-plan inputs the page feeds the card (web `InnerSection` props); an absent vehicle /
 *   rate plan leaves [canStart] false (web `canStart = !!vehicleId && !!ratePlanId`).
 * @param online whether connectivity is available; offline leaves [canStart] false so the action never opens a
 *   doomed stream (the native offline affordance the P3 contract requires of an action surface).
 * @param scope the Compose-lifecycle scope the stream runs in (injected as the test scope off-device).
 * @param logger the sanctioned redacting logger for the PII-safe `view.opened` diagnostic.
 * @param clock the depart_by-normalization seam (web `new Date()`); injected as a fixed clock off-device.
 */
class SmartChargeScheduleDraftController(
    private val transport: ScheduleDraftTransport,
    private val inputs: SmartChargeInputs,
    private val online: Boolean,
    private val scope: CoroutineScope,
    private val logger: Logger,
    private val clock: Clock = Clock.systemDefaultZone(),
) {
    private val mutableState = MutableStateFlow(ScheduleDraftUiState.IDLE)

    /** The render-ready stream state (web `useAiStream` `{ state, text, error }` slice). */
    val state: StateFlow<ScheduleDraftUiState> = mutableState.asStateFlow()

    private var job: Job? = null
    private var viewOpenedRecorded = false

    /**
     * Whether the action can fire — a present vehicle, a present rate plan, and connectivity (web `canStart`
     * plus offline gating).
     */
    val canStart: Boolean get() = isScheduleReady(inputs, online)

    /** Emits the PII-safe `view.opened` diagnostic once per holder (idempotent across recompositions). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        SmartChargeScheduleDiagnostics.recordViewOpened(logger)
    }

    /**
     * Opens the draft stream — the web hook `start()`. A no-op while a stream is already in flight (web's
     * `runningRef` coalescing) or when [canStart] is false. Builds the request body once at start time (web's
     * `JSON.stringify(body)` snapshot), resets to a fresh streaming state, then accumulates `delta` text and
     * settles on `done`/`error`; a clean close with no terminal frame settles to done (web's `setState(cur =>
     * cur === 'streaming' ? 'done' : cur)`).
     */
    fun draft() {
        if (mutableState.value.isStreaming || !canStart) return
        val body = draftRequestBody(inputs, clock.instant(), clock.zone)
        cancel()
        mutableState.value = ScheduleDraftUiState(phase = SchedulePhase.Streaming)
        job = scope.launch { runStream(body) }
    }

    /**
     * Cancels an in-flight stream and returns it to idle — the web AbortController path (`cancel()` + the
     * unmount effect). A settled (done/error) state is left intact so the last proposal stays readable.
     */
    fun cancel() {
        job?.cancel()
        job = null
        mutableState.update { if (it.isStreaming) ScheduleDraftUiState.IDLE else it }
    }

    @Suppress("TooGenericExceptionCaught") // web parity: any transport failure becomes the terminal error state.
    private suspend fun runStream(body: String) {
        val accumulator = SseFrameAccumulator()
        try {
            transport.open(SCHEDULE_DRAFT_PATH, body).collect { chunk ->
                for (frame in accumulator.feed(chunk)) {
                    apply(parseSseFrame(frame))
                }
            }
            apply(accumulator.drain()?.let { parseSseFrame(it) })
            mutableState.update { if (it.isStreaming) it.copy(phase = SchedulePhase.Done) else it }
        } catch (cancellation: CancellationException) {
            mutableState.update { if (it.isStreaming) ScheduleDraftUiState.IDLE else it }
            throw cancellation
        } catch (failure: Exception) {
            mutableState.update { it.copy(phase = SchedulePhase.Failed, error = failure.message ?: UNKNOWN_ERROR) }
        }
    }

    private fun apply(event: AiStreamEvent?) {
        if (event == null) return
        mutableState.update { reduceSchedule(it, event) }
    }
}
