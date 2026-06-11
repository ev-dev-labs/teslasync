// The data port the [MotorHistoryWidgetViewModel] binds to (P1/S8 state-holder seam) — the native
// analogue of the web `MotorHistoryWidget`'s hook composition
// (web/src/features/dashboard/widgets/MotorHistoryWidget.tsx): `useVehicles` for the default vehicle id
// (web `vehicleId ?? vehicles?.[0]?.id ?? 0`), then `useMotorHistory(vid, 200)` over `GET /motor`. Each
// [stream] is a fresh cache-then-network [Resource] flow of the resolved [MotorHistorySnapshot]; the
// view never performs HTTP itself (the P1/S8 boundary). A re-collection (the ViewModel's refresh/retry)
// restarts the upstream so a manual refresh actually re-fetches.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MotorHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.motorhistory

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the cache-then-network motor-history snapshots the widget projects into its chart. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store/repository or the network.
 */
fun interface MotorHistorySource {
    /** Stream the cache-then-network motor-history snapshots, newest data following the cached value. */
    fun stream(): Flow<Resource<MotorHistorySnapshot>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] — the memoized, multi-observer feeds every
 * surface shares (web `useVehicles` + `useMotorHistory` ports). Use this when a host shares one app-wide
 * vehicles + motor feed across surfaces; the live values (incl. the store's background refresh) flow
 * through unchanged. The effective vehicle is resolved exactly like the web (`vehicleId ??
 * vehicles?.[0]?.id ?? 0`). No HTTP touches the view.
 */
fun motorHistorySource(
    vehicles: VehiclesStore,
    vehicleId: Long? = null,
    limit: Int = MotorHistoryRegistration.HISTORY_LIMIT,
): MotorHistorySource =
    MotorHistorySource {
        motorHistoryResource(vehicles.vehicles(), vehicleId) { id -> vehicles.motorHistory(id, limit) }
    }

/**
 * Binds the surface to the shared **S7** [VehiclesRepository] — the cold cache-then-network `Flow`s the
 * S8 store also wraps. Each [MotorHistorySource.stream] starts new `repository` collections, so the
 * ViewModel's refresh/retry trigger a genuine cache-then-network re-fetch (web `refetch()`). No HTTP
 * touches the view.
 */
fun motorHistorySource(
    vehicles: VehiclesRepository,
    vehicleId: Long? = null,
    limit: Int = MotorHistoryRegistration.HISTORY_LIMIT,
): MotorHistorySource =
    MotorHistorySource {
        motorHistoryResource(vehicles.vehicles(), vehicleId) { id -> vehicles.motorHistory(id, limit) }
    }

/**
 * Composes the vehicles feed with the per-vehicle motor-history feed into one cache-then-network
 * [Resource] of a [MotorHistorySnapshot]. The effective vehicle id is resolved exactly like the web
 * (`vehicleId ?? vehicles?.[0]?.id ?? 0`); when none resolves (`id <= 0`, the web disabled-query
 * sentinel `enabled: vehicleId > 0`) the motor feed is never started and the vehicles resource is mapped
 * to the empty snapshot (which renders the "No motor history" empty state). Otherwise the motor resource
 * is mapped through directly, so the surface's freshness mirrors the web widget's motor-history query.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun motorHistoryResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    explicitVehicleId: Long?,
    history: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<MotorHistorySnapshot>> =
    vehicles.flatMapLatest { vehiclesRes ->
        val id = resolveVehicleId(explicitVehicleId, vehiclesRes.cached)
        if (id <= 0L) {
            flowOf(vehiclesRes.toNoVehicleSnapshot())
        } else {
            history(id).map { it.toMotorSnapshot() }
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
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<MotorHistorySnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { MotorHistorySnapshot.EMPTY }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(MotorHistorySnapshot.EMPTY, fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { MotorHistorySnapshot.EMPTY }, fetchedAt, stale, error)
    }

/** Maps a motor-history [Resource] to a [MotorHistorySnapshot], preserving cache-then-network freshness. */
private fun Resource<JsonElement>.toMotorSnapshot(): Resource<MotorHistorySnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { MotorHistorySnapshot.fromJson(it) }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(MotorHistorySnapshot.fromJson(data), fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { MotorHistorySnapshot.fromJson(it) }, fetchedAt, stale, error)
    }
