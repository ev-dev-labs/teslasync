// UI-thread-free state holder backing the AIFeatureCard shared surface — the native port of the `useAiStream`
// composition the web scaffold consumes (web/src/components/ai/AIFeatureCard.tsx reads an `AIFeatureStream`
// produced by web/src/hooks/useAiStream.ts). It binds the [AiFeatureCardStreamSource] seam (P1/S8 — the native
// counterpart of `useAiStream`), folds the streamed [AiStreamEvent]s into an [AiFeatureStream], projects that +
// the feature's `canStart` + connectivity onto the [AiFeatureCardSnapshot] render contract
// (hidden / thinking / content / error / stale / offline), exposes the host-supplied AI-Off [gated] flag (web
// `withAiFeature` at the call site), and emits the PII-safe `view.opened` diagnostic. The view never performs
// HTTP — it only collects [snapshot]/[gated] and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIFeatureCard) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aifeaturecard

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * One event from the AI SSE stream the card observes — the narrow native mirror of the frames web `useAiStream`
 * folds into its `state`/`text`. A production [AiFeatureCardStreamSource] decodes the shared AI SSE transport
 * into these; tests emit a scripted sequence. [Delta] accumulates text, [ConfirmRequest] pauses for a tool
 * confirmation (web `paused-confirm`), [Done] closes cleanly, and [StreamError] is a terminal in-band failure.
 */
sealed interface AiStreamEvent {
    /** An accumulated `delta.text` chunk (web `delta` frame). */
    data class Delta(
        val text: String,
    ) : AiStreamEvent

    /** A tool wants confirmation before continuing — the stream pauses (web `confirm_request` → `paused-confirm`). */
    data class ConfirmRequest(
        val summary: String,
    ) : AiStreamEvent

    /** The stream finished cleanly (web `done` frame). */
    data object Done : AiStreamEvent

    /** A terminal in-band error frame (web `error` frame → `state==='error'`). */
    data class StreamError(
        val message: String,
    ) : AiStreamEvent
}

/**
 * The streaming seam this surface binds — the native counterpart of the web `useAiStream` hook. A production
 * binding adapts the shared AI SSE transport (decoding frames into [AiStreamEvent]s); tests pass a lambda
 * emitting a scripted sequence. The view-model owns cancellation, so an implementation only needs to emit events
 * and complete the flow.
 */
fun interface AiFeatureCardStreamSource {
    /** Opens one AI stream; each collected [AiStreamEvent] is folded into the card's [AiFeatureStream]. */
    fun open(): Flow<AiStreamEvent>
}

/**
 * Lifecycle-aware state holder backing the Compose [AIFeatureCard] surface. It re-shares the derived [snapshot]
 * with `WhileSubscribed`, so the projection is computed only while the screen observes it (via
 * `collectAsStateWithLifecycle`). It owns no networking: [start] launches a collection of the injected
 * [AiFeatureCardStreamSource] on the ViewModel scope and folds each event into the runtime; [cancel] tears the
 * in-flight stream down; [retry] re-runs it behind the error/offline affordance; and [recordViewOpened] emits
 * the one-shot diagnostic.
 *
 * @param source the streaming seam (a shared-transport adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + start/failure events.
 * @param canStartFlow whether the feature has the inputs it needs to fire (web `canStart` prop); gates [start].
 * @param connectivity the live connectivity gate — `false` renders the offline surface and disables [start].
 * @param featureEnabled the per-feature AI-Off gate (web `withAiFeature`); `false` makes the surface absent.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AIFeatureCardViewModel(
    private val source: AiFeatureCardStreamSource,
    logger: Logger,
    private val canStartFlow: StateFlow<Boolean> = MutableStateFlow(true),
    private val connectivity: StateFlow<Boolean> = MutableStateFlow(true),
    featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val runtime = MutableStateFlow(AiFeatureStream())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /** The per-feature AI-Off gate — when `false` the composable renders nothing (web `withAiFeature` → null). */
    val gated: StateFlow<Boolean> = featureEnabled

    /**
     * The render-ready snapshot of the stream lifecycle + `canStart` + connectivity, projected onto the prompt's
     * mandated state set. Cold until observed: collecting it computes the projection while the screen is mounted.
     */
    val snapshot: StateFlow<AiFeatureCardSnapshot> =
        combine(runtime, canStartFlow, connectivity) { stream, canStart, online ->
            projectAiFeatureCard(stream, canStart, online)
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = projectAiFeatureCard(runtime.value, canStartFlow.value, connectivity.value),
        )

    /**
     * Opens an AI stream (web `stream.start`): a double-submit while streaming is a no-op (web `runningRef`
     * coalescing); a feature without its inputs or an offline connection is gated out; the prior text/error are
     * reset; and each event is folded into the runtime. A flow that completes without a terminal frame promotes
     * `streaming` → `done` so the UI never sits spinning; a thrown failure becomes the error surface;
     * cancellation returns to idle.
     */
    @Suppress("TooGenericExceptionCaught")
    fun start() {
        if (runtime.value.phase == AiStreamPhase.Streaming) return
        if (!canStartFlow.value || !connectivity.value) return
        logger.info("aiFeatureCard.start")
        runtime.value = AiFeatureStream(phase = AiStreamPhase.Streaming)
        streamJob?.cancel()
        streamJob =
            stateScope.launch {
                try {
                    source.open().collect { event -> reduce(event) }
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Done) else it }
                } catch (cancellation: CancellationException) {
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
                    throw cancellation
                } catch (error: Throwable) {
                    logger.warn("aiFeatureCard.streamFailed")
                    runtime.update {
                        it.copy(phase = AiStreamPhase.Error, error = it.error ?: error.message ?: STREAM_ERROR)
                    }
                }
            }
    }

    /** Retry behind the error / offline affordance — re-runs [start] (which resets the prior state first). */
    fun retry() = start()

    /** Abort the in-flight stream (user dismiss / leaving the screen); returns a streaming state to idle. */
    fun cancel() = cancelStream()

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAIFeatureCardViewOpened(logger)
    }

    private fun cancelStream() {
        streamJob?.cancel()
        streamJob = null
        runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
    }

    private fun reduce(event: AiStreamEvent) {
        when (event) {
            is AiStreamEvent.Delta ->
                runtime.update { it.copy(text = it.text + event.text) }
            is AiStreamEvent.ConfirmRequest ->
                runtime.update { it.copy(phase = AiStreamPhase.PausedConfirm) }
            is AiStreamEvent.Done ->
                runtime.update { it.copy(phase = AiStreamPhase.Done) }
            is AiStreamEvent.StreamError ->
                runtime.update { it.copy(phase = AiStreamPhase.Error, error = event.message) }
        }
    }

    companion object {
        private const val STREAM_ERROR = "stream_error"

        /** Builds a [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AiFeatureCardStreamSource,
            logger: Logger,
            canStartFlow: StateFlow<Boolean>,
            connectivity: StateFlow<Boolean>,
            featureEnabled: StateFlow<Boolean>,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    AIFeatureCardViewModel(source, logger, canStartFlow, connectivity, featureEnabled)
                }
            }
    }
}
