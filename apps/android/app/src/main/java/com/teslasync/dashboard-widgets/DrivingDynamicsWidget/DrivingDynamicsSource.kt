// The data port the Driving Dynamics widget binds to — the native analogue of the four web hooks the
// component composes: `useVehicles` (to resolve the default vehicle — web `vehicles?.[0]?.id`),
// `useDrivingDynamics` (the primary `/drives/dynamics` feed driving every gauge + the chrome) and
// `useAccelerationDistribution` (the supplementary `/drives/acceleration-distribution` feed that only
// supplies the wide histogram). See web/src/features/dashboard/widgets/DrivingDynamicsWidget.tsx +
// web/src/api/hooks/useDriving.ts. The view never performs HTTP; a concrete adapter over the shared
// S7/S8 data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to
// end (ADR-013): the primary dynamics feed drives the cached/stale/error flags while the distribution
// feed is folded in best-effort.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DrivingDynamicsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivingdynamics

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list
 * (used only to resolve the default vehicle when no explicit id is configured — web
 * `vehicles?.[0]?.id`), the per-vehicle [drivingDynamics] envelope (the primary `/drives/dynamics`
 * feed) and the per-vehicle [accelerationDistribution] envelope (the supplementary
 * `/drives/acceleration-distribution` feed). A narrow seam so the view-model depends on an abstraction
 * (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface DrivingDynamicsSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /drives/dynamics?vehicle_id={id}` feed (web `useDrivingDynamics`). */
    fun drivingDynamics(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /drives/acceleration-distribution?vehicle_id={id}` feed (web `useAccelerationDistribution`). */
    fun accelerationDistribution(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8
 * stores also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is
 * what backs the widget's manual refresh / error-retry affordance (the web `refetch()`). The vehicles
 * list lives on the [VehiclesRepository]; both dynamics feeds come from the [DrivingRepository]. No
 * HTTP touches the view.
 */
fun drivingDynamicsSource(
    vehicles: VehiclesRepository,
    driving: DrivingRepository,
): DrivingDynamicsSource =
    object : DrivingDynamicsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun drivingDynamics(vehicleId: String): Flow<Resource<JsonElement>> = driving.drivingDynamics(vehicleId)

        override fun accelerationDistribution(vehicleId: String): Flow<Resource<JsonElement>> = driving.accelerationDistribution(vehicleId)
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface
 * shares. Use this when a host wants the widget to fold into the same shared collections as the rest
 * of the app; the live values (incl. each store's background refresh) flow through unchanged. No HTTP
 * touches the view.
 */
fun drivingDynamicsSource(
    vehicles: VehiclesStore,
    driving: DrivingStore,
): DrivingDynamicsSource =
    object : DrivingDynamicsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun drivingDynamics(vehicleId: String): Flow<Resource<JsonElement>> = driving.drivingDynamics(vehicleId)

        override fun accelerationDistribution(vehicleId: String): Flow<Resource<JsonElement>> = driving.accelerationDistribution(vehicleId)
    }

/**
 * Fold the PRIMARY dynamics [Resource] together with the supplementary acceleration-distribution
 * [Resource] into a single [DrivingDynamicsBundle] [Resource], preserving every freshness flag from the
 * dynamics feed (cached / refreshing / stale / offline / error) — the native analogue of the web
 * component letting `useDrivingDynamics` drive the chrome (`error: dynError`, `isStale: dynStale`,
 * `isError: dynIsError`, the `dynamics ?` content/empty gate) while `useAccelerationDistribution` only
 * supplies the histogram. Pure, so the combine contract is unit-tested without a network or cache.
 *
 * The distribution payload is read best-effort from whatever value its feed currently holds (web
 * `distData?.values`); its own loading/error never gates the surface. To honour the web's combined
 * fetch flags (`isFetching = dynFetching || distFetching`, `updatedAt = Math.max(dynUpdatedAt,
 * distUpdatedAt)`) the merged stamp is the newest of the two feeds, and a still-in-flight distribution
 * over already-resolved dynamics surfaces as a refresh-over-cached state (content visible + refreshing
 * chip) rather than blanking the ready gauges.
 */
internal fun combineDrivingDynamics(
    dynamics: Resource<JsonElement>,
    distribution: Resource<JsonElement>,
): Resource<DrivingDynamicsBundle> {
    val distData = distribution.cached
    val distributionRefreshing = distribution is Resource.Loading
    val mergedFetchedAt = maxFetchedAt(dynamics, distribution)

    fun bundle(dyn: JsonElement?): DrivingDynamicsBundle? = dyn?.let { DrivingDynamicsBundle(it, distData) }

    return when (dynamics) {
        is Resource.Loading ->
            Resource.Loading(cached = bundle(dynamics.cached), fetchedAt = mergedFetchedAt, stale = dynamics.stale)

        is Resource.Success ->
            if (distributionRefreshing) {
                // Dynamics is ready but the histogram feed is still loading: keep the gauges visible and
                // flag the refresh (the web `isFetching` path), never a skeleton over ready content.
                Resource.Loading(
                    cached = DrivingDynamicsBundle(dynamics.data, distData),
                    fetchedAt = mergedFetchedAt,
                    stale = dynamics.stale,
                )
            } else {
                Resource.Success(
                    data = DrivingDynamicsBundle(dynamics.data, distData),
                    fetchedAt = mergedFetchedAt ?: dynamics.fetchedAt,
                    stale = dynamics.stale,
                )
            }

        is Resource.Error ->
            Resource.Error(
                cached = bundle(dynamics.cached),
                fetchedAt = mergedFetchedAt,
                stale = dynamics.stale,
                error = dynamics.error,
            )
    }
}

/** The newest `fetchedAt` stamp across the two feeds (web `Math.max(dynUpdatedAt ?? 0, distUpdatedAt ?? 0)`). */
private fun maxFetchedAt(
    a: Resource<*>,
    b: Resource<*>,
): Long? = listOfNotNull(a.fetchedAtOrNull(), b.fetchedAtOrNull()).maxOrNull()

/** The `fetchedAt` of any [Resource] variant (Loading/Error are nullable; Success is always stamped). */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }
