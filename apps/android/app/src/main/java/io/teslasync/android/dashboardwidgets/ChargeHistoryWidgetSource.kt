// File hosts the ChargeHistory data seam + its shared-layer bindings; named after the surface bundle
// (ChargeHistoryWidget*) rather than the single interface it declares.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets

import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.charging.ChargingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * The data port the [ChargeHistoryWidgetViewModel] binds to — the Android analogue of the web
 * `ChargeHistoryWidget`'s hook composition (`web/src/features/dashboard/widgets/ChargeHistoryWidget.tsx`):
 * `useVehicles` for the default vehicle id, then the recent-10 `useQuery` over `GET /charging`. Each
 * [stream] is a fresh cache-then-network [Resource] flow of the resolved [ChargeHistorySnapshot]; the
 * view never performs HTTP itself (P1/S8 state-holder boundary). A re-collection (the ViewModel's
 * refresh/retry) restarts a fresh upstream so a manual refresh actually re-fetches.
 */
fun interface ChargeHistorySource {
    /** Stream the cache-then-network charge-history snapshots, newest data following cache. */
    fun stream(): Flow<Resource<ChargeHistorySnapshot>>
}

/**
 * Binds the surface to the shared S8 [VehiclesStore] + [ChargingStore] holders (web `useVehicles` +
 * `useChargingSessionsPaginated` ports). Use this when a host shares one app-wide vehicles/charging
 * feed across surfaces; every observer folds into a single upstream collection. Because the store
 * feeds are hot and shared, a refresh re-collection replays the shared value rather than forcing a new
 * fetch — host-driven invalidation / re-subscription refreshes them.
 */
fun chargeHistorySource(
    vehicles: VehiclesStore,
    charging: ChargingStore,
    vehicleId: Long? = null,
): ChargeHistorySource =
    ChargeHistorySource {
        chargeHistoryResource(vehicles.vehicles(), vehicleId) { id ->
            charging.sessionsPaginated(id, RECENT_SESSIONS_LIMIT)
        }
    }

/**
 * Binds the surface to the shared S7 [VehiclesRepository] + [ChargingRepository] ports — the same
 * cache-then-network data ports the S8 stores wrap. Each [ChargeHistorySource.stream] starts new
 * `repository` collections, so the ViewModel's refresh/retry trigger a real re-fetch (web `refetch()`).
 */
fun chargeHistorySource(
    vehicles: VehiclesRepository,
    charging: ChargingRepository,
    vehicleId: Long? = null,
): ChargeHistorySource =
    ChargeHistorySource {
        chargeHistoryResource(vehicles.vehicles(), vehicleId) { id ->
            charging.sessionsPaginated(id, RECENT_SESSIONS_LIMIT)
        }
    }

/**
 * Composes the vehicles feed with the per-vehicle recent-charging feed into one cache-then-network
 * [Resource] of a [ChargeHistorySnapshot]. The effective vehicle id is resolved exactly like the web
 * (`vehicleId ?? vehicles?.[0]?.id ?? 0`); when none resolves (`id <= 0`, the web disabled-query
 * sentinel) the charging feed is never started and the vehicles resource is mapped to the empty
 * snapshot (which renders the "no charge sessions" empty state). Otherwise the charging resource is
 * mapped through directly, so the surface's freshness mirrors the web widget's charging-query freshness.
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun chargeHistoryResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    explicitVehicleId: Long?,
    sessions: (Long) -> Flow<Resource<List<ChargingSession>>>,
): Flow<Resource<ChargeHistorySnapshot>> =
    vehicles.flatMapLatest { vehiclesRes ->
        val id = resolveVehicleId(explicitVehicleId, vehiclesRes.cached)
        if (id <= 0L) {
            flowOf(vehiclesRes.toNoVehicleSnapshot())
        } else {
            sessions(id).map { it.toChargeSnapshot() }
        }
    }

/** Maps a vehicles [Resource] to the no-vehicle snapshot, preserving the loading/stale/error freshness. */
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<ChargeHistorySnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { ChargeHistorySnapshot.EMPTY }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(ChargeHistorySnapshot.EMPTY, fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { ChargeHistorySnapshot.EMPTY }, fetchedAt, stale, error)
    }

/** Maps a charging-sessions [Resource] to a [ChargeHistorySnapshot], preserving cache-then-network freshness. */
private fun Resource<List<ChargingSession>>.toChargeSnapshot(): Resource<ChargeHistorySnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let { ChargeHistorySnapshot.fromSessions(it) }, fetchedAt, stale)
        is Resource.Success -> Resource.Success(ChargeHistorySnapshot.fromSessions(data), fetchedAt, stale = false)
        is Resource.Error -> Resource.Error(cached?.let { ChargeHistorySnapshot.fromSessions(it) }, fetchedAt, stale, error)
    }
