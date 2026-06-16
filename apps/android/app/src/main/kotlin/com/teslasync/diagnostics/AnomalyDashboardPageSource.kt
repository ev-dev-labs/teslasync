// The data seam the AnomalyDashboardPage diagnostics surface binds to, plus its production binding over the shared-core
// S7 anomalies repository and the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's data reads: the single
// `useAnomalies(activeIdStr)` query (`GET /analytics/anomalies?vehicle_id={id}&days=7`) plus the global
// `useSelectedVehicle` scope.
//
// The web `useAnomalies` hook is the cross-platform Anomalies domain: its KMP-core S7 port is
// [io.teslasync.shared.core.data.repo.AnomaliesRepository] (HTTP-backed by [HttpAnomaliesRepository] over the SAME
// shared resilient client + offline cache every other feed uses, so the ADR-013 freshness contract + SI-verbatim
// caching are identical). The host constructs that repository from the primitives the DataContainer exposes and binds
// it here, mirroring how the shipped StatisticsPage binds its page-local `/analytics/period-stats` feed; the web hook's
// `enabled: vehicleId !== null` gate is a presentation concern and lives in the view-model. A narrow seam so the
// view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/diagnostics) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.diagnostics.anomalydashboard

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.data.repo.AnomaliesRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [AnomalyDashboardPageViewModel] depends on so it binds to an abstraction (the shared-core
 * anomalies repository + the app-scoped selection in production; a fake in tests), never to a concrete repository or
 * the network. The read feed is a cache-then-network `Resource` flow (the web `useAnomalies` hook); the selection is
 * the global active-vehicle scope. No HTTP touches the view.
 */
interface AnomalyDashboardPageSource {
    /**
     * The cache-then-network `GET /analytics/anomalies?vehicle_id={vehicleId}&days=7` feed (web `useAnomalies`). The
     * view-model only requests it for a real selection (web `enabled: vehicleId !== null`).
     */
    fun anomalies(vehicleId: String): Flow<Resource<JsonElement>>

    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>
}

/**
 * Binds the surface to the shared-core S7 [AnomaliesRepository] (the same domain the shared `AnomaliesStore` wraps) +
 * the app-scoped [SelectedVehicleStore] — the live cache-then-network feed + selection every surface shares app-wide.
 * The live values flow through unchanged so the view-model renders the full state matrix (loading / content / empty /
 * error / stale / offline). No HTTP touches the view.
 */
fun anomalyDashboardPageSourceOf(
    repository: AnomaliesRepository,
    selectedVehicleStore: SelectedVehicleStore,
): AnomalyDashboardPageSource =
    object : AnomalyDashboardPageSource {
        override fun anomalies(vehicleId: String): Flow<Resource<JsonElement>> =
            repository.anomalies(vehicleId, ANOMALY_WINDOW_DAYS)

        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId
    }
