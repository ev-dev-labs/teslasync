// UI-thread-free state holder backing the AILearnedAnomalyBaselines shared surface — the native port of the web
// component's `withAiFeature` gate + `useAiStream({ url:'/ai/ml/anomaly-baselines/train',
// body:{vehicle_id,days} })` composition (web/src/components/ai/AILearnedAnomalyBaselines.tsx). It binds the AI
// gate + train stream (P1/S8) through [AILearnedAnomalyBaselinesSource], reduces each parsed SSE frame onto the
// immutable [AiBaselineState] surface (idle / streaming / done / failed, with last-known retained for the
// offline surface), and exposes the train + retry actions plus the PII-safe `view.opened` diagnostic. The
// view never performs HTTP — it only collects [state] and calls [setVehicle] / [setDays] / [generate] /
// [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailearnedanomalybaselines

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
 * @param source the AI-gate + train-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `train` events
 *   carrying only the non-PII surface slug (never a vehicle id or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic tests.
 */
class AILearnedAnomalyBaselinesViewModel(
    private val source: AILearnedAnomalyBaselinesSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(AiBaselineState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false
    private var days: Int = ANOMALY_BASELINE_DEFAULT_DAYS

    /**
     * The live surface state: the AI gate, the selected vehicle (web `canStart`), the stream phase, the
     * in-flight + last-committed narration text, the classified error, and the freshness stamp. The render
     * boundary classifies this into a [BaselineSurface]; every state renders a non-blank surface. The days
     * learning window is a request input held separately (see [setDays]), not part of the rendered state.
     */
    val state: StateFlow<AiBaselineState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('learned-per-vehicle-anomaly-baselines')`); `false`
        // collapses the surface.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the active vehicle (web InnerSection's `vehicleId` prop); `null` disables the train action. */
    fun setVehicle(vehicleId: Long?) {
        if (mutableState.value.vehicleId == vehicleId) return
        mutableState.update { it.copy(vehicleId = vehicleId) }
    }

    /**
     * Sets the learning window threaded into the train request (web's hardcoded `days: 14`, overridable here).
     * A non-positive value is normalized to [ANOMALY_BASELINE_DEFAULT_DAYS] (the web always sends a positive
     * window). It is a request input — not render state — so it is held here and threaded into the next
     * [generate]; the trainer caps it at [ANOMALY_BASELINE_MAX_DAYS] server-side.
     */
    fun setDays(days: Int) {
        this.days = normalizeDays(days)
    }

    /**
     * Opens a fresh train stream for the selected vehicle (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op without a selected vehicle or while a stream is already open (web `canStart` + the
     * hook's in-flight guard). A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val vehicleId = mutableState.value.vehicleId ?: return
        if (mutableState.value.isStreaming) return
        logger.info("aiLearnedAnomalyBaselines.train")
        streamJob?.cancel()
        val window = days
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .train(vehicleId, window)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id or generated text, so a diagnostics line can never leak fleet state. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AI_LEARNED_ANOMALY_BASELINES_SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AILearnedAnomalyBaselinesSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AILearnedAnomalyBaselinesViewModel(source, logger) }
            }
    }
}
