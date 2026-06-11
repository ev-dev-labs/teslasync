// The data port the ChargingSessionDetail widget binds to — the native analogue of the web
// `useVehicles` + `useChargingSessions` + `useChargingSessionDetail` + `useChargeTelemetry` hook
// composition (web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx), mirroring the WinUI
// `IChargingSessionDetailSource` seam. The view never performs HTTP; a concrete adapter over the shared
// S8 state holders (or a test fake) drives this seam. Cache-then-network freshness is preserved end to
// end (ADR-013): the session-detail feed drives the loading/cached/stale/offline/error surface, and the
// telemetry feed is folded in best-effort (never failing the surface, exactly as the web
// `useChargeTelemetry` is supplementary to `useChargingSessionDetail`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingSessionDetailWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingsessiondetail

import io.teslasync.shared.core.api.generated.ChargeTelemetryReading
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.charging.ChargingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/**
 * Streams the cache-then-network snapshots the widget renders: the latest charging session's detail plus
 * its telemetry for the primary (or explicit) vehicle. A single-method seam so the view-model depends on
 * an abstraction (real adapter ↔ test fake), never on a concrete store or the network.
 */
fun interface ChargingSessionDetailSource {
    /** The cache-then-network session-detail feed (cached value first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<ChargingSessionDetailSnapshot>>
}

/**
 * Binds the widget to the shared **S8** [VehiclesStore] + [ChargingStore] holders — the same memoized
 * cache-then-network feeds every Vehicles/Charging surface shares. It composes the web hook chain:
 * resolve the vehicle id (web `vehicleId ?? vehicles?.[0]?.id`), then the newest session id by `started_at`
 * (web `latestSessionId`), then combine that session's detail (the primary freshness/error/empty source)
 * with its telemetry (supplementary, best-effort). When no vehicle or no session resolves, the stream
 * yields a detail-less snapshot — the web `!detail` empty gate. No HTTP touches the view.
 *
 * @param vehicles the shared Vehicles holder (web `useVehicles`).
 * @param charging the shared Charging holder (web `useChargingSessions`/`useChargingSessionDetail`/`useChargeTelemetry`).
 * @param vehicleId an explicit vehicle id; when null the first enrolled vehicle is used.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun chargingSessionDetailSource(
    vehicles: VehiclesStore,
    charging: ChargingStore,
    vehicleId: Long? = null,
): ChargingSessionDetailSource =
    ChargingSessionDetailSource {
        vehicles.vehicles().flatMapLatest { vehiclesRes ->
            val vid = vehicleId ?: ChargingSessionDetailProjection.firstVehicleId(vehiclesRes.cached)
            if (vid == null || vid <= 0L) {
                flowOf(resolutionResource(vehiclesRes))
            } else {
                charging.sessions(vid).flatMapLatest { sessionsRes ->
                    when (val sessionId = ChargingSessionDetailProjection.latestSessionId(sessionsRes.cached)) {
                        null -> flowOf(resolutionResource(sessionsRes))
                        else ->
                            combine(
                                charging.sessionDetail(sessionId),
                                charging.chargeTelemetry(sessionId),
                            ) { detailRes, telemetryRes -> mergeSnapshot(detailRes, telemetryRes) }
                    }
                }
            }
        }
    }

/**
 * Map an upstream resolution feed (vehicles or sessions) onto the snapshot surface when no detail can be
 * reached yet: a genuine first load (loading with nothing cached) stays [Resource.Loading] so the skeleton
 * shows; any resolved state with no usable vehicle/session collapses to a detail-less [Resource.Success]
 * — the web `!detail` empty gate — preserving the upstream freshness stamp.
 */
internal fun resolutionResource(resource: Resource<*>): Resource<ChargingSessionDetailSnapshot> =
    if (resource is Resource.Loading && resource.cached == null) {
        Resource.Loading(cached = null, fetchedAt = null, stale = false)
    } else {
        Resource.Success(
            data = ChargingSessionDetailSnapshot(detail = null),
            fetchedAt = resource.fetchedAtOrZero(),
            stale = false,
        )
    }

/**
 * Combine the primary session-detail feed with the supplementary telemetry feed into one snapshot feed.
 * The detail drives the [Resource] kind + freshness (loading/cached/stale/offline/error); the telemetry is
 * best-effort — its cached value rides along and its failures never fail the surface (web parity: an empty
 * telemetry result simply yields no curve and a peak of 0).
 */
internal fun mergeSnapshot(
    detailRes: Resource<ChargingSession>,
    telemetryRes: Resource<List<ChargeTelemetryReading>>,
): Resource<ChargingSessionDetailSnapshot> {
    val telemetry = telemetryRes.cached ?: emptyList()
    return when (detailRes) {
        is Resource.Loading ->
            Resource.Loading(
                cached = detailRes.cached?.let { ChargingSessionDetailSnapshot(it, telemetry) },
                fetchedAt = detailRes.fetchedAt,
                stale = detailRes.stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = ChargingSessionDetailSnapshot(detailRes.data, telemetry),
                fetchedAt = detailRes.fetchedAt,
                stale = detailRes.stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = detailRes.cached?.let { ChargingSessionDetailSnapshot(it, telemetry) },
                fetchedAt = detailRes.fetchedAt,
                stale = detailRes.stale,
                error = detailRes.error,
            )
    }
}

private fun Resource<*>.fetchedAtOrZero(): Long =
    when (this) {
        is Resource.Loading -> fetchedAt ?: 0L
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt ?: 0L
    }
