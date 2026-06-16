// The state holder backing the WatchFacePage wearable surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/watch/pages/WatchFacePage.tsx). It projects the
// `GET /watch/summary` glance read (web `useWatchSummary`) onto the shared lifecycle-aware [UiState] surface
// (loading → success → empty → error, plus stale/offline) and owns the `POST /watch/command` dispatcher (web
// `useWatchCommand`) as a one-shot suspend action that surfaces its outcome through the [events] channel. All
// decode/derivation logic lives in the framework-free model (WatchFacePageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// The summary re-collects whenever the refresh trigger bumps (the web `refetchInterval` analogue, driven by the
// screen's poll cadence + the error-surface retry); a blank decode (web `!data`) resolves to UiPhase.Empty so
// the surface shows its "No vehicle found" state, and a hard failure with no cache resolves to UiPhase.Error
// (the same message surface). The command mirrors the web mutation exactly: success invalidates NO feed (the web
// `onSuccess` only raises a toast), so it triggers no refresh; the in-flight [sending] flag disables the action
// icons while a dispatch is outstanding (web `commandMutation.isPending`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/watch) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.watch.watchface

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.watch.WatchSummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the shared resilient Watch repository in production ↔ a test fake); the
 *   view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` + the
 *   command dispatch event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the bound vehicle (web `vehicle_id` URL param); `null` reads the primary vehicle (the watch
 *   endpoints omit `vehicle_id`), mirroring the web hooks — there is no fleet-list fallback for this surface.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WatchFacePageViewModel(
    private val source: WatchFacePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val sendingState = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /**
     * The `GET /watch/summary` glance payload as a lifecycle-aware [UiState]: loading (first load) → content
     * (decoded glance) → empty (web `!data` ⇒ the "No vehicle found" surface) → error (hard failure), plus
     * stale/offline. Re-collected whenever the refresh trigger bumps (web `refetchInterval` + error retry).
     */
    val state: StateFlow<UiState<WatchSummary>> =
        refreshTrigger
            .flatMapLatest { source.watchSummary(vehicleId) }
            .asUiState { WatchFaceProjection.isEmpty(it) }

    /** Whether a command dispatch is currently outstanding (web `commandMutation.isPending`); disables actions. */
    val sending: StateFlow<Boolean> = sendingState.asStateFlow()

    /**
     * Dispatches a watch-issued command (web `sendCommand` → `useWatchCommand`). Sets [sending] while the call
     * is outstanding, emits a one-shot [UiEvent.CommandOutcome] the screen folds into a toast, and — mirroring
     * the web mutation, which invalidates nothing on success — triggers NO refresh; the next poll tick reflects
     * any resulting state change. A transport failure resolves to a failed outcome.
     */
    fun sendCommand(command: String) {
        if (sendingState.value) return
        launch {
            sendingState.value = true
            logger.info("watchFace.command")
            val result = source.sendWatchCommand(vehicleId, command)
            val success = result.getOrNull()?.success == true
            sendingState.value = false
            emitEvent(UiEvent.CommandOutcome(commandKey = command, success = success))
        }
    }

    /** Re-runs the cache-then-network summary load (web `refetchInterval` tick + the error-surface retry). */
    fun refresh() {
        logger.info("watchFace.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface — identical to [refresh]. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no battery / range / location payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordWatchFacePageOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] the host uses to construct this surface's ViewModel. */
        fun factory(
            source: WatchFacePageSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { WatchFacePageViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
