// The data port the Climate History widget binds to — the native analogue of the two web hooks the
// component composes: `useVehicles` (to resolve the default vehicle — web `vehicles?.[0]?.id`) and
// `useClimateHistory(vid)` (the rendered `GET /climate?vehicle_id=` history feed). See
// web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx + web/src/api/hooks/useVehicleSystems.ts.
// The view never performs HTTP; a concrete adapter over the shared S7/S8 Vehicles + VehicleSystems data
// layer (or a test fake) drives this seam. The climate-history feed stays raw SI JSON (°C) end to end
// (ADR-013); the SI→display conversion is the render boundary's job, never this layer's.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ClimateHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatehistory

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehicleSystemsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import io.teslasync.shared.core.presentation.vehiclesystems.VehicleSystemsStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [ClimateHistoryWidgetViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the
 * default vehicle (web `useVehicles`); [climateHistory] is the cache-then-network history feed (web
 * `useClimateHistory`). No HTTP touches the view.
 */
interface ClimateHistorySource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network `GET /climate` history (web `useClimateHistory`). */
    fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** holders — the memoized, multi-observer [VehiclesStore] (web
 * `useVehicles`) for the default vehicle and the [VehicleSystemsStore] (web `useClimateHistory`) for the
 * history feed. Use this when a host wants the widget to fold into the same shared collections as the
 * rest of the app; the live values (incl. the stores' background refresh) flow through unchanged. No HTTP
 * touches the view.
 */
fun climateHistorySource(
    vehicles: VehiclesStore,
    systems: VehicleSystemsStore,
): ClimateHistorySource =
    object : ClimateHistorySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>> = systems.climateHistory(vehicleId)
    }

/**
 * Binds the surface to the shared **S7** repositories — the cold cache-then-network [VehiclesRepository]
 * + [VehicleSystemsRepository] feeds the S8 stores also wrap. Re-collecting either feed performs a
 * genuine cache-then-network re-fetch, which is what backs the widget's manual refresh / error-retry
 * affordance (the web `useClimateHistory().refetch()`); the view-model reproduces the standard
 * trigger ▸ re-collect pipeline over this port. No HTTP touches the view.
 */
fun climateHistorySource(
    vehicles: VehiclesRepository,
    systems: VehicleSystemsRepository,
): ClimateHistorySource =
    object : ClimateHistorySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun climateHistory(vehicleId: String): Flow<Resource<JsonElement>> = systems.climateHistory(vehicleId)
    }

/**
 * Composes the fleet list with the active vehicle's climate history into one cache-then-network
 * [Resource] of a [ClimateHistorySnapshot] — the native port of the web
 * `vid = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution feeding `useClimateHistory(vid)`. A positive
 * [preferredVehicleId] short-circuits straight to its history feed (the web vehicle list is not consulted
 * when a prop id is supplied); otherwise the first enrolled vehicle drives the feed, and when neither
 * resolves the fleet resource is folded onto an empty snapshot so the surface renders its loading / empty
 * / error state honestly (web's disabled `enabled: vid > 0` query → `data` undefined → empty). History
 * rows are decoded to chronologically sorted SI samples.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun climateHistoryResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    historyFor: (String) -> Flow<Resource<JsonElement>>,
): Flow<Resource<ClimateHistorySnapshot>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        historyFor(preferred.toString()).map { it.toSnapshot() }
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleSnapshot())
                else -> historyFor(id.toString()).map { it.toSnapshot() }
            }
        }
    }
}

/** Decodes a raw `GET /climate` [Resource] into a [ClimateHistorySnapshot], preserving the freshness flags. */
private fun Resource<JsonElement>.toSnapshot(): Resource<ClimateHistorySnapshot> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let { it.toSnapshot() }, fetchedAt, stale)

        is Resource.Success ->
            Resource.Success(data.toSnapshot(), fetchedAt, stale)

        is Resource.Error ->
            Resource.Error(cached?.let { it.toSnapshot() }, fetchedAt, stale, error)
    }

private fun JsonElement.toSnapshot(): ClimateHistorySnapshot = ClimateHistorySnapshot.ofSamples(parseClimateSamples(this))

/** Folds a fleet-list [Resource] onto an empty-history snapshot, preserving loading / empty / error. */
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<ClimateHistorySnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { ClimateHistorySnapshot.EMPTY }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(ClimateHistorySnapshot.EMPTY, fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let { ClimateHistorySnapshot.EMPTY }, fetchedAt, stale, error)
    }
