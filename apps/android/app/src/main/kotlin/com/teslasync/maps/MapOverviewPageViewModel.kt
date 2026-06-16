// The state holder backing the MapOverviewPage maps surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/maps/pages/MapOverviewPage.tsx). It projects the three
// cache-then-network reads onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], owns
// the page's one piece of local state (the selected base-map style — web `useUrlEnum('layer', …)`), derives the
// effective active vehicle (web `useSelectedVehicle`, self-healing to the first vehicle), and derives the live
// display preferences from the settings document (web `useUnits`). All decode + derivation logic lives in the
// framework-free model (MapOverviewPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// Feeds re-collect when the active vehicle changes or the refresh trigger bumps (the web query `refetchInterval` +
// the error-retry affordance). With no vehicle in scope the positions / location feeds park on an empty success the
// page renders as its "no location" empty state, exactly as the web disabled-hook / `NoVehicleSelected` case.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.maps

import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the real shared vehicles repository + the app-scoped active-vehicle selection +
 *   the shared settings holder in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MapOverviewPageViewModel(
    private val source: MapOverviewPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableMapStyle = MutableStateFlow(MapStyleId.Dark)
    private var viewOpenedRecorded = false

    /** The selected base-map style (web `useUrlEnum('layer', …)`), driving the layer switcher + the map tiles. */
    val mapStyle: StateFlow<MapStyleId> = mutableMapStyle.asStateFlow()

    /** The shared `GET /vehicles` feed (web `useVehicles`), re-shared so both the UI state + the derivations fold one upstream. */
    private val vehiclesResource: StateFlow<Resource<List<Vehicle>>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), Resource.Loading(null, null, false))

    /**
     * The fleet list as cache-then-network UI state (web `useVehicles`) — the declared parity source. Drives the
     * page-level loading / error / empty / success surface; an empty fleet resolves to the empty state.
     */
    val vehiclesState: StateFlow<UiState<List<Vehicle>>> = vehiclesResource.asUiState(isEmpty = { it.isEmpty() })

    /** The live fleet rows, for the active-vehicle fallback + the marker name (never gates the page). */
    private val vehicleList: StateFlow<List<Vehicle>> =
        vehiclesResource
            .map { it.cached ?: emptyList() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    /**
     * The effective active vehicle (web `useSelectedVehicle`): the explicit selection while it is still enrolled,
     * else the first vehicle — the web "default to the first vehicle" self-heal. Scopes the positions + location feeds.
     */
    val effectiveVehicleId: StateFlow<Long?> =
        combine(source.selectedVehicleId(), vehicleList) { selected, list ->
            when {
                selected != null && (list.isEmpty() || list.any { it.id == selected }) -> selected
                else -> list.firstOrNull()?.id
            }
        }.stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /**
     * The active vehicle's recent positions decoded + folded into the panel slices (web `useVehiclePositions`).
     * Re-collected on vehicle change / refresh; with no vehicle it parks on the empty bundle (the map empty state).
     */
    val positionsState: StateFlow<UiState<MapOverviewData>> =
        combine(effectiveVehicleId, refreshTrigger) { id, _ -> id }
            .flatMapLatest { id ->
                if (id == null || id <= 0L) {
                    flowOf<Resource<MapOverviewData>>(Resource.Success(MapOverviewData.EMPTY, fetchedAt = 0L, stale = false))
                } else {
                    source.positions(id).map { resource -> resource.mapData { json -> buildMapOverviewData(parsePositions(json)) } }
                }
            }.asUiState(isEmpty = { it.isEmpty })

    /**
     * The latest location snapshot decoded into the home / work / HomeLink badges (web `useLocationSnapshotLatest`).
     * Re-collected on vehicle change / refresh; with no vehicle (or an empty payload) it resolves to the empty surface.
     */
    val locationState: StateFlow<UiState<LocationSnapshot?>> =
        combine(effectiveVehicleId, refreshTrigger) { id, _ -> id }
            .flatMapLatest { id ->
                if (id == null || id <= 0L) {
                    flowOf<Resource<LocationSnapshot?>>(Resource.Success(null, fetchedAt = 0L, stale = false))
                } else {
                    source.locationSnapshot(id).map { resource -> resource.mapData(::parseLocationSnapshot) }
                }
            }.asUiState(isEmpty = { it == null })

    /** The live display preferences derived from the settings document (web `useUnits`). Falls back to metric/en-US. */
    val displayPrefs: StateFlow<MapOverviewDisplayPrefs> =
        source
            .settings()
            .map { resource -> MapOverviewDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), MapOverviewDisplayPrefs.default())

    /** The active vehicle's display name for the marker popup (web `vehicle?.display_name`), or null when unknown. */
    val selectedVehicleName: StateFlow<String?> =
        combine(effectiveVehicleId, vehicleList) { id, list -> list.firstOrNull { it.id == id }?.displayName }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /** Selects a base-map style (web `setMapStyle` via the layer switcher). A no-op when unchanged. */
    fun setMapStyle(style: MapStyleId) = mutableMapStyle.update { style }

    /** Re-runs every cache-then-network load — the web query `refetch` / the error-surface retry affordance. */
    fun refresh() {
        logger.info("mapOverview.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emits the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordMapOverviewPageOpened(logger)
    }
}
