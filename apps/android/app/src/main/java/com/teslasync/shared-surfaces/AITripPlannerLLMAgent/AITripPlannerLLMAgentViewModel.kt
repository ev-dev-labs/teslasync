// UI-thread-free state holder backing the AITripPlannerLLMAgent shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/trips/plan/draft', body })` composition
// (web/src/components/ai/AITripPlannerLLMAgent.tsx). It binds the AI gate + draft stream (P1/S8) through
// [AITripPlannerLLMAgentSource], reduces each parsed SSE frame onto the immutable [TripPlanState] surface
// (idle / streaming / done / failed, with last-known retained for the offline surface), and exposes the draft +
// retry actions plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects
// [state] and calls [setInputs] / [generate] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AITripPlannerLLMAgent) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aitripplannerllmagent

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
 * @param source the AI-gate + draft-stream seam (a shared-AI-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `draft` events
 *   carrying only the non-PII surface slug (never a vehicle id, coordinates, or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AITripPlannerLLMAgentViewModel(
    private val source: AITripPlannerLLMAgentSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(TripPlanState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the planning inputs (web `canStart`), the stream phase, the
     * in-flight + last-committed draft text, the classified error, and the freshness stamp. The render boundary
     * classifies this into a [TripPlanSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<TripPlanState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('trip-planner-llm-agent')`); `false` collapses the
        // surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Sets the active planning inputs (web InnerSection's props); incomplete inputs (missing vehicle/origin/
     * destination) disable the draft action. A no-op when the inputs are unchanged so re-supplying identical
     * props mid-stream does not churn state.
     */
    fun setInputs(inputs: TripPlanInputs) {
        if (mutableState.value.inputs == inputs) return
        mutableState.update { it.copy(inputs = inputs) }
    }

    /**
     * Opens a fresh draft stream for the current inputs (web `stream.start()`), reducing each parsed frame into
     * [state]. A no-op without complete inputs or while a stream is already open (web `canStart` + the hook's
     * in-flight guard). The request body is snapshotted at call time via [TripPlanInputs.toDraftRequest] so a
     * later prop change does not mutate the in-flight draft. A thrown transport failure is classified into the
     * same [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val current = mutableState.value
        if (!current.canStart) return
        if (current.isStreaming) return
        logger.info("aiTripPlannerLLMAgent.draft")
        val request = current.inputs.toDraftRequest()
        streamJob?.cancel()
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .draftPlan(request)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, coordinates, or generated text, so a diagnostics line can never leak fleet state.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_TRIP_PLANNER_LLM_AGENT_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AITripPlannerLLMAgentSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AITripPlannerLLMAgentViewModel(source, logger) }
            }
    }
}
