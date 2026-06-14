// The data port the Digital Twin widget binds to — the native analogue of the four web hooks the component
// composes: `useVehicles` (the fleet list, for the resolved vehicle + its display label / paint),
// `useVehicleState` (the typed last-known state envelope), `useSecurityLatest` (the raw latest-security
// snapshot) and `useChargingTelemetryLatest` (the raw latest charging telemetry). See
// web/src/features/dashboard/widgets/DigitalTwinWidget.tsx and web/src/api/hooks/useVehicles.ts. The view
// never performs HTTP itself; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives
// this seam, and cache-then-network freshness is preserved end to end (ADR-013).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DigitalTwinWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.digitaltwin

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DigitalTwinWidgetViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store/repository or the network. [vehicles] resolves the active vehicle
 * (web `vehicles?.[0]` / `find`); the three per-vehicle feeds back the merged twin state. No HTTP touches
 * the view.
 */
interface DigitalTwinSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the active vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network typed state envelope (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** Stream one vehicle's cache-then-network latest security snapshot (web `useSecurityLatest`). */
    fun security(vehicleId: Long): Flow<Resource<JsonElement>>

    /** Stream one vehicle's cache-then-network latest charging telemetry (web `useChargingTelemetryLatest`). */
    fun chargingTelemetry(vehicleId: Long): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network feeds the S8
 * [VehiclesStore] also wraps. Re-collecting any feed performs a genuine cache-then-network re-fetch, which
 * is what backs the widget's manual refresh affordance (the web per-hook `refetch()`): the view-model
 * reproduces the standard trigger ▸ re-collect pipeline over this port. No HTTP touches the view.
 */
fun VehiclesRepository.asDigitalTwinSource(): DigitalTwinSource {
    val repo = this
    return object : DigitalTwinSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = repo.securityLatest(vehicleId)

        override fun chargingTelemetry(vehicleId: Long): Flow<Resource<JsonElement>> = repo.chargingTelemetryLatest(vehicleId)
    }
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer holders every
 * vehicle surface shares app-wide. Use this when a host wants the widget to fold into the same shared
 * collections as the rest of the app; the live values (incl. each store's background refresh) flow through
 * unchanged. No HTTP touches the view.
 */
fun VehiclesStore.asDigitalTwinSource(): DigitalTwinSource {
    val store = this
    return object : DigitalTwinSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)

        override fun security(vehicleId: Long): Flow<Resource<JsonElement>> = store.securityLatest(vehicleId)

        override fun chargingTelemetry(vehicleId: Long): Flow<Resource<JsonElement>> = store.chargingTelemetryLatest(vehicleId)
    }
}
