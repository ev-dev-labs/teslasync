// The state holder backing the VehicleDetailPage vehicles surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/vehicles/pages/VehicleDetailPage.tsx). It projects the page's
// declared `useVehicleSettings(vehicleId)` read (`GET /vehicles/{vehicleId}/settings`) onto the shared lifecycle-aware
// [UiState] surface, derives the effective vehicle name from it via the ported `findEffectiveSetting` selector (web
// L94-98), derives the live display locale from the `/settings` document (web `useFormatting`), and owns the wake
// command (web `wakeMutation`). All decode/derivation logic lives in the framework-free model
// (VehicleDetailPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The settings feed re-collects whenever the refresh trigger bumps (the error-surface retry + the wake-success
// follow-up refresh, web `setTimeout(refetchState, 5000)`). A null/empty decode resolves to UiPhase.Empty (the page
// renders the per-section empty surfaces); a hard transport failure with no cache resolves to UiPhase.Error (the
// page's retry surface). Wake runs the one-shot mutation off the seam and emits a one-shot localized toast event.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehicles.vehicledetail

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiEvent
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the shared resilient client + the shared settings holder in production ↔ a test
 *   fake); the view never performs HTTP.
 * @param vehicleId the numeric vehicle id from the route (web `useParams().id`).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` + `wake`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VehicleDetailPageViewModel(
    private val source: VehicleDetailPageSource,
    private val vehicleId: Long,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val wakingState = MutableStateFlow(false)

    /** Whether a wake command is in flight (drives the header Wake button's disabled/loading state, web `isPending`). */
    val waking: StateFlow<Boolean> = wakingState.asStateFlow()

    /**
     * The `GET /vehicles/{id}/settings` resolver feed as cache-then-network UI state (web `useVehicleSettings`).
     * Re-collected on refresh; empty when the decode carries no rows so the per-section surfaces render their empty
     * states, and a hard failure resolves to the error surface.
     */
    val settingsState: StateFlow<UiState<VehicleSettings>> =
        refreshTrigger
            .flatMapLatest { source.vehicleSettings(vehicleId) }
            .map { it.mapData(::parseVehicleSettings) }
            .asUiState(isEmpty = { it.settings.isEmpty() })

    /**
     * The vehicle's effective display name from the per-vehicle settings (web `effectiveName`, the `nickname` override
     * via the ported `findEffectiveSetting`); `null` falls through to the localized page title at the render boundary.
     */
    val effectiveName: StateFlow<String?> =
        settingsState
            .map { state -> effectiveNickname(state.data) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = null,
            )

    /** The live display preferences derived from the settings document (web `useFormatting`). Falls back to en-US. */
    val displayPrefs: StateFlow<VehicleDetailDisplayPrefs> =
        source
            .settings()
            .map { resource -> VehicleDetailDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = VehicleDetailDisplayPrefs.DEFAULT,
            )

    /**
     * Runs the wake command for this vehicle (web `wakeMutation.mutate()`): emits a localized success toast and a
     * follow-up settings refresh on success (web `setTimeout(refetchState, 5000)` analogue), or a localized failure
     * toast otherwise. Ignored while a wake is already in flight.
     */
    fun wake() {
        if (wakingState.value) return
        wakingState.value = true
        logger.info("vehicle.wake")
        launch {
            val result = source.wakeVehicle(vehicleId)
            wakingState.value = false
            result.fold(
                onSuccess = {
                    emitEvent(
                        UiEvent.Message(
                            messageKey = VehicleDetailPageRegistration.WAKE_SUCCESS_KEY,
                            severity = UiEvent.Severity.Success,
                        ),
                    )
                    refreshTrigger.update { it + 1 }
                },
                onFailure = {
                    emitEvent(
                        UiEvent.Message(
                            messageKey = VehicleDetailPageRegistration.WAKE_FAILED_KEY,
                            severity = UiEvent.Severity.Error,
                        ),
                    )
                },
            )
        }
    }

    /** Re-runs the settings read (the web `refetch` analogue + the error-surface retry). */
    fun refresh() {
        logger.info("vehicle.detail.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id, nickname, or settings payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVehicleDetailPageOpened(logger)
    }
}
