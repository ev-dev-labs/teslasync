// UI-thread-free state holder backing the AIFeedbackQueueTriage shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/feedback/triage/draft', body:{ feedback_id } })`
// composition (web/src/components/ai/AIFeedbackQueueTriage.tsx). It binds the AI gate + draft stream (P1/S8)
// through [AIFeedbackQueueTriageSource], reduces each parsed SSE frame onto the immutable [AiTriageState]
// surface (idle / streaming / done / failed, with last-known retained for the offline surface), and exposes
// the suggest + retry actions plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it
// only collects [state] and calls [setFeedback] / [suggest] / [retry] / [onViewOpened].
//
// Propose-only (web safety contract): this holder NEVER persists a proposal. The captured draft is rendered for
// the operator, whose deterministic manual triage controls (useUpdateFeedback) on the parent FeedbackQueuePage
// remain the sole write path. No mutation is reachable from here.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aifeedbackqueuetriage

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.errorKindOf
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * @param source the AI-gate + draft-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `suggest` events
 *   carrying only the non-PII surface slug (never a feedback id or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AIFeedbackQueueTriageViewModel(
    private val source: AIFeedbackQueueTriageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiTriageState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the selected feedback row (web `canStart`), the stream phase, the
     * in-flight + last-committed proposal text, the classified error, and the freshness stamp. The render
     * boundary classifies this into a [TriageSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<AiTriageState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('feedback-queue-triage')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Sets the active feedback row (web InnerSection's `feedbackId` prop); `null` or a non-positive id disables
     * Suggest. Mirrors the web's per-row component instance — each expanded row mounts its own holder with that
     * row's id.
     */
    fun setFeedback(feedbackId: Long?) {
        if (mutableState.value.feedbackId == feedbackId) return
        mutableState.update { it.copy(feedbackId = feedbackId) }
    }

    /**
     * Opens a fresh draft stream for the selected row (web `stream.start()`), reducing each parsed frame into
     * [state]. A no-op without a finite, positive feedback id or while a stream is already open (web `canStart`
     * — `haveFeedback` — plus the hook's in-flight guard). A thrown transport failure is classified into the
     * same [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun suggest() {
        val feedbackId = mutableState.value.feedbackId
        if (feedbackId == null || feedbackId <= 0L) return
        if (mutableState.value.isStreaming) return
        logger.info("aiFeedbackTriage.suggest")
        streamJob?.cancel()
        mutableState.update { it.startDrafting() }
        streamJob =
            stateScope.launch {
                source
                    .draftTriage(feedbackId)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [suggest]; backs the error/offline surfaces' retry affordance. */
    fun retry() = suggest()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no feedback id or generated text, so a diagnostics line can never leak the operator's queue. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_FEEDBACK_QUEUE_TRIAGE_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIFeedbackQueueTriageSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIFeedbackQueueTriageViewModel(source, logger) }
            }
    }
}
