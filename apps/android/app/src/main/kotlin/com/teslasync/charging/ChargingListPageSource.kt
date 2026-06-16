// The data seam the ChargingListPage surface binds to, plus its production binding over the shared-core charging
// repository and the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's three reads
// (`useChargingSessionsPaginated`, `useChargingOptimizer`) and one mutation (`useBulkDeleteCharging`) plus the
// global `useSelectedVehicle` scope.
//
// The feeds are the shared-core cache-then-network `Resource` streams the S7 [ChargingRepository] exposes
// (`GET /charging?vehicle_id&limit&offset[&start][&end]` ▸ `sessionsPaginated`; `GET /analytics/charging-optimizer`
// ▸ `chargingOptimizer`) and the `DELETE /charging/bulk` mutation (`bulkDeleteCharging`). The Android DI graph
// ([io.teslasync.android.data.DataContainer]) wires no ChargingStore yet, so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpChargingRepository] over the SAME resilient client + offline cache the
// other repositories use and hands it in here. A narrow seam so the view-model depends on an abstraction (real
// adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.charginglist

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [ChargingListPageViewModel] depends on so it binds to an abstraction (the shared charging
 * repository + the app-scoped selection in production, a fake in tests), never to a concrete repository or the
 * network. The feeds are cache-then-network `Resource` flows (the web read hooks); the selection is the global
 * active-vehicle scope; the bulk delete is the web mutation. No HTTP touches the view.
 */
interface ChargingListPageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The cache-then-network paginated `GET /charging` feed for [vehicleId] over the optional `[start, end]`
     * day window (web `useChargingSessionsPaginated`). The page reads the web `limit: 500` window.
     */
    fun sessionsPaginated(
        vehicleId: Long,
        start: String?,
        end: String?,
    ): Flow<Resource<List<ChargingSession>>>

    /** The cache-then-network `GET /analytics/charging-optimizer` feed (web `useChargingOptimizer`). */
    fun chargingOptimizer(vehicleId: String): Flow<Resource<JsonElement>>

    /** The `DELETE /charging/bulk` mutation over the selected session ids (web `useBulkDeleteCharging`). */
    suspend fun bulkDeleteCharging(ids: List<Long>): Result<JsonElement>
}

/**
 * Binds the surface to the shared **S7** [ChargingRepository] + the app-scoped [SelectedVehicleStore] — the
 * memoized cache-then-network feeds every charging surface shares, scoped to the active vehicle. The live values
 * flow through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
 * stale / offline). No HTTP touches the view.
 */
fun chargingListPageSourceOf(
    chargingRepository: ChargingRepository,
    selectedVehicleStore: SelectedVehicleStore,
): ChargingListPageSource =
    object : ChargingListPageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun sessionsPaginated(
            vehicleId: Long,
            start: String?,
            end: String?,
        ): Flow<Resource<List<ChargingSession>>> =
            chargingRepository.sessionsPaginated(
                vehicleId = vehicleId,
                limit = ChargingListPageRegistration.SESSIONS_LIMIT,
                offset = 0,
                start = start,
                end = end,
            )

        override fun chargingOptimizer(vehicleId: String): Flow<Resource<JsonElement>> = chargingRepository.chargingOptimizer(vehicleId)

        override suspend fun bulkDeleteCharging(ids: List<Long>): Result<JsonElement> = chargingRepository.bulkDeleteCharging(ids)
    }
