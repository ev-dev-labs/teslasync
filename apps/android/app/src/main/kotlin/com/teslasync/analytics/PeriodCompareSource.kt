// The data seam the PeriodComparePage analytics surface binds to, plus its production binding over the shared S8
// VehiclesStore (web `useVehicles`) and the resilient shared HTTP client (web `request()`). The view (composable)
// performs NO HTTP — it only collects state from the view-model, which drives this seam.
//
// Two reads mirror the web page exactly:
//   - [vehicles] is the shared-core cache-then-network `GET /vehicles` feed (web `useVehicles`) that fills the
//     vehicle picker; the holder shares one upstream across observers.
//   - [periodStats] is the canonical `GET /analytics/period-stats?vehicle_id&days` envelope the web page reads
//     with a raw `request()` (it is not part of the KMP analytics repository surface), modelled here as a
//     cache-then-network `Resource` flow so it folds into the same lifecycle-aware `UiState` machinery the rest
//     of the app uses: a `Loading` frame, then a terminal `Success` or `Error`.
//
// A narrow seam so the view-model depends on an abstraction (the real binding in production, a fake in tests),
// never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.periodcompare

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flow

/** The canonical period-stats route (the resilient client prepends `/api/v1` exactly once). */
private const val PERIOD_STATS_PATH: String = "/analytics/period-stats"

/** Query key for the target vehicle (snake_case, matching the backend handler). */
private const val QUERY_VEHICLE_ID: String = "vehicle_id"

/** Query key for the trailing-window day count (`0` = all time). */
private const val QUERY_DAYS: String = "days"

/**
 * The single seam the [PeriodComparePageViewModel] depends on so it binds to an abstraction (the shared Vehicles
 * holder + resilient client in production, a fake in tests), never to a concrete store or the network.
 */
interface PeriodCompareSource {
    /** The shared, refreshable `GET /vehicles` list feed (web `useVehicles`) that fills the vehicle picker. */
    fun vehicles(): StateFlow<Resource<List<Vehicle>>>

    /**
     * The canonical `GET /analytics/period-stats?vehicle_id={vehicleId}&days={days}` envelope for one trailing
     * window (web `useQuery` over a raw `request()`), emitted as a cache-then-network `Resource` flow: a
     * `Loading` frame followed by a terminal `Success` or `Error`. A fresh collection re-fetches (the web
     * `enabled`/key-change refetch).
     */
    fun periodStats(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<PeriodStats>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] (the enrolled-vehicle list) and the resilient shared
 * [ApiHttpClient] (the period-stats reads). The vehicle list flows through unchanged; each period-stats read is a
 * one-shot resilient request wrapped as a `Resource` flow so the view-model renders the full state matrix
 * (loading / content / empty / error). No HTTP touches the view.
 */
fun periodCompareSource(
    vehiclesStore: VehiclesStore,
    api: ApiHttpClient,
): PeriodCompareSource =
    object : PeriodCompareSource {
        override fun vehicles(): StateFlow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun periodStats(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<PeriodStats>> =
            flow {
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                val result =
                    api.safeRequest<PeriodStats>(
                        path = PERIOD_STATS_PATH,
                        query = mapOf(QUERY_VEHICLE_ID to vehicleId, QUERY_DAYS to days.toString()),
                    )
                val now = System.currentTimeMillis()
                result.fold(
                    onSuccess = { stats -> emit(Resource.Success(stats, fetchedAt = now, stale = false)) },
                    onFailure = { error ->
                        emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = error))
                    },
                )
            }
    }
