// The state holder backing the ChargingCurvePage surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/charging/pages/ChargingCurvePage.tsx). It owns the page's
// local interaction state (the selected session id) as an immutable [ChargingCurveInteraction] snapshot, and
// projects the single cache-then-network read (`useChargingSessionsPaginated`) onto the shared lifecycle-aware
// [UiState] surface via [BaseFeedViewModel.asUiState]. The sessions feed re-collects whenever the active vehicle
// changes (web `useSelectedVehicle`) or the refresh trigger bumps; with no vehicle in scope it parks on an empty
// success (the web disabled-hook case), which the page renders as its no-sessions empty state. All derivation
// logic lives in the framework-free model (ChargingCurvePageModel.kt); this holder is the thin orchestration
// layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingcurve

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.ChargingRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingCurvePageViewModel(
    private val source: ChargingCurvePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(ChargingCurveInteraction())
    private val sessionsRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web `selectedSessionId` useState). */
    val interaction: StateFlow<ChargingCurveInteraction> = mutableInteraction.asStateFlow()

    /**
     * The paginated charging sessions as cache-then-network UI state (web `useChargingSessionsPaginated`).
     * Re-collected whenever the active vehicle changes or the refresh trigger bumps. Gated on a selected vehicle
     * (web `enabled: activeVehicleId != null`): with no vehicle it parks on an empty success the page renders as
     * its no-sessions empty state. The page fans this single feed out into the summary / curve / detail /
     * comparison / charger-type / speed-trend / time-to-charge slices via the framework-free model.
     */
    val sessionsState: StateFlow<UiState<List<ChargingSession>>> =
        combine(source.selectedVehicleId(), sessionsRefresh) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null || vehicleId <= 0L) {
                    flowOf<Resource<List<ChargingSession>>>(
                        Resource.Success(emptyList(), fetchedAt = 0L, stale = false),
                    )
                } else {
                    source.sessionsPaginated(vehicleId)
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Select (or clear, with `null`) the session to inspect (web `setSelectedSessionId`). */
    fun selectSession(id: Long?) {
        mutableInteraction.update { it.copy(selectedSessionId = id) }
    }

    /** Re-collect the sessions feed — the web query `refetch` / the page error-retry affordance. */
    fun refresh() {
        logger.info("chargingCurve.refresh")
        sessionsRefresh.update { it + 1 }
    }

    /** Retry affordance for the sessions feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordChargingCurvePageOpened(logger)
    }
}
