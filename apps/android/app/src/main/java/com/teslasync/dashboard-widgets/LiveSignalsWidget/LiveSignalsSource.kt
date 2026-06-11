// The data port the Live Signals widget binds to — the native analogue of the five web hooks the component
// composes: `useVehicles` (to resolve the default vehicle) plus `useMotorLatest` / `useClimateLatest` /
// `useSecurityLatest` / `useLatestTirePressure` (the four rendered feeds). See
// web/src/features/dashboard/widgets/LiveSignalsWidget.tsx + web/src/api/hooks/useVehicles.ts. The view
// never performs HTTP; a concrete adapter over the shared Vehicles data layer (or a test fake) drives this
// seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model projects each
// emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LiveSignalsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.livesignals

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the five cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`) and the
 * four per-vehicle "latest" snapshots the grid renders ([motorLatest], [climateLatest], [securityLatest],
 * [tirePressureLatest]). A narrow seam so the view-model depends on an abstraction (real adapter ↔ test
 * fake), never on a concrete store/repository or the network. Every snapshot is carried as the raw SI
 * [JsonElement] the backend serves; display conversion is the render boundary's job (S5), never this seam's.
 */
interface LiveSignalsSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /motor/latest?vehicle_id={id}` feed (web `useMotorLatest`). */
    fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /climate/latest?vehicle_id={id}` feed (web `useClimateLatest`). */
    fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /security/latest?vehicle_id={id}` feed (web `useSecurityLatest`). */
    fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /tire-pressure/latest?vehicle_id={id}` feed (web `useLatestTirePressure`). */
    fun tirePressureLatest(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** [VehiclesRepository] — the cold cache-then-network `Flow`s the S8
 * [VehiclesStore] also wraps. Re-collecting any feed performs a genuine cache-then-network re-fetch, which
 * is what backs the widget's manual refresh / error-retry affordance. No HTTP touches the view.
 */
fun VehiclesRepository.asLiveSignalsSource(): LiveSignalsSource {
    val repo = this
    return object : LiveSignalsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> = repo.motorLatest(vehicleId)

        override fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>> = repo.climateLatest(vehicleId)

        override fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>> = repo.securityLatest(vehicleId)

        override fun tirePressureLatest(vehicleId: Long): Flow<Resource<JsonElement>> = repo.latestTirePressure(vehicleId)
    }
}

/**
 * Binds the widget to the shared **S8** [VehiclesStore] — the memoized, multi-observer feeds every Vehicles
 * surface shares. Use this when a host wants the widget to fold into the same shared collections as the rest
 * of the app; the live values (incl. the store's background refresh) flow through unchanged. No HTTP touches
 * the view.
 */
fun VehiclesStore.asLiveSignalsSource(): LiveSignalsSource {
    val store = this
    return object : LiveSignalsSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun motorLatest(vehicleId: Long): Flow<Resource<JsonElement>> = store.motorLatest(vehicleId)

        override fun climateLatest(vehicleId: Long): Flow<Resource<JsonElement>> = store.climateLatest(vehicleId)

        override fun securityLatest(vehicleId: Long): Flow<Resource<JsonElement>> = store.securityLatest(vehicleId)

        override fun tirePressureLatest(vehicleId: Long): Flow<Resource<JsonElement>> = store.latestTirePressure(vehicleId)
    }
}
