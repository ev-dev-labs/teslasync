// The state holder backing the ClimateControlPage vehicle-systems surface (P1/S8) — the native counterpart of the
// web page's React state + TanStack-Query hooks (web/src/features/vehicle-systems/pages/ClimateControlPage.tsx). It
// projects the three reads (`useClimate` ▸ `/climate/latest`, `useClimateHistory` ▸ `/climate`,
// `useChargingTelemetryLatest` ▸ `/charging-telemetry/latest`) onto the shared lifecycle-aware [UiState] surface,
// scoped to the global active vehicle (web `useSelectedVehicle`), and derives the live display preferences from the
// `/settings` document (web `useUnits`). All decode/derivation logic lives in the framework-free model
// (ClimateControlPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// Each feed re-collects whenever the active vehicle changes or the refresh trigger bumps. With no vehicle selected
// the web queries are disabled (`enabled: !!vehicleId`), so a null selection resolves to an empty success (the
// synthetic [emptySnapshot]) → the empty surface rather than a perpetual spinner. The charging-telemetry feed
// exposes only its last-known `not_enough_power_to_heat` flag for the banner alert.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.climatecontrol

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
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the shared resilient client + the app-scoped active-vehicle selection + the
 *   shared settings holder in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClimateControlPageViewModel(
    private val source: ClimateControlPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active-vehicle id (or null) + the refresh nonce, the shared trigger for every feed below. */
    private val scopedTrigger: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The latest climate snapshot as cache-then-network UI state (web `useClimate`). A null selection or an empty
     * `/climate/latest` map reads as [ClimateState.isBlank] → the Empty surface; the page still renders every panel
     * with its em-dash / empty fallbacks so no region blanks (web renders `latest?.field`).
     */
    val climateState: StateFlow<UiState<ClimateState>> =
        scopedTrigger
            .flatMapLatest { id -> feedFor(id) { source.climateLatest(it) } }
            .map { resource -> resource.mapData(::parseClimateState) }
            .asUiState(isEmpty = { it.isBlank() })

    /**
     * The 7-day climate history as cache-then-network UI state (web `useClimateHistory`). Backs the two history
     * charts + the history table; an empty list reads as the Empty surface so each renders its own empty state.
     */
    val historyState: StateFlow<UiState<List<ClimateState>>> =
        scopedTrigger
            .flatMapLatest { id -> feedFor(id) { source.climateHistory(it) } }
            .map { resource -> resource.mapData(::parseClimateHistory) }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The charging-telemetry alert flags (web `useChargingTelemetryLatest`). Exposed as the last-known value so the
     * banner can show the "insufficient power to heat" chip without a phase switch; defaults to all-clear.
     */
    val chargingFlags: StateFlow<ChargingTelemetryFlags> =
        scopedTrigger
            .flatMapLatest { id -> feedFor(id) { source.chargingTelemetryLatest(it) } }
            .map { resource -> parseChargingFlags(resource.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), ChargingTelemetryFlags())

    /** The live display preferences derived from the settings document (web `useUnits`). Falls back to metric. */
    val displayPrefs: StateFlow<ClimateDisplayPrefs> =
        source
            .settings()
            .map { resource -> ClimateDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = ClimateDisplayPrefs.DEFAULT,
            )

    /** Re-runs the cache-then-network loads (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("climateControl.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / temperature payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordClimateControlPageOpened(logger)
    }

    /** Routes a null selection to the synthetic empty payload (web `enabled: !!vehicleId`), else the live feed. */
    private fun feedFor(
        id: Long?,
        live: (String) -> Flow<Resource<JsonElement>>,
    ): Flow<Resource<JsonElement>> {
        val vehicleId = id?.takeIf { it > 0L }?.toString() ?: return emptySnapshot
        return live(vehicleId)
    }

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptySnapshot: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
