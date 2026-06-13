// UI-thread-free state holder backing the AINLAlertBuilder shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/alerts/rules/draft', body:{vehicle_id,prompt} })`
// composition (web/src/components/ai/AINLAlertBuilder.tsx). It binds the AI gate + draft stream (P1/S8)
// through [AINLAlertBuilderSource], reduces each parsed SSE frame onto the immutable [AiAlertDraftState]
// surface (idle / streaming / done / failed, with last-known retained for the offline surface), and exposes
// the prompt, draft, and retry actions plus the PII-safe `view.opened` diagnostic. The view never performs
// HTTP — it only collects [state] and calls [setVehicle] / [setPrompt] / [generate] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ainlalertbuilder

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
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `draft` events
 *   carrying only the non-PII surface slug (never a vehicle id, the prompt, or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AINLAlertBuilderViewModel(
    private val source: AINLAlertBuilderSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiAlertDraftState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the selected vehicle + live prompt (web `canStart`), the stream
     * phase, the in-flight + last-committed draft text, the classified error, and the freshness stamp. The
     * render boundary classifies this into a [DraftSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<AiAlertDraftState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('nl-alert-builder')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the active vehicle (web InnerSection's `vehicleId` prop); `null` disables the Draft action. */
    fun setVehicle(vehicleId: Long?) {
        if (mutableState.value.vehicleId == vehicleId) return
        mutableState.update { it.copy(vehicleId = vehicleId) }
    }

    /**
     * Binds the live free-text prompt from the input slot (web `setPrompt`). A non-blank prompt (with a
     * selected vehicle) is what enables the Draft action via [AiAlertDraftState.canStart].
     */
    fun setPrompt(prompt: String) {
        if (mutableState.value.prompt == prompt) return
        mutableState.update { it.withPrompt(prompt) }
    }

    /**
     * Opens a fresh draft stream from the current prompt (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op unless a vehicle is selected AND the prompt is non-blank (web `canStart`), or while
     * a stream is already open (the hook's in-flight guard). A thrown transport failure is classified into the
     * same [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val current = mutableState.value
        if (!current.canStart || current.isStreaming) return
        val vehicleId = current.vehicleId ?: return
        val prompt = current.prompt
        logger.info("aiNLAlertBuilder.draft")
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

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, prompt, or generated text, so a diagnostics line can never leak fleet state. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_NL_ALERT_BUILDER_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AINLAlertBuilderSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AINLAlertBuilderViewModel(source, logger) }
            }
    }
}
