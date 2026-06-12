// The data port the PowertrainPanel feature view binds to — the native analogue of the latest-motor feed that
// backs the web `MotorSnapshot` prop (web/src/api/hooks/useVehicles.ts `useMotorLatest`; P1/S8 state-holder
// boundary). The web component itself is presentational — a host page resolves the active vehicle and passes
// its `useMotorLatest(id)` snapshot down as a prop (web `LiveTelemetryPanels` → `<PowertrainPanel motorData />`)
// — so this port mirrors that host wiring, exactly as the sibling `ClimatePanel` surface does: [vehicles]
// resolves the fallback active vehicle (web `vehicles?.[0]?.id`) and [motor] is the cache-then-network
// [Resource] of one vehicle's latest motor snapshot (a raw `JsonElement`, exactly as the shared layer serves
// `/motor/latest`). The view never performs HTTP itself, and a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PowertrainPanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.powertrainpanel

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/**
 * The single seam the [PowertrainPanelViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle
 * (web `vehicles?.[0]?.id`); [motor] is the cache-then-network latest-motor feed (web `useMotorLatest`). No
 * HTTP touches the view.
 */
interface PowertrainPanelSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network latest motor snapshot (web `useMotorLatest`). */
    fun motor(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch, which
 * backs the panel's refresh/retry affordance (the web page's 5s realtime poll + `useMotorLatest().refetch()`).
 * No HTTP touches the view.
 */
fun VehiclesRepository.asPowertrainPanelSource(): PowertrainPanelSource {
    val repo = this
    return object : PowertrainPanelSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun motor(vehicleId: Long): Flow<Resource<JsonElement>> = repo.motorLatest(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every vehicle
 * surface shares app-wide. Use this when a host wants the panel to fold into the same shared feeds as the rest
 * of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asPowertrainPanelSource(): PowertrainPanelSource {
    val store = this
    return object : PowertrainPanelSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun motor(vehicleId: Long): Flow<Resource<JsonElement>> = store.motorLatest(vehicleId)
    }
}

/**
 * Composes the fleet list with the active vehicle's motor snapshot into one cache-then-network [Resource]
 * stream — the native port of the host's `id = vehicleId ?? vehicles?.[0]?.id ?? 0` resolution feeding
 * `useMotorLatest(id)`. A positive [preferredVehicleId] short-circuits straight to its motor feed (the vehicle
 * list is not consulted when a prop id is supplied); otherwise the first enrolled vehicle drives the feed, and
 * when neither resolves the fleet resource is folded onto a no-snapshot ([JsonNull]) value so the surface
 * renders its loading / empty / error state honestly (the disabled `enabled: id > 0` query → undefined
 * snapshot → empty).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun powertrainPanelResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    motorFor: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<JsonElement>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        motorFor(preferred)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleMotor())
                else -> motorFor(id)
            }
        }
    }
}

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
internal fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

/** Folds a fleet-list [Resource] onto a no-snapshot motor value, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleMotor(): Resource<JsonElement> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(JsonNull, fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
