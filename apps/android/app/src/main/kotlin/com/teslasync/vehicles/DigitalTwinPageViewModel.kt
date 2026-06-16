// The state holder backing the DigitalTwinPage vehicles surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hooks (web/src/features/vehicles/pages/DigitalTwinPage.tsx). It projects the backend
// `GET /vehicles` (web `useVehicles`), `GET /vehicles/{id}/state` (web `useVehicleState`), `GET /security/latest`
// (web `useSecurityLatest`) and `GET /charging-telemetry/latest` (web `useChargingTelemetryLatest`) reads onto the
// shared lifecycle-aware [UiState] surface, scoped to the global active vehicle (web `useSelectedVehicle`). All
// decode/merge logic lives in the framework-free model (DigitalTwinPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// The vehicles feed drives the page's primary loading / empty (no vehicles) / content lifecycle (web
// `vehiclesLoading` + the `!vehicle && !vehiclesLoading` empty branch). The three per-vehicle feeds re-collect whenever
// the active vehicle changes or the refresh trigger bumps (web `refetchInterval: 5_000`); each resolves to its own
// [UiState] so the side panels render their own empty surfaces (web `securityData ? <KVList /> : <EmptyState />`)
// without ever gating the twin. A null decode (web `securityData?`) resolves to UiPhase.Empty.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehicles.digitaltwin

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * @param source the P1/S8 data seam (the shared resilient client + the app-scoped active-vehicle selection in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DigitalTwinPageViewModel(
    private val source: DigitalTwinPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The global active-vehicle selection (web `useSelectedVehicle`), surfaced for the paint picker + twin scope. */
    val selectedVehicleId: StateFlow<Long?> = source.selectedVehicleId()

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The `GET /vehicles` fleet feed as cache-then-network UI state (web `useVehicles`). It drives the page's primary
     * loading → empty (no vehicles) → content lifecycle (web `vehiclesLoading` + the `!vehicle` empty branch) and
     * supplies the selected vehicle's exterior colour for the paint picker.
     */
    val vehiclesState: StateFlow<UiState<List<TwinVehicle>>> =
        refreshTrigger
            .flatMapLatest { source.vehicles() }
            .map { it.mapData(::parseVehicles) }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The `GET /vehicles/{id}/state` feed (web `useVehicleState`). Re-collected on vehicle change / refresh; gated on a
     * selected vehicle. Feeds [buildTwinState] (locked/sentry/charging/driving) and the badge status; never gates the
     * page.
     */
    val vehicleStateState: StateFlow<UiState<VehicleStateSnapshot?>> =
        scopedVehicleId
            .flatMapLatest { id -> feedFor(id, source::vehicleState) }
            .map { it.mapData(::parseVehicleState) }
            .asUiState(isEmpty = { it == null })

    /**
     * The `GET /security/latest` feed (web `useSecurityLatest`). A null decode (web `securityData?`) resolves to the
     * empty surface so the doors + windows panels show their no-data fallbacks; it never gates the twin.
     */
    val securityState: StateFlow<UiState<SecuritySnapshot?>> =
        scopedVehicleId
            .flatMapLatest { id -> feedFor(id, source::securityLatest) }
            .map { it.mapData(::parseSecurity) }
            .asUiState(isEmpty = { it == null })

    /**
     * The `GET /charging-telemetry/latest` feed (web `useChargingTelemetryLatest`). Feeds [buildTwinState]
     * (charge-port + is-charging) and the badge status; never gates the page.
     */
    val chargingState: StateFlow<UiState<ChargingSnapshot?>> =
        scopedVehicleId
            .flatMapLatest { id -> feedFor(id, source::chargingLatest) }
            .map { it.mapData(::parseCharging) }
            .asUiState(isEmpty = { it == null })

    /** Re-runs every cache-then-network read (the web `refetchInterval` analogue + the error-surface retry). */
    fun refresh() {
        logger.info("digitaltwin.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / VIN / physical-state payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordDigitalTwinPageOpened(logger)
    }

    /** A per-vehicle feed, or the synthetic "no selection" empty payload when nothing is selected (web `enabled`). */
    private fun feedFor(
        id: Long?,
        feed: (Long) -> Flow<Resource<JsonElement>>,
    ): Flow<Resource<JsonElement>> {
        val vehicleId = id?.takeIf { it > 0L } ?: return noVehicleFeed
        return feed(vehicleId)
    }

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val noVehicleFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonNull, 0L, false))
    }
}
