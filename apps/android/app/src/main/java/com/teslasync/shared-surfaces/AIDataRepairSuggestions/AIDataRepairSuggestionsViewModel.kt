// UI-thread-free state holder backing the AIDataRepairSuggestions shared surface — the native port of the
// `useAiStream` composition the web component owns (web/src/components/ai/AIDataRepairSuggestions.tsx). It binds
// the [AiDraftStreamSource] seam (P1/S8 — the native counterpart of `useAiStream`), folds the streamed
// `AiStreamEvent`s into a [StreamRuntime], projects that onto the [AiDataRepairSnapshot] render contract
// (loading / content / empty / error / stale / offline), exposes the per-feature AI-Off [gated] flag (web
// `withAiFeature`), and emits the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [snapshot]/[gated] and calls these methods.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIDataRepairSuggestions) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aidatarepairsuggestions

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
 * The streaming seam this surface binds — the native counterpart of the web `useAiStream` hook against
 * POST /ai/system/data-repair/draft. A production binding adapts the shared AI SSE transport (decoding frames via
 * [parseSseFrame]); tests pass a lambda emitting a scripted [AiStreamEvent] sequence. There is no per-request
 * input (web's body is an empty object — the backend reads the stale-session inventory itself), so the seam takes
 * no arguments. The view-model owns cancellation (on a new draft, a dismiss, or its own clearing), so an
 * implementation only needs to emit events and complete the flow.
 */
fun interface AiDraftStreamSource {
    /** Opens one draft-repair-plan stream — the backend scopes it to the in-flight stale-session inventory. */
    fun draftPlan(): Flow<AiStreamEvent>
}

/**
 * Lifecycle-aware state holder backing the Compose [AIDataRepairSuggestions] surface. It re-shares the derived
 * [snapshot] with `WhileSubscribed`, so the projection is computed only while the screen observes it (via
 * `collectAsStateWithLifecycle`). It owns no networking: [draft] launches a collection of the injected
 * [AiDraftStreamSource] on the ViewModel scope and folds each event into the runtime; [cancel] tears the
 * in-flight stream down; [retry] re-runs the stream behind the error/offline affordance; and [recordViewOpened]
 * emits the one-shot diagnostic.
 *
 * The AI panel NEVER persists — the descriptive repair plan is propose-only; the user applies it via the
 * canonical Save / Close / Discard buttons on the baseline DataRepairPage form (ADR-015 §I3/§I8).
 *
 * @param source the streaming seam (a shared-transport adapter in production, a scripted source in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + draft/failure events.
 * @param connectivity the live connectivity gate — `false` renders the offline surface and disables draft.
 * @param featureEnabled the per-feature AI-Off gate (web `withAiFeature`); `false` makes the surface absent.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AIDataRepairSuggestionsViewModel(
    private val source: AiDraftStreamSource,
    logger: Logger,
    private val connectivity: StateFlow<Boolean> = MutableStateFlow(true),
    private val featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val runtime = MutableStateFlow(StreamRuntime())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /** The per-feature AI-Off gate — when `false` the composable renders nothing (web `withAiFeature` → null). */
    val gated: StateFlow<Boolean> = featureEnabled

    /**
     * The render-ready snapshot of the stream lifecycle + connectivity, projected onto the prompt's mandated
     * state set. Cold until observed: collecting it computes the projection while the screen is mounted.
     */
    val snapshot: StateFlow<AiDataRepairSnapshot> =
        combine(runtime, connectivity) { rt, online -> projectAiDataRepair(rt, online) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = projectAiDataRepair(runtime.value, connectivity.value),
            )

    /**
     * Opens a draft-repair-plan stream (web `handleDraft` via the AIFeatureCard button). A double-submit while a
     * stream is in flight is a no-op (web's hook coalesces); an offline connection is gated out; the prior
     * in-flight text/error are reset while the last completed plan is RETAINED for the stale/offline surfaces;
     * and each event is folded into the runtime. A flow that completes without a terminal frame promotes
     * `streaming` → `done` so the UI never sits spinning; a thrown failure becomes the error surface;
     * cancellation returns to idle.
     */
    @Suppress("TooGenericExceptionCaught")
    fun draft() {
        val phase = runtime.value.phase
        if (phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm) return
        if (!connectivity.value) return
        logger.info("aiDataRepair.draft", emptyMap())
        runtime.update { it.copy(phase = AiStreamPhase.Streaming, streamedText = "", errorMessage = null, limit = null) }
        streamJob?.cancel()
        streamJob =
            stateScope.launch {
                try {
                    source.draftPlan().collect { event -> reduce(event) }
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) commitDone(it) else it }
                } catch (cancellation: CancellationException) {
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
                    throw cancellation
                } catch (error: Throwable) {
                    logger.warn("aiDataRepair.streamFailed", emptyMap())
                    runtime.update {
                        it.copy(phase = AiStreamPhase.Error, errorMessage = error.message ?: STREAM_ERROR)
                    }
                }
            }
    }

    /** Retry behind the error / offline affordance — re-runs [draft] (which resets the in-flight state first). */
    fun retry() = draft()

    /** Abort the in-flight stream (user dismiss / leaving the page); returns a streaming state to idle. */
    fun cancel() = cancelStream()

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAIDataRepairViewOpened(logger)
    }

    private fun cancelStream() {
        streamJob?.cancel()
        streamJob = null
        runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
    }

    private fun reduce(event: AiStreamEvent) {
        when (event) {
            is AiStreamEvent.Delta ->
                runtime.update { it.copy(streamedText = it.streamedText + event.text) }
            is AiStreamEvent.ConfirmRequest ->
                runtime.update { it.copy(phase = AiStreamPhase.PausedConfirm) }
            is AiStreamEvent.Done ->
                runtime.update { commitDone(it) }
            is AiStreamEvent.StreamError ->
                runtime.update {
                    it.copy(phase = AiStreamPhase.Error, errorMessage = event.message, limit = event.toLimitInfo())
                }
            is AiStreamEvent.ToolCall, is AiStreamEvent.ToolResult -> Unit
        }
    }

    companion object {
        private const val STREAM_ERROR = "stream_error"

        /**
         * Commits a finished stream: marks it [AiStreamPhase.Done] and promotes the accumulated in-flight text to
         * the last-known [StreamRuntime.lastPlan] (keeping the prior plan if the draft produced no text), so the
         * stale/offline surfaces always have a plan to keep visible.
         */
        private fun commitDone(state: StreamRuntime): StreamRuntime =
            state.copy(phase = AiStreamPhase.Done, lastPlan = state.streamedText.ifBlank { state.lastPlan })

        /** Builds a [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AiDraftStreamSource,
            logger: Logger,
            connectivity: StateFlow<Boolean>,
            featureEnabled: StateFlow<Boolean>,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    AIDataRepairSuggestionsViewModel(source, logger, connectivity, featureEnabled)
                }
            }
    }
}

/** Lifts a terminal [AiStreamEvent.StreamError] onto the structured [AiLimitInfo] (only when it carried a reason). */
private fun AiStreamEvent.StreamError.toLimitInfo(): AiLimitInfo? =
    reason?.let {
        AiLimitInfo(
            reason = it,
            retryAfterS = retryAfterS ?: 0,
            bannerLevel = bannerLevel ?: "",
            baselineAvailable = baselineAvailable,
        )
    }
