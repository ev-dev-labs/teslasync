// The data port the Charging Schedule widget binds to — the native analogue of the web component's hook
// composition (web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx: useVehicles + useVehicleState
// + useLiveSignals). The view never performs HTTP; a concrete adapter over the shared S8 data layer (or a
// test fake) drives this seam. Cache-then-network freshness is preserved end to end (ADR-013): the
// view-model projects each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingScheduleWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingschedule

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.signals.LiveSignalsResponse
import io.teslasync.shared.core.presentation.signals.SignalsStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/** `fetchedAt` stamp used for the synthetic no-vehicle empty emission (no real fetch occurred). */
private const val NO_VEHICLE_FETCHED_AT = 0L

/**
 * Streams the cache-then-network combined schedule snapshot the widget renders. A single-method seam so
 * the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store /
 * repository or the network.
 */
fun interface ChargingScheduleSource {
    /** The cache-then-network schedule feed (cached value first for an instant cold start, then refreshed). */
    fun schedule(): Flow<Resource<ChargingScheduleData>>
}

/**
 * Binds the widget to the shared **S7** repositories: it resolves the target vehicle from the enrolled
 * list (web `vehicleId ?? vehicles[0].id ?? 0`), then merges the cache-then-network `GET /signals/{id}/live`
 * feed (the primary, freshness-bearing schedule source) with the latest `GET /vehicles/{id}/state` value
 * (folded into the snapshot for the tall detail row). Re-collecting these cold feeds performs a genuine
 * cache-then-network re-fetch, which is what backs the widget's manual refresh affordance (the web
 * `refetchSignals()`). No HTTP touches the view.
 *
 * Freshness follows the live-signals feed (the web `WidgetShell` reads its `dataUpdatedAt`/`isFetching`/
 * `isStale`/`isError` from the signals query); the auxiliary state feed only contributes `state` to the
 * payload, so its load latency never blocks the schedule skeleton.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun chargingScheduleSource(
    vehicles: VehiclesRepository,
    signals: SignalsRepository,
    explicitVehicleId: Long?,
): ChargingScheduleSource =
    ChargingScheduleSource {
        vehicles.vehicles().flatMapLatest { vehiclesRes ->
            val id = resolveVehicleId(explicitVehicleId, vehiclesRes.cached)
            if (id <= 0L) {
                flowOf(Resource.Success(ChargingScheduleData.EMPTY, NO_VEHICLE_FETCHED_AT, stale = false))
            } else {
                combine(signals.liveSignals(id), vehicles.vehicleState(id)) { sig, st ->
                    combineScheduleResources(sig, st)
                }
            }
        }
    }

/**
 * Binds the widget to the shared **S8** holders — the memoized, multi-observer feeds every Vehicles /
 * Signals surface shares. Use this when a host wants the widget to fold into the same shared collections
 * as the rest of the app; the live values (incl. the stores' background refresh) flow through unchanged.
 * Vehicle resolution + signals/state merge match the repository binding above. No HTTP touches the view.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun chargingScheduleSource(
    vehicles: VehiclesStore,
    signals: SignalsStore,
    explicitVehicleId: Long?,
): ChargingScheduleSource =
    ChargingScheduleSource {
        vehicles.vehicles().flatMapLatest { vehiclesRes ->
            val id = resolveVehicleId(explicitVehicleId, vehiclesRes.cached)
            if (id <= 0L) {
                flowOf(Resource.Success(ChargingScheduleData.EMPTY, NO_VEHICLE_FETCHED_AT, stale = false))
            } else {
                combine(signals.liveSignals(id), vehicles.vehicleState(id)) { sig, st ->
                    combineScheduleResources(sig, st)
                }
            }
        }
    }

/**
 * Folds the two upstream feeds into one [Resource]: the freshness contract (loading / success / error +
 * `fetchedAt` + `stale`) follows the live-signals [signals] feed (the primary schedule source), and the
 * latest known vehicle state (cached or fresh, possibly `null`) is embedded into the payload. Pure +
 * internal so it is unit-tested without a UI host or coroutines.
 */
internal fun combineScheduleResources(
    signals: Resource<LiveSignalsResponse>,
    state: Resource<VehicleStateEnvelope>,
): Resource<ChargingScheduleData> {
    val latestState = state.cached?.state
    return signals.mapData { live -> ChargingScheduleData(live.signals, latestState) }
}

/** Transforms a [Resource]'s value while preserving its loading / success / error arm and freshness flags. */
private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }
