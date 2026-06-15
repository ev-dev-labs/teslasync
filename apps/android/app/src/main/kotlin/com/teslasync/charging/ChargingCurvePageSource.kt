// The data seam the ChargingCurvePage surface binds to, plus its production binding over the shared-core charging
// repository and the app-scoped active-vehicle selection. The view (composable) performs NO HTTP — it only
// collects state from the view-model, which drives this seam, reproducing the web page's single read
// (`useChargingSessionsPaginated(activeVehicleId, { limit: 200, start, end })`) and the global `useSelectedVehicle`
// scope.
//
// The sessions feed is the shared-core cache-then-network `Resource` stream the S7 [ChargingRepository] already
// exposes (`GET /charging?vehicle_id&limit&offset[&start][&end]` ▸ `sessionsPaginated`). The Android DI graph
// ([io.teslasync.android.data.DataContainer]) wires no ChargingStore yet, so the host constructs the shared
// [io.teslasync.shared.core.data.repo.HttpChargingRepository] over the SAME resilient client + offline cache the
// other repositories use (so the ADR-013 freshness contract + SI-verbatim caching are identical) and hands it in
// here. A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.charging.chargingcurve

import io.teslasync.android.data.SelectedVehicleStore
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [ChargingCurvePageViewModel] depends on so it binds to an abstraction (the shared charging
 * repository + the app-scoped selection in production, a fake in tests), never to a concrete repository or the
 * network. The sessions feed is a cache-then-network `Resource` flow (the web read hook); the selection is the
 * global active-vehicle scope. No HTTP touches the view.
 */
interface ChargingCurvePageSource {
    /** The global active-vehicle selection (web `useSelectedVehicle`), self-healing from the live vehicles list. */
    fun selectedVehicleId(): StateFlow<Long?>

    /**
     * The cache-then-network paginated `GET /charging` feed for [vehicleId] (web
     * `useChargingSessionsPaginated`). The page reads the all-range window at the web `limit: 200`.
     */
    fun sessionsPaginated(vehicleId: Long): Flow<Resource<List<ChargingSession>>>
}

/**
 * Binds the surface to the shared **S7** [ChargingRepository] + the app-scoped [SelectedVehicleStore] — the
 * memoized cache-then-network feed every charging surface shares, scoped to the active vehicle. The live values
 * flow through unchanged so the view-model renders the full state matrix (loading / content / empty / error /
 * stale / offline). No HTTP touches the view.
 */
fun chargingCurvePageSourceOf(
    chargingRepository: ChargingRepository,
    selectedVehicleStore: SelectedVehicleStore,
): ChargingCurvePageSource =
    object : ChargingCurvePageSource {
        override fun selectedVehicleId(): StateFlow<Long?> = selectedVehicleStore.selectedId

        override fun sessionsPaginated(vehicleId: Long): Flow<Resource<List<ChargingSession>>> =
            chargingRepository.sessionsPaginated(
                vehicleId = vehicleId,
                limit = ChargingCurvePageRegistration.SESSIONS_LIMIT,
                offset = 0,
                start = null,
                end = null,
            )
    }
