// UI-thread-free state holder backing the AINLGrafanaPanel shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/power/grafana-panel/draft', body:{ prompt } })`
// composition (web/src/components/ai/AINLGrafanaPanel.tsx). It binds the AI gate + draft stream (P1/S8) through
// [AINLGrafanaPanelSource], reduces each parsed SSE frame onto the immutable [GrafanaDraftState] surface
// (idle / streaming / done / failed, with a draft captured from the `draft_grafana_panel` tool result), and
// exposes the prompt + draft + retry actions plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [setPrompt] / [draft] / [retry] / [onViewOpened]; applying
// a draft to the editor is the host's responsibility via the composable's `onApply` callback (the LLM never
// mutates editor state, exactly as the web contract requires).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlgrafanapanel

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
 *   carrying only the non-PII surface slug (never the prompt text or any generated content).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AINLGrafanaPanelViewModel(
    private val source: AINLGrafanaPanelSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(GrafanaDraftState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the natural-language prompt (web `canDraft`), the stream phase, the
     * in-flight prose, the captured draft, the classified error, and the freshness stamp. The render boundary
     * classifies this into a [DraftSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<GrafanaDraftState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('nl-grafana-panel')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Updates the natural-language request as the user types (web InnerSection's `setPrompt`). */
    fun setPrompt(prompt: String) {
        if (mutableState.value.prompt == prompt) return
        mutableState.update { it.copy(prompt = prompt) }
    }

    /**
     * Opens a fresh draft stream for the current prompt (web `handleDraft` -> `setDraft(null)` + `stream.start()`),
     * reducing each parsed frame into [state]. A no-op without a non-blank prompt or while a stream is already
     * open (web `canDraft` + the hook's in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame. The prompt text is
     * never logged.
     */
    fun draft() {
        val current = mutableState.value
        if (!current.canDraft) return
        logger.info("aiNlGrafanaPanel.draft")
        streamJob?.cancel()
        val request = current.trimmedPrompt
        mutableState.update { it.startDrafting() }
        streamJob =
            stateScope.launch {
                source
                    .draft(request)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [draft]; backs the error/offline surfaces' retry affordance. */
    fun retry() = draft()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no prompt text or generated content, so a diagnostics line can never leak the operator's fleet
     * state or model output. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_NL_GRAFANA_PANEL_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AINLGrafanaPanelSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AINLGrafanaPanelViewModel(source, logger) }
            }
    }
}
