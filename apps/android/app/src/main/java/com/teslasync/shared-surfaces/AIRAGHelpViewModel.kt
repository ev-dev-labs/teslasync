// UI-thread-free state holder backing the AIRAGHelp shared surface — the native port of the web component's
// `withAiFeature('rag-help', …)` gate + `useAiStream({ url:'/ai/help/query', body:{ prompt } })` composition
// (web/src/components/ai/AIRAGHelp.tsx). It binds the AI gate + ask stream (P1/S8) through [AIRAGHelpSource],
// reduces each parsed SSE frame onto the immutable [AiRagHelpState] surface (idle / streaming / done / failed,
// with last-known retained for the offline surface), and exposes the prompt-input + ask + retry actions plus
// the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [setPrompt] / [ask] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.airaghelp

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
 * @param source the AI-gate + ask-stream seam (a shared-AI-layer adapter in production, a fake in tests). The
 *   view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `ask` events
 *   carrying only the non-PII surface slug (never the prompt text or any generated answer).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AIRAGHelpViewModel(
    private val source: AIRAGHelpSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiRagHelpState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the typed prompt (web `canStart`), the stream phase, the in-flight +
     * last-committed answer text, the classified error, and the freshness stamp. The render boundary classifies
     * this into a [HelpAnswerSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<AiRagHelpState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('rag-help')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Updates the typed prompt (web InnerSection's `setPrompt`); a blank prompt disables the ask action. */
    fun setPrompt(prompt: String) {
        if (mutableState.value.prompt == prompt) return
        mutableState.update { it.copy(prompt = prompt) }
    }

    /**
     * Opens a fresh help-query stream for the current prompt (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op with a blank prompt or while a stream is already open (web `canStart` + the hook's
     * in-flight guard). The prompt is captured at call time so a later [setPrompt] cannot mutate the in-flight
     * request (web pins `body` via useMemo). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun ask() {
        val current = mutableState.value
        if (!current.canStart || current.isStreaming) return
        val prompt = current.prompt
        logger.info("aiRagHelp.ask")
        streamJob?.cancel()
        mutableState.update { it.startAsking() }
        streamJob =
            stateScope.launch {
                source
                    .ask(prompt)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [ask]; backs the error/offline surfaces' retry affordance. */
    fun retry() = ask()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no prompt text or generated answer, so a diagnostics line can never leak the operator's question.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_RAG_HELP_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIRAGHelpSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIRAGHelpViewModel(source, logger) }
            }
    }
}
