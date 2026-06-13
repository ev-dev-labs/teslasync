// UI-thread-free state holder backing the AITirePressureTrendReasoning surface — the native port of the
// web component's hook composition (web/src/components/ai/AITirePressureTrendReasoning.tsx). It binds
// three shared P1/S8 concerns and performs no HTTP itself (ADR-002): the [SettingsStore] document for the
// AI-Off gate (web `useAiEnabled`), the [VehiclesStore] list to resolve the in-scope vehicle (web
// `vehicleId ?? vehicles?.[0]?.id`), and the [AiNarrationStreamSource] seam for the on-demand narration
// stream (web `useAiStream`). The view never performs HTTP — it only collects [state] and calls
// [narrate]/[cancel]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AITirePressureTrendReasoning) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aitirepressuretrendreasoning

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * State holder for the gated tire-pressure trend reasoning card.
 *
 * The AI-Off gate and the vehicle scope are derived from the two shared holders and folded into a single
 * [state] alongside the streamed-narration sub-state. [narrate] opens the stream for the in-scope vehicle
 * (no-op while one is already running, web `start()`), [cancel] aborts it back to idle (web `cancel()`),
 * [retry] re-runs it, and a resolved-vehicle change discards any prior narration as stale so the surface
 * never shows text computed for a different vehicle. [onViewOpened] emits the one PII-safe `view.opened`
 * diagnostic (P1/S11) — slug only, never a vehicle id or any narration content.
 *
 * @param gate the AI-Off gate stream (web `useAiEnabled`); the surface is hidden until it emits `true`.
 * @param vehicleId the resolved in-scope vehicle id stream (web `vehicleId ?? vehicles?.[0]?.id`).
 * @param source the narration stream seam (a shared-client adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class AITirePressureTrendReasoningViewModel(
    gate: Flow<Boolean>,
    vehicleId: Flow<Long?>,
    private val source: AiNarrationStreamSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableState =
        MutableStateFlow(AITirePressureTrendReasoningState(gateEnabled = false, vehicleId = null))

    /** The gated narration surface state (gate / idle / streaming / content / error), folded from all sources. */
    val state: StateFlow<AITirePressureTrendReasoningState> = mutableState.asStateFlow()

    private var narrationJob: Job? = null
    private var viewOpenedRecorded = false

    init {
        // The AI-Off gate (web `useAiEnabled`): fail-closed until the gate stream first emits.
        launch { gate.collect { enabled -> mutableState.update { it.copy(gateEnabled = enabled) } } }
        // The in-scope vehicle (web `vehicleId ?? vehicles?.[0]?.id`): a change discards a stale narration.
        launch { vehicleId.collect(::onVehicleResolved) }
    }

    /** Opens a narration run for the in-scope vehicle (web `stream.start()`); a no-op unless [State.canStart]. */
    fun narrate() {
        val current = mutableState.value
        if (!current.canStart) return
        val vehicleId = current.vehicleId ?: return
        logger.info(EVENT_NARRATE, mapOf("surface" to AITirePressureTrendReasoningRegistration.SLUG))
        mutableState.update { AITirePressureTrendReasoningProjection.startNarration(it) }
        narrationJob?.cancel()
        narrationJob =
            stateScope.launch {
                source.narrate(vehicleId).collect { event ->
                    mutableState.update { AITirePressureTrendReasoningProjection.reduceNarration(it, event) }
                }
                mutableState.update { AITirePressureTrendReasoningProjection.finishNarration(it) }
            }
    }

    /** Aborts an in-flight narration back to idle (web `cancel()` → AbortError → idle). */
    fun cancel() {
        narrationJob?.cancel()
        narrationJob = null
        mutableState.update { run ->
            if (run.phase == NarrationPhase.Streaming) run.copy(phase = NarrationPhase.Idle) else run
        }
    }

    /** Retry after a failure — re-runs the narration (backs the error surface's retry affordance). */
    fun retry() = narrate()

    /** Emits the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("surface" to AITirePressureTrendReasoningRegistration.SLUG))
    }

    private fun onVehicleResolved(vehicleId: Long?) {
        val current = mutableState.value
        val changed = current.vehicleId != null && current.vehicleId != vehicleId
        if (changed && current.phase != NarrationPhase.Idle) {
            // The resolved vehicle changed; any prior/in-flight narration is for a different vehicle → discard.
            narrationJob?.cancel()
            narrationJob = null
            mutableState.value =
                current.copy(vehicleId = vehicleId, phase = NarrationPhase.Idle, text = "", error = null)
        } else {
            mutableState.update { it.copy(vehicleId = vehicleId) }
        }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_NARRATE = "tirePressureTrendReasoning.narrate"

        /**
         * Wires the surface from the shared [SettingsStore] + [VehiclesStore] (P1/S8) and the shared
         * resilient [ApiHttpClient] (the narration stream seam). An explicit [explicitVehicleId] overrides
         * the primary-vehicle resolution (web `vehicleId` prop precedence).
         */
        fun create(
            settings: SettingsStore,
            vehicles: VehiclesStore,
            client: ApiHttpClient,
            logger: Logger,
            explicitVehicleId: Long? = null,
        ): AITirePressureTrendReasoningViewModel =
            AITirePressureTrendReasoningViewModel(
                gate =
                    settings.settings().map {
                        AITirePressureTrendReasoningProjection.isTirePressureReasoningEnabled(it.cached)
                    },
                vehicleId =
                    vehicles.vehicles().map {
                        AITirePressureTrendReasoningProjection.resolveVehicleId(explicitVehicleId, it.cached)
                    },
                source = client.asAiNarrationStreamSource(),
                logger = logger,
            )

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            settings: SettingsStore,
            vehicles: VehiclesStore,
            client: ApiHttpClient,
            logger: Logger,
            explicitVehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    create(settings, vehicles, client, logger, explicitVehicleId)
                }
            }
    }
}
