// UI-thread-free state holder backing the AINLDashboardComposer shared surface — the native port of the
// `useAiStream` composition the web component owns (web/src/components/ai/AINLDashboardComposer.tsx). It binds the
// [AiNlDashboardStreamSource] seam (P1/S8 — the native counterpart of `useAiStream`), folds the streamed
// `AiStreamEvent`s into a [StreamRuntime], projects that + the controlled prompt + connectivity onto the
// [AiNlDashboardSnapshot] render contract (loading / content / empty / error / stale / offline), exposes the
// per-feature AI-Off [gated] flag (web `withAiFeature`), and emits the PII-safe `view.opened` diagnostic. The
// view never performs HTTP — it only collects [snapshot]/[gated] and calls these methods.
//
// The AI panel NEVER writes editor state — a captured draft is applied in the parent /power/dashboards editor
// through the view's `onApply` callback, never here (the manual JSON composer stays the sole write path).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AINLDashboardComposer) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainldashboardcomposer

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
 * POST /ai/power/dashboard/draft. A production binding adapts the shared AI SSE transport (decoding frames via
 * [parseSseFrame]) and sends `{ prompt }` (web body parity); tests pass a lambda emitting a scripted
 * [AiStreamEvent] sequence. The view-model owns cancellation (on a new draft, or its own clearing), so an
 * implementation only needs to emit events and complete the flow.
 */
fun interface AiNlDashboardStreamSource {
    /** Opens one dashboard-draft stream for the trimmed natural-language [prompt]. */
    fun draft(prompt: String): Flow<AiStreamEvent>
}

/**
 * Lifecycle-aware state holder backing the Compose [AINLDashboardComposer] surface. It re-shares the derived
 * [snapshot] with `WhileSubscribed`, so the projection is computed only while the screen observes it (via
 * `collectAsStateWithLifecycle`). It owns no networking: [draftDashboard] launches a collection of the injected
 * [AiNlDashboardStreamSource] on the ViewModel scope and folds each event into the runtime; [cancel] tears the
 * in-flight stream down; [setPrompt] updates the controlled prompt; [retry] re-runs the stream behind the
 * error/offline affordance; and [recordViewOpened] emits the one-shot diagnostic.
 *
 * @param source the streaming seam (a shared-transport adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + draft/failure events.
 *   The user's prompt is NEVER logged — only PII-free lifecycle markers.
 * @param connectivity the live connectivity gate — `false` renders the offline surface and disables drafting.
 * @param featureEnabled the per-feature AI-Off gate (web `withAiFeature`); `false` makes the surface absent.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AINLDashboardComposerViewModel(
    private val source: AiNlDashboardStreamSource,
    logger: Logger,
    private val connectivity: StateFlow<Boolean> = MutableStateFlow(true),
    featureEnabled: StateFlow<Boolean> = MutableStateFlow(true),
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val prompt = MutableStateFlow("")
    private val runtime = MutableStateFlow(StreamRuntime())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /** The per-feature AI-Off gate — when `false` the composable renders nothing (web `withAiFeature` → null). */
    val gated: StateFlow<Boolean> = featureEnabled

    /**
     * The render-ready snapshot of the controlled prompt + stream lifecycle + connectivity, projected onto the
     * prompt's mandated state set. Cold until observed: collecting it computes the projection while the screen is
     * mounted.
     */
    val snapshot: StateFlow<AiNlDashboardSnapshot> =
        combine(prompt, runtime, connectivity) { text, rt, online ->
            projectAiNlDashboard(text, rt, online)
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = projectAiNlDashboard(prompt.value, runtime.value, connectivity.value),
        )

    /** Updates the controlled prompt the textarea binds to (web `setPrompt`); drives `canStart`. */
    fun setPrompt(text: String) {
        prompt.value = text
    }

    /**
     * Opens a dashboard-draft stream (web `handleDraft`): a double-submit while streaming/paused is a no-op, a
     * blank prompt or an offline connection is gated out, the prior draft/text/error are reset, and each event is
     * folded into the runtime. A flow that completes without a terminal frame promotes `streaming` → `done` so
     * the UI never sits spinning; a thrown failure becomes the error surface; cancellation returns to idle.
     */
    @Suppress("TooGenericExceptionCaught")
    fun draftDashboard() {
        val phase = runtime.value.phase
        if (phase == AiStreamPhase.Streaming || phase == AiStreamPhase.PausedConfirm) return
        val trimmed = prompt.value.trim()
        if (trimmed.isEmpty() || !connectivity.value) return
        logger.info("aiNlDashboard.draft")
        runtime.value = StreamRuntime(phase = AiStreamPhase.Streaming)
        streamJob?.cancel()
        streamJob =
            stateScope.launch {
                try {
                    source.draft(trimmed).collect { event -> reduce(event) }
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Done) else it }
                } catch (cancellation: CancellationException) {
                    runtime.update { if (it.phase == AiStreamPhase.Streaming) it.copy(phase = AiStreamPhase.Idle) else it }
                    throw cancellation
                } catch (error: Throwable) {
                    logger.warn("aiNlDashboard.streamFailed")
                    runtime.update {
                        it.copy(phase = AiStreamPhase.Error, errorMessage = error.message ?: STREAM_ERROR)
                    }
                }
            }
    }

    /** Retry behind the error / offline affordance — re-runs [draftDashboard] (which resets the prior state). */
    fun retry() = draftDashboard()

    /** Abort the in-flight stream (user dismiss / leaving the editor); returns a streaming state to idle. */
    fun cancel() = cancelStream()

    /** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once. */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAINLDashboardComposerViewOpened(logger)
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
            is AiStreamEvent.ToolResult ->
                extractDraft(event)?.let { draft -> runtime.update { state -> state.copy(draft = draft) } }
            is AiStreamEvent.ConfirmRequest ->
                runtime.update { it.copy(phase = AiStreamPhase.PausedConfirm) }
            is AiStreamEvent.Done ->
                runtime.update { it.copy(phase = AiStreamPhase.Done) }
            is AiStreamEvent.StreamError ->
                runtime.update {
                    it.copy(phase = AiStreamPhase.Error, errorMessage = event.message, limit = event.toLimitInfo())
                }
            is AiStreamEvent.ToolCall -> Unit
        }
    }

    companion object {
        private const val STREAM_ERROR = "stream_error"

        /** Builds a [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AiNlDashboardStreamSource,
            logger: Logger,
            connectivity: StateFlow<Boolean>,
            featureEnabled: StateFlow<Boolean>,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    AINLDashboardComposerViewModel(source, logger, connectivity, featureEnabled)
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
