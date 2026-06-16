// The state holder backing the AnomalyDashboardPage diagnostics surface (P1/S8) — the native counterpart of the web
// page's TanStack-Query hook (web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx). It projects the one
// cache-then-network read (`useAnomalies`) onto the shared lifecycle-aware [UiState] surface, scoped to the global
// active vehicle (web `useSelectedVehicle`). All decode/derivation logic lives in the framework-free model
// (AnomalyDashboardPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// The feed re-collects whenever the selected vehicle changes (a new `/analytics/anomalies?vehicle_id={id}` read) or the
// refresh trigger bumps. The web hook is gated on a selection (`enabled: vehicleId !== null`); the holder reproduces
// that gate by routing a null / non-positive selection to a synthetic empty-object feed (never a fetch), which the
// model resolves to UiPhase.Empty via [AnomalyReport.hasData] so the body shows its friendly empty surface rather than
// a grid of zeros (the documented divergence in the model).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/diagnostics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.diagnostics.anomalydashboard

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
import kotlinx.serialization.json.JsonObject

/**
 * @param source the P1/S8 data seam (the shared-core anomalies repository + the app-scoped active-vehicle selection in
 *   production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnomalyDashboardPageViewModel(
    private val source: AnomalyDashboardPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle read. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The `/analytics/anomalies` feed as cache-then-network UI state (web `useAnomalies`). Re-collected when the active
     * vehicle changes or refresh bumps; an all-zero payload (or no selection — web `enabled: vehicleId !== null`)
     * resolves to the empty surface.
     */
    val state: StateFlow<UiState<AnomalyReport>> =
        scopedVehicleId
            .flatMapLatest { id -> id.activeId()?.let(source::anomalies) ?: emptyObjectFeed }
            .map { it.mapData(::parseAnomalyReport) }
            .asUiState(isEmpty = { !it.hasData })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("anomaly.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the hard-error surface. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no vehicle id / signal / value payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAnomalyDashboardOpened(logger)
    }

    /** A positive selection as the `vehicle_id` string, or null when nothing is selected (web `vehicleId ? … : null`). */
    private fun Long?.activeId(): String? = this?.takeIf { it > 0L }?.toString()

    private companion object {
        /** The synthetic "no selection" payload so a null scope resolves to the empty surface rather than a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
