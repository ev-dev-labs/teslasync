// UI-thread-free state holder backing the AISuggestNewGeofences shared surface — the native analogue of the state
// the web component owns (web/src/components/ai/AISuggestNewGeofences.tsx: the `useAiStream` lifecycle, the
// locally-captured `draft`, the Suggest double-submit guard, the cancel+reset on location change, and the
// "Apply to form" hand-off). It binds the P1/S8 [AiGeofenceDraftSource] seam, folds the decoded stream into a
// single [AiGeofenceDraftUiState] through the off-device-tested [AiGeofenceDraftReducer], and owns the surface's
// actions + the PII-safe `view.opened` diagnostic. The view never touches the network — it collects [state] and
// calls the actions.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aisuggestnewgeofences

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * @param source the propose-only draft-stream seam (a real [SseAiGeofenceDraftSource] over the host's Ktor
 *   transport in production, a fake in tests). The view-model owns no networking — it only folds the decoded
 *   events.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the action events,
 *   each carrying only the surface slug (never the location id, the current label, the centroid, or the proposed
 *   name).
 */
class AISuggestNewGeofencesViewModel(
    private val source: AiGeofenceDraftSource,
    private val logger: Logger,
) : ViewModel() {
    private val _state = MutableStateFlow(AiGeofenceDraftUiState.IDLE)

    /**
     * The live render-ready stream state (web `stream.state` + captured `draft`). The composable switches surfaces
     * on it; it re-emits as decoded events fold through [AiGeofenceDraftReducer].
     */
    val state: StateFlow<AiGeofenceDraftUiState> = _state.asStateFlow()

    private var streamJob: Job? = null
    private var viewOpenedRecorded = false

    /**
     * Emits the one mandated PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAISuggestNewGeofencesOpened(logger)
    }

    /**
     * Web `handleSuggest`: requests a fresh proposal for [locationId]. A double-submit while busy is a no-op
     * (web `if (isBusy) return`); otherwise it clears any prior draft, opens the stream, and folds its events into
     * [state]. When the server closes the stream without a terminal frame the phase settles to
     * [AiGeofenceDraftPhase.Done] (web "mark as done"); a transport failure settles to [AiGeofenceDraftPhase.Error]
     * with a retry affordance. A non-positive [locationId] is rejected defensively (web `canStart = locationId > 0`).
     */
    fun suggest(locationId: Long) {
        if (_state.value.isBusy || locationId <= 0) return
        recordAISuggestNewGeofencesSuggested(logger)
        streamJob?.cancel()
        _state.value = AiGeofenceDraftUiState(phase = AiGeofenceDraftPhase.Streaming)
        streamJob = viewModelScope.launch { collectStream(locationId) }
    }

    @Suppress("TooGenericExceptionCaught")
    private suspend fun collectStream(locationId: Long) {
        try {
            source.draft(locationId).collect { event ->
                _state.update { AiGeofenceDraftReducer.reduce(it, event) }
            }
            _state.update {
                if (it.phase == AiGeofenceDraftPhase.Streaming) it.copy(phase = AiGeofenceDraftPhase.Done) else it
            }
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (failure: Throwable) {
            _state.update { it.copy(phase = AiGeofenceDraftPhase.Error, errorMessage = failure.message) }
        }
    }

    /**
     * Web cleanup on `locationId` change / unmount: cancels any in-flight stream and resets to the idle surface so
     * a stale proposal can never bleed into a newly-selected location.
     */
    fun reset() {
        streamJob?.cancel()
        streamJob = null
        _state.value = AiGeofenceDraftUiState.IDLE
    }

    /**
     * Web `handleApply`: records the "Apply to form" action for an accepted proposal. The actual copy into the
     * parent form is the host's responsibility (the view raises it through `onApplyDraft`); this only emits the
     * PII-safe diagnostic (slug + the non-PII validator status). A non-ok draft is ignored (web guards the apply
     * on `draft.status === 'ok'`).
     */
    fun onApplied(draft: GeofenceDraft) {
        if (!draft.isOk) return
        recordAISuggestNewGeofencesApplied(logger, draft.status)
    }

    override fun onCleared() {
        streamJob?.cancel()
        streamJob = null
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AiGeofenceDraftSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AISuggestNewGeofencesViewModel(source, logger) }
            }
    }
}
