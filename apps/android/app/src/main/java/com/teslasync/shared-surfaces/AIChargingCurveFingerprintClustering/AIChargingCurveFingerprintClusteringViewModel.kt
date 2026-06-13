// UI-thread-free state holder backing the AIChargingCurveFingerprintClustering shared surface — the native
// port of the web `useAiStream` ownership the surface's InnerSection has
// (web/src/components/ai/AIChargingCurveFingerprintClustering.tsx). It binds the [AiExplainStream] seam
// (P1/S8) and the app-scoped [SelectedVehicleStore], folds the stream's typed frames into the projected
// [ClusteringSurfaceState] (phase / accumulated narrative / error / canStart) for the surface to render,
// exposes [explain] (the web Explain button's `stream.start`), and emits the PII-safe one-shot
// `view.opened` diagnostic. The view never performs work of its own — it only collects [state] and calls
// [explain] / [onViewOpened].
//
// The web `canStart`/`haveInputs` gate (a vehicle in scope) is derived from the selection store, so the
// action stays disabled until the active vehicle resolves and the request body always carries a valid
// `vehicle_id` ([requestVehicleId]). Double-submit is coalesced exactly as the web hook's `runningRef`
// (an explain while the stream is open is a no-op); a thrown transport error maps to the error lifecycle
// (web fetch catch → `finalizeError`); a stream that closes without a terminal frame settles to Done (web
// "mark done so the UI doesn't sit in streaming"). Coroutine cancellation (the ViewModel clearing) closes
// the stream — the native AbortController.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIChargingCurveFingerprintClustering) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichargingcurvefingerprintclustering

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * State holder backing the Compose [AIChargingCurveFingerprintClustering] surface — the Android port of
 * the web component's `useAiStream` ownership.
 *
 * It binds the injected [AiExplainStream] seam (the P1/S8 boundary) and the app-scoped [SelectedVehicleStore],
 * folding each fanned-out [AiStreamFrame] into the matching field of [ClusteringSurfaceState] (web
 * `setText` / `setState` / `setError`) and deriving [ClusteringSurfaceState.canStart] from the active
 * vehicle (web `haveInputs`). [explain] opens a fresh stream (web `stream.start`), coalescing a
 * double-submit while one is open; [onViewOpened] emits the P1/S11 `view.opened` diagnostic exactly once
 * per surface open. The view stays a thin renderer (ADR-002).
 *
 * @param stream the explain-stream seam (a transport-backed adapter in production, a fake in tests). The
 *   ViewModel owns no networking — it only opens + folds the seam.
 * @param selection the app-scoped active-vehicle selection backing the `canStart` gate + the request body.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the explain event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AIChargingCurveFingerprintClusteringViewModel(
    private val stream: AiExplainStream,
    private val selection: SelectedVehicleStore,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val progress = MutableStateFlow(Progress())
    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * The projected surface state (web `{ state, text, error }` + `canStart`). The stream progress is
     * combined with the live selection so the action's enabled-ness tracks the active vehicle; re-shared
     * with `WhileSubscribed` so the fold runs only while the surface observes it.
     */
    val state: StateFlow<ClusteringSurfaceState> =
        combine(progress, selection.selectedId) { snapshot, vehicleId ->
            ClusteringSurfaceState(
                phase = snapshot.phase,
                text = snapshot.text,
                error = snapshot.error,
                canStart = haveInputs(vehicleId),
            )
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = ClusteringSurfaceState(canStart = haveInputs(selection.selectedId.value)),
        )

    /**
     * Opens a fresh explain stream for the active vehicle (web Explain button's `stream.start`). A no-op
     * while a stream is already open (web `runningRef` coalescing) or while no vehicle is in scope (web
     * `!canStart`). Logs only the surface slug — never the vehicle id or any narrative.
     */
    fun explain() {
        if (progress.value.phase == AiStreamPhase.Streaming) return
        val vehicleId = selection.selectedId.value
        if (!haveInputs(vehicleId)) return
        streamJob?.cancel()
        progress.value = Progress(phase = AiStreamPhase.Streaming)
        logger.info(EVENT_EXPLAIN, mapOf(FIELD_SURFACE to AIChargingCurveFingerprintClusteringRegistration.SLUG))
        streamJob = stateScope.launch { runStream(requestVehicleId(vehicleId)) }
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAIChargingCurveClusteringOpened(logger)
    }

    /**
     * Collects the open stream, folding each frame into [progress]; a thrown transport error becomes a
     * terminal error frame (web fetch catch), and a clean close with no terminal frame settles to Done
     * (web "mark done"). Cancellation (ViewModel clearing) propagates out untouched — the native abort.
     */
    private suspend fun runStream(vehicleId: Long) {
        stream
            .open(AiExplainRequest(vehicleId))
            .catch { cause -> apply(AiStreamFrame.Error(cause.message ?: AiClusteringDefaults.ERROR_UNKNOWN)) }
            .collect { frame -> apply(frame) }
        progress.update { current ->
            if (current.phase == AiStreamPhase.Streaming) current.copy(phase = AiStreamPhase.Done) else current
        }
    }

    /** Applies one [frame] to [progress]: accumulate delta text, settle on done, or capture the error message. */
    private fun apply(frame: AiStreamFrame) {
        progress.update { current ->
            when (frame) {
                is AiStreamFrame.Delta ->
                    current.copy(phase = AiStreamPhase.Streaming, text = current.text + frame.text)
                AiStreamFrame.Done -> current.copy(phase = AiStreamPhase.Done)
                is AiStreamFrame.Error -> current.copy(phase = AiStreamPhase.Error, error = frame.message)
            }
        }
    }

    /** The internal stream progress folded by [apply] — the `(state, text, error)` slice of useAiStream. */
    private data class Progress(
        val phase: AiStreamPhase = AiStreamPhase.Idle,
        val text: String = "",
        val error: String? = null,
    )

    companion object {
        /** Keep the projected state's upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L

        /** The PII-safe diagnostics event emitted when an explain is fired (slug only, never the vehicle id). */
        const val EVENT_EXPLAIN = "aiClustering.explain"

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            stream: AiExplainStream,
            selection: SelectedVehicleStore,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AIChargingCurveFingerprintClusteringViewModel(stream, selection, logger) }
            }
    }
}
