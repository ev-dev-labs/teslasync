// UI-thread-free state holder backing the AILogTraceSummarization shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/system/logs/summarize',
// body:{from_unix,to_unix,vehicle_id?} })` composition (web/src/components/ai/AILogTraceSummarization.tsx). It
// binds the AI gate + summarize stream (P1/S8) through [AILogTraceSummarizationSource], reduces each parsed SSE
// frame onto the immutable [AiSummaryState] surface (idle / streaming / done / failed, with last-known retained
// for the offline surface), and exposes the summarize + retry actions plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls [setWindow] / [setVehicle] /
// [generate] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailogtracesummarization

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
 * @param source the AI-gate + summarize-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `generate` events
 *   carrying only the non-PII surface slug (never a vehicle id, a window, or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AILogTraceSummarizationViewModel(
    private val source: AILogTraceSummarizationSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiSummaryState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false
    private var vehicleId: Long? = null

    /**
     * The live surface state: the AI gate, the log/trace window (web `canStart`), the stream phase, the
     * in-flight + last-committed summary text, the classified error, and the freshness stamp. The render
     * boundary classifies this into a [SummarySurface]; every state renders a non-blank surface. The optional
     * vehicle narrowing is a request input held separately (see [setVehicle]), not part of the rendered state.
     */
    val state: StateFlow<AiSummaryState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('log-trace-summarization')`); `false` collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /**
     * Sets the log/trace window (web InnerSection's `fromUnix`/`toUnix` props, Unix seconds). The window drives
     * [AiSummaryState.canStart] via [windowAcceptable]; an absent, non-positive, inverted, or over-24h window
     * leaves the Summarize action disabled.
     */
    fun setWindow(
        fromUnix: Long?,
        toUnix: Long?,
    ) {
        if (mutableState.value.fromUnix == fromUnix && mutableState.value.toUnix == toUnix) return
        mutableState.update { it.copy(fromUnix = fromUnix, toUnix = toUnix) }
    }

    /**
     * Sets the optional vehicle narrowing (web InnerSection's `vehicleId` prop). A non-positive or absent value
     * is normalized to `null` (web's `vehicleId > 0` guard) so the request omits `vehicle_id` and the backend
     * treats it as "all vehicles". It is a request input — not render state — so it is held here and threaded
     * into the next [generate].
     */
    fun setVehicle(vehicleId: Long?) {
        this.vehicleId = normalizeVehicleId(vehicleId)
    }

    /**
     * Opens a fresh summarize stream for the current window (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op without an acceptable window or while a stream is already open (web `canStart` + the
     * hook's in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val current = mutableState.value
        if (current.isStreaming) return
        val (fromUnix, toUnix) = current.acceptableWindow() ?: return
        logger.info("aiLogTraceSummarization.generate")
        streamJob?.cancel()
        val vehicle = vehicleId
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .summarize(fromUnix, toUnix, vehicle)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, window, or generated text, so a diagnostics line can never leak fleet state. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_LOG_TRACE_SUMMARIZATION_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AILogTraceSummarizationSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AILogTraceSummarizationViewModel(source, logger) }
            }
    }
}
