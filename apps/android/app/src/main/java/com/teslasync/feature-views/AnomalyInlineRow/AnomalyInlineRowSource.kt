// The data port the AnomalyInlineRow feature view binds to — the native analogue of the web `useVehicles`
// hook plus the inline `useQuery('/analytics/anomalies?vehicle_id=…&days=1')` the component owns
// (web/src/features/system/components/status/AnomalyInlineRow.tsx + web/src/api/hooks/useVehicles.ts +
// useAnomalies.ts; P1/S8 state-holder boundary). [vehicles] supplies the active-vehicle id (web
// `vehicles?.[0]?.id`); [anomalies] is the cache-then-network `/analytics/anomalies` envelope (a raw
// `JsonElement`, exactly as the shared `AnomaliesStore` serves it). The view never performs HTTP itself, and
// a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AnomalyInlineRow) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located adapter/composer declarations alongside the namesake interface.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.anomalyinlinerow

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AnomaliesRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.anomalies.AnomaliesStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [AnomalyInlineRowViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle
 * (web `vehicles?.[0]?.id`); [anomalies] is the cache-then-network anomaly feed the web component queries
 * (its inline `useQuery`, web default `days=1`). No HTTP touches the view.
 */
interface AnomalyInlineRowSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network `/analytics/anomalies?vehicle_id=…&days={days}` envelope. */
    fun anomalies(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [AnomaliesStore] — the memoized, multi-observer
 * holders every vehicle / anomaly surface shares app-wide (the [AnomaliesStore] already reproduces the web
 * `enabled: vehicleId !== null` gate). Use this when a host wants the row to fold into the same shared feeds
 * as the rest of the app. No HTTP touches the view.
 */
fun anomalyInlineRowSource(
    vehicles: VehiclesStore,
    anomalies: AnomaliesStore,
): AnomalyInlineRowSource =
    object : AnomalyInlineRowSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun anomalies(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = anomalies.anomalies(vehicleId, days)
    }

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] + [AnomaliesRepository] — the cold
 * cache-then-network feeds the S8 stores also wrap. Re-collecting these feeds performs a genuine
 * cache-then-network re-fetch, which backs the surface's refresh/retry affordance (the web query's
 * `refetch()`): the view-model reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP
 * touches the view.
 */
fun anomalyInlineRowSource(
    vehicles: VehiclesRepository,
    anomalies: AnomaliesRepository,
): AnomalyInlineRowSource =
    object : AnomalyInlineRowSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun anomalies(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = anomalies.anomalies(vehicleId, days)
    }

/**
 * Composes the fleet list with the first enrolled vehicle's anomaly envelope into one cache-then-network
 * [Resource] stream — the native port of the web `firstVehicleId = vehicles?.[0]?.id` resolution feeding the
 * inline `useQuery` (gated `enabled: firstVehicleId !== null`). When no vehicle resolves, the fleet resource
 * is folded onto a no-envelope ([JsonNull]) value so the surface renders its loading / empty / error state
 * honestly (the web's disabled query → `data` undefined → the row's null branch, rendered here as the benign
 * "No anomalies" empty row).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun anomalyInlineResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    days: Int,
    anomaliesFor: (String, Int) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> =
    vehicles.flatMapLatest { vehiclesRes ->
        when (val id = firstVehicleId(vehiclesRes.cached)) {
            null -> flowOf(vehiclesRes.toNoVehicleAnomalies())
            else -> anomaliesFor(id, days)
        }
    }

/** The first enrolled vehicle's id as a string, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
internal fun firstVehicleId(vehicles: List<Vehicle>?): String? = vehicles?.firstOrNull()?.id?.toString()

/** Folds a fleet-list [Resource] onto a no-envelope anomaly value, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleAnomalies(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
