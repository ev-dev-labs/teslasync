// The data port the Vehicle Hero widget binds to — the native analogue of the three web hooks the widget
// composes: `useVehicles` (to resolve the rendered vehicle's identity), `useVehicleState` (its last-known
// battery / range / temps / charge), and `useVehicleLive` (the live signals the firmware string is derived
// from). See web/src/features/dashboard/widgets/VehicleHeroWidget.tsx + web/src/hooks/useVehicleLive.ts. The
// view never performs HTTP/SSE directly; a concrete adapter over the shared Vehicles data layer (S7/S8) and
// the app-scoped live session (ADR-009) — or a test fake — drives this seam. Cache-then-network freshness is
// preserved end to end (ADR-013): the view-model projects each emission's cached/stale/error flags onto the
// render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleHeroWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehiclehero

import io.teslasync.android.data.live.LiveSessionState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive

/**
 * Streams the three feeds the widget needs: the enrolled-vehicle [vehicles] list (used to resolve the
 * rendered vehicle and its display identity — web `vehicles?.find(...) ?? vehicles?.[0]`), a per-vehicle
 * [vehicleState] envelope (the `GET /vehicles/{id}/state` feed that drives the hero body), and the
 * per-vehicle [liveFirmware] (the SSE-backed `useVehicleLive` firmware signals). A narrow three-method seam
 * so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store /
 * repository / live session or the network.
 */
interface VehicleHeroWidgetSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to resolve the vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /vehicles/{id}/state` envelope feed for [vehicleId] (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /**
     * The live firmware signals for [vehicleId] (web `useVehicleLive` → `Version` / `SoftwareUpdateVersion`).
     * Always emits at least once (starting from [LiveFirmware.Empty]) so the widget never blocks waiting on a
     * live frame; subsequent emissions overlay the merged live state.
     */
    fun liveFirmware(vehicleId: Long): Flow<LiveFirmware>
}

/**
 * Binds the widget to the shared **S8** [VehiclesStore] (the memoized cache-then-network feeds every Vehicles
 * surface shares) plus the app-scoped **live session** [live] (ADR-009; `LiveSessionStore.state`). The live
 * firmware feed projects the merged per-vehicle signals to a [LiveFirmware], de-duplicated so an unrelated
 * signal change does not re-fold the widget. No HTTP/SSE touches the view.
 */
fun VehiclesStore.asVehicleHeroWidgetSource(live: StateFlow<LiveSessionState>): VehicleHeroWidgetSource {
    val store = this
    return object : VehicleHeroWidgetSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = store.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = store.vehicleState(vehicleId)

        override fun liveFirmware(vehicleId: Long): Flow<LiveFirmware> = live.firmwareFor(vehicleId)
    }
}

/**
 * Binds the widget to the shared **S7** [VehiclesRepository] (the cold cache-then-network `Flow`s the S8
 * store also wraps) plus the app-scoped live session [live]. Re-collecting either Vehicles feed performs a
 * genuine cache-then-network re-fetch, backing the widget's refresh / error-retry affordance. No HTTP/SSE
 * touches the view.
 */
fun VehiclesRepository.asVehicleHeroWidgetSource(live: StateFlow<LiveSessionState>): VehicleHeroWidgetSource {
    val repo = this
    return object : VehicleHeroWidgetSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = repo.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = repo.vehicleState(vehicleId)

        override fun liveFirmware(vehicleId: Long): Flow<LiveFirmware> = live.firmwareFor(vehicleId)
    }
}

/** Projects the merged live session to the firmware signals for [vehicleId], emitting only on change. */
private fun StateFlow<LiveSessionState>.firmwareFor(vehicleId: Long): Flow<LiveFirmware> =
    map { session ->
        val signals = session.vehicle(vehicleId).signals
        LiveFirmware(
            version = signals.signalString(LIVE_VERSION_KEY),
            swUpdateVersion = signals.signalString(LIVE_SW_UPDATE_VERSION_KEY),
        )
    }.distinctUntilChanged()

/**
 * Reads [key] as a string signal — the web `parseSignals` `str()` guard (`typeof v === 'string' ? v : ''`):
 * only a JSON string yields its content; numbers / bools / nulls / absent keys resolve to the empty string.
 */
private fun Map<String, JsonElement>.signalString(key: String): String =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content.orEmpty()
