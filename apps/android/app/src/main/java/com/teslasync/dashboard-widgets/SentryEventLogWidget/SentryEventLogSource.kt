// The data port the [SentryEventLogWidgetViewModel] binds to (P1/S8 state-holder seam) — the native
// analogue of the web `SentryEventLogWidget`'s hook composition
// (web/src/features/dashboard/widgets/SentryEventLogWidget.tsx): `useVehicles` for the default vehicle id
// (web `vehicleId ?? vehicles?.[0]?.id ?? 0`), then the `useQuery(['security-events', id])` read over
// `GET /security?vehicle_id={id}`. On the shared side that endpoint is the array-guarded
// `AdminStore.securityEvents` / `AdminRepository.securityEvents` feed (the same `GET /security` the web
// SecurityEvents surfaces use), so this seam folds the vehicles feed with that security feed. The view
// never performs HTTP itself (the P1/S8 boundary); a re-collection (the ViewModel's refresh/retry)
// restarts the upstream so a manual refresh actually re-fetches.
//
// The web query caps the fetch with `&limit=eventLimit`; the shared feed has no limit parameter, so the
// per-footprint cap is applied client-side in [SentryEventLogProjection] — the same place the shared web
// `WidgetEventFeed` applies its `maxItems` slice, so the rendered row count is identical.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SentryEventLogWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.sentryeventlog

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the cache-then-network sequence of parsed security-event snapshots the widget renders. A
 * single-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a
 * concrete store/repository or the network.
 */
fun interface SentryEventLogSource {
    /** Stream the cache-then-network `/security` snapshots, newest data following the cached value. */
    fun stream(): Flow<Resource<SentryEventLogSnapshot>>
}

/**
 * Binds the surface to the shared **S8** holders — the [AdminStore.securityEvents] `GET /security` feed
 * (web `useQuery(['security-events', …])`) scoped to the vehicle resolved from the app-wide
 * [VehiclesStore.vehicles] list (web `useVehicles`). Use this when a host shares one app-wide vehicles +
 * security feed across surfaces; the live values (incl. the store's background refresh) flow through
 * unchanged. The effective vehicle is resolved exactly like the web (`vehicleId ?? vehicles?.[0]?.id ??
 * 0`). No HTTP touches the view.
 */
fun sentryEventLogSource(
    admin: AdminStore,
    vehicles: VehiclesStore,
    vehicleId: Long? = null,
): SentryEventLogSource =
    SentryEventLogSource {
        sentryEventLogResource(vehicles.vehicles(), vehicleId) { id -> admin.securityEvents(id.toString()) }
    }

/**
 * Binds the surface to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Each [SentryEventLogSource.stream] starts new `repository` collections, so the ViewModel's
 * refresh/retry trigger a genuine cache-then-network re-fetch (web `refetch()`). No HTTP touches the view.
 */
fun sentryEventLogSource(
    admin: AdminRepository,
    vehicles: VehiclesRepository,
    vehicleId: Long? = null,
): SentryEventLogSource =
    SentryEventLogSource {
        sentryEventLogResource(vehicles.vehicles(), vehicleId) { id -> admin.securityEvents(id.toString()) }
    }

/**
 * Composes the vehicles feed with the per-vehicle `/security` feed into one cache-then-network [Resource]
 * of a [SentryEventLogSnapshot]. The effective vehicle id is resolved exactly like the web (`vehicleId ??
 * vehicles?.[0]?.id ?? 0`); when none resolves (`id <= 0`, the web disabled-query sentinel `enabled: id >
 * 0`) the security feed is never started and the vehicles resource is mapped to the empty snapshot (which
 * renders the "No security events recorded" empty state). Otherwise the security resource is mapped
 * through directly, so the surface's freshness mirrors the web widget's security query.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun sentryEventLogResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    explicitVehicleId: Long?,
    securityEvents: (Long) -> Flow<Resource<JsonElement>>,
): Flow<Resource<SentryEventLogSnapshot>> =
    vehicles.flatMapLatest { vehiclesRes ->
        val id = resolveVehicleId(explicitVehicleId, vehiclesRes.cached)
        if (id <= 0L) {
            flowOf(vehiclesRes.toNoVehicleSnapshot())
        } else {
            securityEvents(id).map { it.toSentrySnapshot() }
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
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<SentryEventLogSnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { SentryEventLogSnapshot.EMPTY }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(SentryEventLogSnapshot.EMPTY, fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { SentryEventLogSnapshot.EMPTY }, fetchedAt, stale, error)
    }

/** Maps a raw `/security` [Resource] to a [SentryEventLogSnapshot], preserving cache-then-network freshness. */
internal fun Resource<JsonElement>.toSentrySnapshot(): Resource<SentryEventLogSnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { SentryEventLogSnapshot.fromJson(it) }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(SentryEventLogSnapshot.fromJson(data), fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { SentryEventLogSnapshot.fromJson(it) }, fetchedAt, stale, error)
    }
