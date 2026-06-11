// File hosts the BatteryRadialGauge data seam, its shared-store binding and the cache-then-network
// adapter that composes the fleet list with the active vehicle's state; named after the surface bundle
// (BatteryRadialGaugeWidget*) rather than the single interface it declares.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.batteryradialgauge

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * The data port the [BatteryRadialGaugeWidgetViewModel] binds to — the Android analogue of the web
 * `useVehicles` + `useVehicleState` hook pair the widget composes (P1/S8 state-holder boundary).
 * [vehicles] supplies the fallback active-vehicle id; [vehicleState] is a fresh cache-then-network
 * [Resource] of one vehicle's last-known state; [refresh] re-fetches that vehicle. The view never
 * performs HTTP itself, and a test fake stands in for the whole domain.
 */
interface BatteryRadialGaugeSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network state envelope (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** Re-fetch the given vehicle (web `useVehicleState().refetch()` affordance). */
    suspend fun refresh(vehicleId: Long)
}

/**
 * Binds the surface to the shared S8 [VehiclesStore] — the holder both `vehicles()` and
 * `vehicleState()` already share app-wide. [refresh] delegates to the store's per-vehicle refresh
 * (the same `refreshVehicle` the vehicle-detail screen uses); the live `vehicle-state` feed trigger is
 * private to the store, so the per-vehicle refresh is the public re-fetch affordance available here.
 */
fun batteryRadialGaugeSource(store: VehiclesStore): BatteryRadialGaugeSource =
    object : BatteryRadialGaugeSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)

        override suspend fun refresh(vehicleId: Long) {
            store.refreshVehicle(vehicleId.toString())
        }
    }

/** The resolved-no-vehicle envelope (web `useVehicleState(0)` returns `{ state: undefined }` ⇒ empty). */
private val EMPTY_VEHICLE_STATE: VehicleStateEnvelope = VehicleStateEnvelope(state = null, live = false)

/**
 * Composes the fleet list with the active vehicle's state into one cache-then-network [Resource]
 * stream — the native port of the web `id = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution feeding
 * `useVehicleState(id)`. A positive [preferredVehicleId] short-circuits straight to its state feed
 * (the web vehicle-list is not consulted when a prop id is supplied); otherwise the first enrolled
 * vehicle drives the state feed, and when neither resolves the fleet resource is folded onto a
 * no-vehicle envelope so the surface renders its loading / empty / error state honestly.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun batteryRadialGaugeResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    stateFor: (Long) -> Flow<Resource<VehicleStateEnvelope>>,
): Flow<Resource<VehicleStateEnvelope>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        stateFor(preferred)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleState())
                else -> stateFor(id)
            }
        }
    }
}

/** Folds a fleet-list [Resource] onto a no-vehicle state envelope, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleState(): Resource<VehicleStateEnvelope> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(EMPTY_VEHICLE_STATE, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
