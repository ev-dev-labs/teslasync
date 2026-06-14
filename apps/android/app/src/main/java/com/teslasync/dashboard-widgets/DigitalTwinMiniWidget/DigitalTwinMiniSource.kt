// The data port the Digital Twin Mini widget binds to — the native analogue of the four web hooks the
// component composes: `useVehicles` (to resolve the rendered vehicle + its exterior colour),
// `useVehicleState` (its last-known state — lock / sentry / charging / driving), `useSecurityLatest` and
// `useChargingTelemetryLatest` (the raw snapshots merged into the twin's physical state). See
// web/src/features/dashboard/widgets/DigitalTwinMiniWidget.tsx + web/src/api/hooks/useVehicles.ts. The
// view never performs HTTP; a concrete adapter over the shared Vehicles data layer (or a test fake)
// drives this seam, and cache-then-network freshness is preserved end to end (ADR-013).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DigitalTwinMiniWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.digitaltwinmini

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DigitalTwinMiniWidgetViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store/repository or the network. [vehicles] resolves the
 * rendered vehicle (web `useVehicles`); [vehicleState] is its cache-then-network last-known state (web
 * `useVehicleState`, the freshness source); [security] and [charging] are the raw latest snapshots (web
 * `useSecurityLatest` / `useChargingTelemetryLatest`) merged into the twin. No HTTP touches the view.
 */
interface DigitalTwinMiniSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the rendered vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network state envelope (web `useVehicleState`) — the freshness source. */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** Stream one vehicle's latest security snapshot (web `useSecurityLatest`). */
    fun security(vehicleId: Long): Flow<Resource<JsonElement>>

    /** Stream one vehicle's latest charging-telemetry snapshot (web `useChargingTelemetryLatest`). */
    fun charging(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting these feeds performs a genuine cache-then-network re-fetch,
 * which is what backs the widget's manual refresh/retry affordance (the web `useVehicleState().refetch()`).
 * No HTTP touches the view.
 */
fun VehiclesRepository.asDigitalTwinMiniSource(): DigitalTwinMiniSource {
    val repo = this
    return object : DigitalTwinMiniSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = repo.securityLatest(vehicleId)

        override fun charging(vehicleId: Long): Flow<Resource<JsonElement>> = repo.chargingTelemetryLatest(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every
 * vehicle surface shares app-wide. Use this when a host wants the widget to fold into the same shared
 * collections as the rest of the app; the live values flow through unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asDigitalTwinMiniSource(): DigitalTwinMiniSource {
    val store = this
    return object : DigitalTwinMiniSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = store.securityLatest(vehicleId)

        override fun charging(vehicleId: Long): Flow<Resource<JsonElement>> = store.chargingTelemetryLatest(vehicleId)
    }
}
