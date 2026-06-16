// The state holder backing the NavigationRoutePage maps surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/maps/pages/NavigationRoutePage.tsx). It projects the four backend reads
// onto the shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web `useSelectedVehicle`), and
// derives the live display preferences from the `/settings` document (web `useUnits`). All decode/derivation logic lives
// in the framework-free model (NavigationRoutePageModel.kt); this holder is the thin orchestration layer and performs no
// HTTP.
//
// Every per-vehicle feed re-collects whenever the active vehicle changes or the refresh trigger bumps. With no vehicle
// selected (web `enabled: vehicleId !== null`) each feed resolves to its synthetic empty payload so the matching section
// shows its own empty state rather than crashing — no region ever blanks. The latest snapshot powers the navigation
// status panel + the location-status cards + the route metric cards; the `/location-snapshots` history powers the
// speed-profile area chart, the home/work presence line chart, the recent-destinations table and the location-history
// table; the `/charging-telemetry/latest` projection powers the expected-energy-at-arrival metric (web
// `useChargingTelemetryLatest`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.maps.navigationroute

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the shared vehicles repository + the page-local history repository + the app-scoped
 *   active-vehicle selection + the shared settings holder in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `nav.refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NavigationRoutePageViewModel(
    private val source: NavigationRoutePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The `/location-snapshots/latest` feed as cache-then-network UI state (web `location-latest`). A null payload (or
     * no vehicle — web `enabled: vehicleId !== null`) resolves to the empty surface so the navigation-status panel shows
     * its `nav.noActiveNav` empty state instead of a blank region.
     */
    val latestState: StateFlow<UiState<LocationSnapshot?>> =
        scopedVehicleId
            .flatMapLatest { id ->
                val vehicleId = id.activeId()
                if (vehicleId == null) emptyObjectFeed else source.locationLatest(vehicleId)
            }
            .map { it.mapData(::parseLocationSnapshot) }
            .asUiState(isEmpty = { it == null })

    /**
     * The `/location-snapshots?limit=200` history feed as cache-then-network UI state (web `location-history`). Powers
     * the speed-profile chart, the presence chart, the recent-destinations table and the location-history table; an
     * empty list resolves to the empty surface each of those sections renders inline.
     */
    val historyState: StateFlow<UiState<List<LocationSnapshot>>> =
        scopedVehicleId
            .flatMapLatest { id ->
                val vehicleId = id.activeId()
                if (vehicleId == null) emptyArrayFeed else source.locationHistory(vehicleId)
            }
            .map { it.mapData(::parseLocationHistory) }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The `/charging-telemetry/latest` feed as cache-then-network UI state (web `useChargingTelemetryLatest`). The
     * surface reads only the expected-energy-at-arrival projection; a null projection resolves to the empty surface so
     * the metric shows its em-dash fallback marker.
     */
    val chargingState: StateFlow<UiState<ChargingTelemetry>> =
        scopedVehicleId
            .flatMapLatest { id ->
                val vehicleId = id.activeId()
                if (vehicleId == null) emptyObjectFeed else source.chargingTelemetryLatest(vehicleId)
            }
            .map { it.mapData(::parseChargingTelemetry) }
            .asUiState(isEmpty = { it.expectedEnergyPctAtArrival == null })

    /** The live display preferences derived from the settings document (web `useUnits`). Falls back to metric/2dp. */
    val displayPrefs: StateFlow<NavDisplayPrefs> =
        source
            .settings()
            .map { resource -> NavDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = NavDisplayPrefs.default(),
            )

    /** Re-runs every cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("nav.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / coordinates / destination payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordNavigationRoutePageOpened(logger)
    }

    /** A positive selection, or null when nothing is selected (web `vehicleId ? … : null`). */
    private fun Long?.activeId(): Long? = this?.takeIf { it > 0L }

    private companion object {
        /** The synthetic "no selection" object payload so a null scope resolves to the empty surface, not a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))

        /** The synthetic "no selection" array payload for the history feed. */
        private val emptyArrayFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonArray(emptyList()), 0L, false))
    }
}
