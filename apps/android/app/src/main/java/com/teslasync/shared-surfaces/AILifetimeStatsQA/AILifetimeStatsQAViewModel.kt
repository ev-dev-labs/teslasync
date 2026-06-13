// UI-thread-free state holder backing the AILifetimeStatsQA shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/analytics/lifetime/qa',
// body:{vehicle_id,question} })` composition (web/src/components/ai/AILifetimeStatsQA.tsx). It binds the AI
// gate + answer stream (P1/S8) through [AILifetimeStatsQASource], reduces each parsed SSE frame onto the
// immutable [AiQaState] surface (idle / streaming / done / failed, with last-known retained for the offline
// surface), and exposes the question input, the ask + retry actions, and the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [setVehicle] / [setQuestion] /
// [ask] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailifetimestatsqa

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
 * @param source the AI-gate + answer-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `ask` events
 *   carrying only the non-PII surface slug (never a vehicle id, the question, or any generated answer).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AILifetimeStatsQAViewModel(
    private val source: AILifetimeStatsQASource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiQaState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the selected vehicle (web `haveVehicle`), the question input (web
     * `useState`), the stream phase, the in-flight + last-committed answer text, the classified error, and
     * the freshness stamp. The render boundary classifies this into a [QaSurface]; every state renders a
     * non-blank surface.
     */
    val state: StateFlow<AiQaState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('lifetime-stats-qa')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the active vehicle (web InnerSection's `vehicleId` prop); `null` disables the Ask action. */
    fun setVehicle(vehicleId: Long?) {
        if (mutableState.value.vehicleId == vehicleId) return
        mutableState.update { it.copy(vehicleId = vehicleId) }
    }

    /**
     * Records the user's question input, capped to [MAX_QUESTION_CHARS] (web Textarea `maxLength`). It is a
     * request input — re-running [ask] submits the latest trimmed value (web `body.question`).
     */
    fun setQuestion(question: String) {
        val capped = capQuestion(question)
        if (mutableState.value.question == capped) return
        mutableState.update { it.copy(question = capped) }
    }

    /**
     * Opens a fresh answer stream for the selected vehicle + question (web `stream.start()`), reducing each
     * parsed frame into [state]. A no-op without a selected vehicle, without a valid question, or while a
     * stream is already open (web `canStart` + the hook's in-flight guard). A thrown transport failure is
     * classified into the same [io.teslasync.android.data.ErrorKind] taxonomy as an explicit failure frame.
     */
    fun ask() {
        val current = mutableState.value
        // Web `canStart={haveVehicle && haveQuestion}` + the hook's in-flight guard, folded into one check.
        if (!current.canStart || current.isStreaming) return
        val vehicleId = current.vehicleId ?: return
        val question = current.trimmedQuestion
        logger.info("aiLifetimeStatsQA.ask")
        streamJob?.cancel()
        mutableState.update { it.startAsking() }
        streamJob =
            stateScope.launch {
                source
                    .ask(vehicleId, question)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [ask]; backs the error/offline surfaces' retry affordance. */
    fun retry() = ask()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, question, or answer text, so a diagnostics line can never leak fleet state. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_LIFETIME_STATS_QA_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AILifetimeStatsQASource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AILifetimeStatsQAViewModel(source, logger) }
            }
    }
}
