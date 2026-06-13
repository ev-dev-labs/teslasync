// UI-thread-free state holder backing the AISignalExplorerNlFilter shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/signals/filter/draft', body:{ vehicle_id, prompt } })`
// composition (web/src/components/ai/AISignalExplorerNlFilter.tsx). It binds the AI gate + draft stream (P1/S8)
// through [AISignalExplorerNlFilterSource], reduces each parsed SSE frame onto the immutable [AiFilterDraftState]
// surface (idle / streaming / done / failed, with last-known retained for the offline surface and the typed draft
// captured for the Apply affordance), and exposes the vehicle + prompt + draft + retry + apply-relay actions plus
// the PII-safe `view.opened` diagnostic. The view never performs HTTP and the LLM never writes filter state — it
// only collects [state] and calls [setVehicle] / [setPrompt] / [draft] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisignalexplorernlfilter

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
 *   carrying only the non-PII surface slug (never the vehicle id, the prompt text, or any generated draft).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AISignalExplorerNlFilterViewModel(
    private val source: AISignalExplorerNlFilterSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiFilterDraftState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the active vehicle + free-text prompt (web `canStart`), the stream
     * phase, the in-flight + last-committed draft text, the captured typed draft (web `draft` -> the Apply
     * affordance), the classified error, and the freshness stamp. The render boundary classifies this into a
     * [FilterDraftSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<AiFilterDraftState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('signal-explorer-nl-filter')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the active vehicle (web InnerSection's `vehicleId` prop); a zero/null id disables the Draft action. */
    fun setVehicle(vehicleId: Long?) {
        if (mutableState.value.vehicleId == vehicleId) return
        mutableState.update { it.withVehicle(vehicleId) }
    }

    /** Sets the free-text prompt (web `setPrompt`); drives `canStart` and is sent (trimmed) as the draft body. */
    fun setPrompt(text: String) {
        if (mutableState.value.prompt == text) return
        mutableState.update { it.withPrompt(text) }
    }

    /**
     * Opens a fresh draft stream for the active vehicle + trimmed prompt (web `handleDraft` -> `stream.start()`),
     * reducing each parsed frame into [state]. A no-op without a selected vehicle AND a non-empty prompt, or while
     * a stream is already open (web `canDraft = !isStreaming && hasPrompt && hasVehicle`). The prior captured
     * draft is cleared first (web `setDraft(null)`). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun draft() {
        val current = mutableState.value
        if (!current.canStart || current.isStreaming) return
        val vehicleId = current.vehicleId ?: return
        val prompt = current.trimmedPrompt
        logger.info("aiSignalExplorerNlFilter.draft")
        streamJob?.cancel()
        mutableState.update { it.startDrafting() }
        streamJob =
            stateScope.launch {
                source
                    .draft(vehicleId, prompt)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [draft]; backs the error/offline surfaces' retry affordance. */
    fun retry() = draft()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, prompt text, or generated draft, so a diagnostics line can never leak fleet state.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_SIGNAL_EXPLORER_NL_FILTER_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AISignalExplorerNlFilterSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AISignalExplorerNlFilterViewModel(source, logger) }
            }
    }
}
