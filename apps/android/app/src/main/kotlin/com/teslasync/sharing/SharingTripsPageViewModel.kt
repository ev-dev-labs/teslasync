// The state holder backing the SharingTripsPage sharing surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/sharing/pages/SharingTripsPage.tsx). It projects the single
// cache-then-network trips read (`useTrips({ vehicle_id, limit: 20 })`) onto the shared lifecycle-aware [UiState]
// surface via [BaseFeedViewModel.asUiState], derives the live display preferences from the settings document (web
// `useUnits`), and owns the page's only local interaction state: the selected-trip id (web
// `useState<number>(selectedTripId)`), which the recent-trips listbox toggles and which the AI share-card surface
// consumes once that sibling surface is wired in. The trips feed re-collects whenever the active vehicle changes
// (web `useSelectedVehicle`) or the refresh trigger bumps; with no vehicle in scope it queries the whole trip log
// (web `vehicle_id: vehicleId ?? undefined` → the key is simply omitted), exactly as the web hook does. All
// derivation logic lives in the framework-free model (SharingTripsPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/sharing) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharing.sharingtrips

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.presentation.trips.TripsParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.TripsRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] + [io.teslasync.shared.core.presentation.settings.SettingsStore]
 *   ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` + `select`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SharingTripsPageViewModel(
    private val source: SharingTripsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val tripsRefresh = MutableStateFlow(0)
    private val mutableSelectedTripId = MutableStateFlow<Long?>(null)
    private var viewOpenedRecorded = false

    /**
     * The recent trips as cache-then-network UI state (web `useTrips`). Re-collected whenever the active vehicle
     * changes or the refresh trigger bumps. The query is scoped to the active vehicle when one is selected and to
     * the whole trip log otherwise (web `vehicle_id: vehicleId ?? undefined`), always capped at the recent page
     * size (web `limit: 20`). An empty result parks on [io.teslasync.android.data.UiPhase.Empty] (web
     * `allTrips.length === 0`), which the page renders as its no-trips empty state.
     */
    val tripsState: StateFlow<UiState<List<Trip>>> =
        combine(source.selectedVehicleId(), tripsRefresh) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                source.trips(
                    TripsParams(
                        vehicleId = vehicleId?.takeIf { it > 0L },
                        limit = SharingTripsPageRegistration.RECENT_LIMIT,
                    ),
                )
            }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The live display preferences derived from the settings document (web `useUnits`). Shared while observed;
     * falls back to the metric defaults before settings load so the first frame is never blank.
     */
    val displayPrefs: StateFlow<SharingTripsDisplayPrefs> =
        source.settings()
            .map { resource -> SharingTripsDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                stateScope,
                SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                SharingTripsDisplayPrefs.default(),
            )

    /**
     * The currently-selected trip id (web `selectedTripId`), or `null` while nothing is picked. The recent-trips
     * listbox is the only selector on the page; tapping a row swaps the selection.
     */
    val selectedTripId: StateFlow<Long?> = mutableSelectedTripId.asStateFlow()

    /** Selects a trip from the recent-trips list (web `setSelectedTripId(trip.id)` on row click). */
    fun selectTrip(id: Long) = mutableSelectedTripId.update { id }

    /** Re-collect the trips feed — the web query `refetch` / the page error-retry + pull-to-refresh affordance. */
    fun refresh() {
        logger.info("sharingTrips.refresh")
        tripsRefresh.update { it + 1 }
    }

    /** Retry affordance for the trips feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordSharingTripsPageOpened(logger)
    }
}
