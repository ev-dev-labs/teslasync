// The state holder backing the LocationsPage surface (P1/S8) — the native counterpart of the web page's React state
// + the inline visited-locations query (web/src/features/maps/pages/LocationsPage.tsx). It owns the page's local
// interaction state (search / page / range / applied-name hand-off) as an immutable [LocationsInteraction] snapshot,
// projects the single cache-then-network visited-locations read onto the shared lifecycle-aware [UiState] surface
// via [BaseFeedViewModel.asUiState], and re-collects whenever the active vehicle changes (web `useSelectedVehicle`)
// or the refresh trigger bumps. With no vehicle in scope it parks on an empty success (the web disabled-query
// `enabled: vehicleId !== null` case), which the page renders as its no-locations empty state. All derivation logic
// lives in the framework-free model (LocationsPageModel.kt); this holder is the thin orchestration layer and
// performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.maps.locations

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.update
import java.time.LocalDate

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.LocationRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LocationsPageViewModel(
    private val source: LocationsPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(LocationsInteraction(range = LocationsRange.allTime()))
    private val mutableAppliedNames = MutableStateFlow<Map<Long, String>>(emptyMap())
    private val locationsRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The page's local interaction snapshot (web URL-state cells: search `q`, `page`, and the range). */
    val interaction: StateFlow<LocationsInteraction> = mutableInteraction.asStateFlow()

    /**
     * The AI applied-name hand-off, keyed by location id (web `appliedName`). When the user accepts an AI proposal,
     * the proposed name is parked here; the list renders a "ready to save" confirmation. The AI panel never persists
     * — the canonical baseline rename/geofence-create flow is the only write path.
     */
    val appliedNames: StateFlow<Map<Long, String>> = mutableAppliedNames.asStateFlow()

    /**
     * The vehicle's visited locations as cache-then-network UI state (web `useLocations`). Re-collected whenever the
     * active vehicle changes or the refresh trigger bumps. Gated on a selected vehicle (web
     * `enabled: vehicleId !== null`): with no vehicle it parks on an empty success the page renders as its
     * no-locations empty state.
     */
    val locationsState: StateFlow<UiState<List<VisitedLocation>>> =
        combine(source.selectedVehicleId(), locationsRefresh) { vehicleId, _ -> vehicleId }
            .flatMapLatest { vehicleId ->
                if (vehicleId == null || vehicleId <= 0L) {
                    flowOf<Resource<List<VisitedLocation>>>(Resource.Success(emptyList(), fetchedAt = 0L, stale = false))
                } else {
                    source.visitedLocations(vehicleId.toString())
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    // ── Interaction actions (web setUrlString / setUrlNumber / setRange) ─────────────────────────────────────────

    /** Updates the search query, resetting to page 1 (web `setSearch` + the `q` URL cell). */
    fun setSearch(query: String) = mutableInteraction.update { it.copy(search = query, page = 1) }

    /** Clears the search query, resetting to page 1 (web empty-state `Clear search` CTA / chip remove). */
    fun clearSearch() = setSearch("")

    /** Jumps to a 1-based page (web `setPage`). */
    fun setPage(page: Int) = mutableInteraction.update { it.copy(page = page.coerceAtLeast(1)) }

    /** Selects the date range, resetting to page 1 (web `onChange={(r) => { setRange(r); setPage(1); }}`). */
    fun setRange(
        start: LocalDate,
        end: LocalDate,
    ) = mutableInteraction.update { it.copy(range = LocationsRange(start, end), page = 1) }

    /**
     * Parks an AI-proposed name for [locationId] (web `setAppliedName({ id, name })`). The list shows the
     * "ready to save" confirmation; the proposal is never persisted here.
     */
    fun applyName(
        locationId: Long,
        name: String,
    ) = mutableAppliedNames.update { it + (locationId to name) }

    // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────

    /** Re-collect the visited-locations feed — the web query `refetch` / the error-retry + pull-to-refresh. */
    fun refresh() {
        logger.info("locations.refresh")
        locationsRefresh.update { it + 1 }
    }

    /** Retry affordance for the visited-locations feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordLocationsPageOpened(logger)
    }
}
