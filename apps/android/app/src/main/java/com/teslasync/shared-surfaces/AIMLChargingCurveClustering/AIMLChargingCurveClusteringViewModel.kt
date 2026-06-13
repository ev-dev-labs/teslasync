// UI-thread-free state holder backing the AIMLChargingCurveClustering shared surface — the native port of
// the web component's `withAiFeature` gate + `useAiStream({ url:'/ai/ml/charging-curves/cluster',
// body:{ vehicle_id, lookback_days } })` composition
// (web/src/components/ai/AIMLChargingCurveClustering.tsx). It binds the AI gate + train stream (P1/S8)
// through [AIMLChargingCurveClusteringSource], reduces each parsed SSE frame onto the immutable
// [MlClusteringState] surface (idle / streaming / done / failed, with last-known retained for the offline
// surface), and exposes the train + retry actions plus the PII-safe `view.opened` diagnostic. The view
// never performs HTTP — it only collects [state] and calls [setVehicle] / [generate] / [retry] /
// [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIMLChargingCurveClustering) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aimlchargingcurveclustering

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
 * State holder backing the Compose [AIMLChargingCurveClustering] surface — the Android port of the web
 * component's `useAiStream` ownership.
 *
 * @param source the AI-gate + train-stream seam (a shared-AI-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only reduces this port's frames.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `train` events
 *   carrying only the non-PII surface slug (never a vehicle id or any generated text).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param clock wall-clock seam for completion stamps + the freshness check; injectable for deterministic
 *   tests.
 */
class AIMLChargingCurveClusteringViewModel(
    private val source: AIMLChargingCurveClusteringSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val clock: () -> Long = { System.currentTimeMillis() },
) : BaseFeedViewModel(logger, scope) {
    private val mutableState = MutableStateFlow(MlClusteringState())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The live surface state: the AI gate, the in-scope vehicle (web `canStart`), the stream phase, the
     * in-flight + last-committed narrative text, the classified error, and the freshness stamp. The render
     * boundary classifies this into a [ClusteringSurface]; every state renders a non-blank surface.
     */
    val state: StateFlow<MlClusteringState> = mutableState.asStateFlow()

    init {
        // Bind the AI-feature gate (web `useAiEnabled('ml-charging-curve-clustering')`); `false` collapses
        // the surface to nothing.
        launch { source.aiEnabled().collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
    }

    /** Sets the in-scope vehicle (web InnerSection's `vehicleId` prop); `null` disables the Train action. */
    fun setVehicle(vehicleId: Long?) {
        if (mutableState.value.vehicleId == vehicleId) return
        mutableState.update { it.copy(vehicleId = vehicleId) }
    }

    /**
     * Opens a fresh train stream for the in-scope vehicle (web `stream.start()`), reducing each parsed frame
     * into [state]. A no-op without a vehicle in scope or while a stream is already open (web `canStart` +
     * the hook's in-flight guard). The request always carries the 90-day [DEFAULT_LOOKBACK_DAYS] window the
     * web body sends. A thrown transport failure is classified into the same
     * [io.teslasync.android.data.ErrorKind] taxonomy as an explicit terminal failure frame.
     */
    fun generate() {
        val vehicleId = mutableState.value.vehicleId ?: return
        if (mutableState.value.isStreaming) return
        logger.info(EVENT_TRAIN, mapOf(FIELD_SLUG to AI_ML_CHARGING_CURVE_CLUSTERING_SLUG))
        streamJob?.cancel()
        mutableState.update { it.startGenerating() }
        streamJob =
            stateScope.launch {
                source
                    .cluster(vehicleId, DEFAULT_LOOKBACK_DAYS)
                    .catch { cause -> mutableState.update { it.markFailed(errorKindOf(cause)) } }
                    .collect { chunk -> mutableState.update { it.onChunk(chunk, clock()) } }
                mutableState.update { it.finishIfStreaming(clock()) }
            }
    }

    /** Retry after a failure — identical to [generate]; backs the error/offline surfaces' retry affordance. */
    fun retry() = generate()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no vehicle id or generated text, so a diagnostics line can never leak fleet state.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SLUG to AI_ML_CHARGING_CURVE_CLUSTERING_SLUG))
    }

    companion object {
        /** The P1/S11 surface-open diagnostic event. */
        const val EVENT_VIEW_OPENED = "view.opened"

        /** The PII-safe diagnostics event emitted when a train is fired (slug only, never the vehicle id). */
        const val EVENT_TRAIN = "aiMlChargingCurveClustering.train"

        /** The slug field key carried on both diagnostics events. */
        const val FIELD_SLUG = "slug"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AIMLChargingCurveClusteringSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIMLChargingCurveClusteringViewModel(source, logger) }
            }
    }
}
