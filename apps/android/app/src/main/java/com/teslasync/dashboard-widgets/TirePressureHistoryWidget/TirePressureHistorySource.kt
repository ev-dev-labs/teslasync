// The data port the [TirePressureHistoryWidgetViewModel] binds to (P1/S8 state-holder seam) — the native
// analogue of the web `TirePressureHistoryWidget`'s hook composition
// (web/src/features/dashboard/widgets/TirePressureHistoryWidget.tsx): `useVehicles` for the default
// vehicle id (web `vehicleId ?? vehicles?.[0]?.id ?? 0`), then `useTirePressureHistory(vid > 0 ?
// String(vid) : '')` over `GET /tire-pressure?vehicle_id=`. Each [stream] is a fresh cache-then-network
// [Resource] flow of the resolved [TirePressureHistorySnapshot]; the view never performs HTTP itself
// (the P1/S8 boundary). A re-collection (the ViewModel's refresh/retry) restarts the upstream so a manual
// refresh actually re-fetches.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TirePressureHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tirepressurehistory

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
 * Streams the cache-then-network tire-pressure-history snapshots the widget projects into its chart. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store/repository or the network.
 */
fun interface TirePressureHistorySource {
    /** Stream the cache-then-network tire-pressure-history snapshots, newest data following the cached value. */
    fun stream(): Flow<Resource<TirePressureHistorySnapshot>>
}

/**
 * Binds the surface to the shared **S8** holders — the memoized, multi-observer feeds every surface
 * shares (web `useVehicles` + `useTirePressureHistory` ports). The vehicle is resolved from the shared
 * [vehicles] list exactly like the web (`vehicleId ?? vehicles?.[0]?.id ?? 0`) and the per-vehicle TPMS
 * history is read from the shared [systems] holder. Use this when a host shares one app-wide vehicles +
 * vehicle-systems feed across surfaces; the live values (incl. each store's background refresh) flow
 * through unchanged. No HTTP touches the view.
 */
fun tirePressureHistorySource(
    vehicles: VehiclesStore,
    systems: VehicleSystemsStore,
    vehicleId: Long? = null,
): TirePressureHistorySource =
    TirePressureHistorySource {
        tirePressureHistoryResource(vehicles.vehicles(), vehicleId) { id -> systems.tirePressureHistory(id.toString()) }
    }

/**
 * Binds the surface to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8
 * stores also wrap. Each [TirePressureHistorySource.stream] starts new `repository` collections, so the
 * ViewModel's refresh/retry trigger a genuine cache-then-network re-fetch (web `refetch()`). No HTTP
 * touches the view.
 */
fun tirePressureHistorySource(
    vehicles: VehiclesRepository,
    systems: VehicleSystemsRepository,
    vehicleId: Long? = null,
): TirePressureHistorySource =
    TirePressureHistorySource {
        tirePressureHistoryResource(vehicles.vehicles(), vehicleId) { id -> systems.tirePressureHistory(id.toString()) }
    }

/**
 * Composes the vehicles feed with the per-vehicle tire-pressure-history feed into one cache-then-network
 * [Resource] of a [TirePressureHistorySnapshot]. The effective vehicle id is resolved exactly like the
 * web (`vehicleId ?? vehicles?.[0]?.id ?? 0`); when none resolves (`id <= 0`, the web disabled-query
 * sentinel `useTirePressureHistory(vid > 0 ? String(vid) : '')`) the history feed is never started and
 * the vehicles resource is mapped to the empty snapshot (which renders the "No tire pressure history"
 * empty state). Otherwise the history resource is mapped through directly, so the surface's freshness
 * mirrors the web widget's tire-pressure-history query.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun tirePressureHistoryResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    explicitVehicleId: Long?,
    history: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<TirePressureHistorySnapshot>> =
    vehicles.flatMapLatest { vehiclesRes ->
        val id = resolveVehicleId(explicitVehicleId, vehiclesRes.cached)
        if (id <= 0L) {
            flowOf(vehiclesRes.toNoVehicleSnapshot())
        } else {
            history(id).map { it.toSnapshot() }
        }
    }

/**
 * Resolves the effective vehicle id exactly like the web `vehicleId ?? vehicles?.[0]?.id ?? 0`: an
 * [explicitVehicleId] (the widget's configured vehicle) wins when present, otherwise the first enrolled
 * vehicle's id, otherwise `0` (the disabled-query sentinel → empty state).
 */
fun resolveVehicleId(
    explicitVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long = explicitVehicleId ?: vehicles?.firstOrNull()?.id ?: 0L

/** Maps a vehicles [Resource] to the no-vehicle snapshot, preserving the loading/stale/error freshness. */
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<TirePressureHistorySnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { TirePressureHistorySnapshot.EMPTY }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(TirePressureHistorySnapshot.EMPTY, fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { TirePressureHistorySnapshot.EMPTY }, fetchedAt, stale, error)
    }

/** Maps a tire-pressure-history [Resource] to a snapshot, preserving cache-then-network freshness. */
private fun Resource<JsonElement>.toSnapshot(): Resource<TirePressureHistorySnapshot> {
    val mapped = cached?.let { TirePressureHistorySnapshot.of(parseTirePressurePoints(it)) }
    return when (this) {
        is Resource.Loading -> Resource.Loading(mapped, fetchedAt, stale)
        is Resource.Success -> Resource.Success(mapped ?: TirePressureHistorySnapshot.EMPTY, fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(mapped, fetchedAt, stale, error)
    }
}
