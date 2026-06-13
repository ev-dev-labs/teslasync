// UI-thread-free state holder backing the AIPreheatPrecoolRecommender shared surface — the native port of the
// web component's `withAiFeature` gate + `useAiStream({ url:'/ai/climate/schedule/draft', body:{…} })`
// composition (web/src/components/ai/AIPreheatPrecoolRecommender.tsx). It binds the AI gate + draft stream
// (P1/S8) through [AIPreheatPrecoolRecommenderSource], reduces each parsed SSE frame onto the immutable
// [PreheatDraftState] surface (idle / streaming / done / failed, with last-known retained for the offline
// surface), projects the resolved host inputs onto the deterministic request body, and exposes the
// draft + retry actions plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [state] and calls [setInputs] / [generate] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aipreheatprecoolrecommender

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
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `generate` events
 *   carrying only the non-PII surface slug (never a vehicle id, timestamp, temperature, or generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic
 *   tests.
 */
class AIPreheatPrecoolRecommenderViewModel(
    private val source: AIPreheatPrecoolRecommenderSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(PreheatDraftState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the resolved host inputs (web `canStart`), the stream phase, the
     * in-flight + last-committed draft text, the classified error, and the freshness stamp. The render
     * boundary classifies this into a [DraftSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<PreheatDraftState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('preheat-precool-recommender')`); `false` collapses it.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Sets the resolved host inputs (web InnerSection's props); incomplete inputs disable the Draft action.
     * A no-op when the inputs are unchanged so an unstable parent recomposition cannot churn state.
     */
    fun setInputs(inputs: PreheatDraftInputs) {
        if (mutableState.value.inputs == inputs) return
        mutableState.update { it.copy(inputs = inputs) }
    }

    /**
     * Opens a fresh draft stream for the resolved inputs (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op when the inputs are incomplete or while a stream is already open (web `canStart` +
     * the hook's in-flight guard). The request body is the deterministic projection of the current inputs
     * (web `useMemo` body). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val current = mutableState.value
        if (!current.inputs.canStart) return
        if (current.isStreaming) return
        logger.info("aiPreheatPrecoolRecommender.generate")
        val body = current.inputs.toRequestBody()
        streamJob?.cancel()
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .draft(body)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, timestamp, temperature, or generated text, so a diagnostics line can never leak
     * fleet state. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_PREHEAT_PRECOOL_RECOMMENDER_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIPreheatPrecoolRecommenderSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIPreheatPrecoolRecommenderViewModel(source, logger) }
            }
    }
}
