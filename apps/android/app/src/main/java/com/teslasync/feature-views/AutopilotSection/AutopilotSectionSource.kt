// The data port the AutopilotSection feature view binds to — the native analogue of the web hook trio the
// component composes for one vehicle (web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx
// → `useVehicleState` + two `useSignalObservations`; P1/S8 state-holder boundary). [vehicles] supplies the
// fallback active-vehicle id; [vehicleState] is the polled live state (speed, SI m/s); [cruiseSetSpeed] and
// [followDistance] are the latest-1 observation feeds for the two cruise signals. The view never performs HTTP
// itself, and a test fake stands in for the whole domain.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AutopilotSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.autopilotsection

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SignalObservationsParams
import io.teslasync.shared.core.presentation.telemetry.SignalObservation
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf

/** The `CruiseSetSpeed` signal field read for the cruise set-speed tile (web `signal_name: 'CruiseSetSpeed'`). */
internal const val SIGNAL_CRUISE_SET_SPEED: String = "CruiseSetSpeed"

/** The `CruiseFollowDistance` signal field read for the follow-distance tile (web `'CruiseFollowDistance'`). */
internal const val SIGNAL_CRUISE_FOLLOW_DISTANCE: String = "CruiseFollowDistance"

/** Both observation feeds request only the most recent row (web `{ limit: 1 }`). */
internal const val OBSERVATION_LIMIT: Int = 1

/**
 * The single seam the [AutopilotSectionViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store/repository or the network. [vehicles] resolves the default vehicle
 * (web `vehicleId ?? vehicles?.[0]?.id`); [vehicleState] is the polled live-state feed (web `useVehicleState`);
 * [cruiseSetSpeed] / [followDistance] are the latest-1 observation feeds (web `useSignalObservations`). No HTTP
 * touches the view.
 */
interface AutopilotSectionSource {
    /** Stream the enrolled-vehicle list (web `useVehicles`), used to resolve the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream one vehicle's cache-then-network live state — speed in SI m/s (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** Stream the latest `CruiseSetSpeed` observation for [vehicleId] (web `useSignalObservations`). */
    fun cruiseSetSpeed(vehicleId: Long): Flow<Resource<List<SignalObservation>>>

    /** Stream the latest `CruiseFollowDistance` observation for [vehicleId] (web `useSignalObservations`). */
    fun followDistance(vehicleId: Long): Flow<Resource<List<SignalObservation>>>
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] (live state + fleet list) and [TelemetryStore] (the
 * signal-observations feed) — the memoized, multi-observer holders every vehicle/telemetry surface shares
 * app-wide. Re-collecting these feeds performs a genuine cache-then-network re-fetch, which backs the
 * surface's refresh/retry affordance (the web page's 5s poll + `refetch()`). No HTTP touches the view.
 */
fun bindAutopilotSectionSource(
    vehiclesStore: VehiclesStore,
    telemetryStore: TelemetryStore,
): AutopilotSectionSource =
    object : AutopilotSectionSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = vehiclesStore.vehicleState(vehicleId)

        override fun cruiseSetSpeed(vehicleId: Long): Flow<Resource<List<SignalObservation>>> =
            telemetryStore.signalObservations(
                SignalObservationsParams(vehicleId = vehicleId, signalName = SIGNAL_CRUISE_SET_SPEED, limit = OBSERVATION_LIMIT),
            )

        override fun followDistance(vehicleId: Long): Flow<Resource<List<SignalObservation>>> =
            telemetryStore.signalObservations(
                SignalObservationsParams(vehicleId = vehicleId, signalName = SIGNAL_CRUISE_FOLLOW_DISTANCE, limit = OBSERVATION_LIMIT),
            )
    }

/**
 * Composes the fleet list with one vehicle's live state + the two cruise observation feeds into a single
 * cache-then-network [Resource] stream — the native port of the web `activeId = vehicleId ?? vehicles?.[0]?.id`
 * resolution feeding the three reads. A positive [preferredVehicleId] short-circuits straight to its feeds (the
 * fleet list is not consulted when a selected id is supplied); otherwise the first enrolled vehicle drives
 * them, and when neither resolves the fleet resource is folded onto a no-reading snapshot so the surface
 * renders its loading / empty / error state honestly (web's disabled query → empty).
 */
@OptIn(ExperimentalCoroutinesApi::class)
internal fun autopilotSnapshotResource(
    vehicles: Flow<Resource<List<Vehicle>>>,
    preferredVehicleId: Long?,
    stateFor: (Long) -> Flow<Resource<VehicleStateEnvelope>>,
    cruiseFor: (Long) -> Flow<Resource<List<SignalObservation>>>,
    followFor: (Long) -> Flow<Resource<List<SignalObservation>>>,
): Flow<Resource<AutopilotSnapshot>> {
    val preferred = preferredVehicleId?.takeIf { it > 0L }
    return if (preferred != null) {
        autopilotFeeds(preferred, stateFor, cruiseFor, followFor)
    } else {
        vehicles.flatMapLatest { vehiclesRes ->
            when (val id = firstVehicleId(vehiclesRes.cached)) {
                null -> flowOf(vehiclesRes.toNoVehicleSnapshot())
                else -> autopilotFeeds(id, stateFor, cruiseFor, followFor)
            }
        }
    }
}

/** Combines the three per-vehicle feeds into one snapshot stream (web's three concurrent queries). */
private fun autopilotFeeds(
    vehicleId: Long,
    stateFor: (Long) -> Flow<Resource<VehicleStateEnvelope>>,
    cruiseFor: (Long) -> Flow<Resource<List<SignalObservation>>>,
    followFor: (Long) -> Flow<Resource<List<SignalObservation>>>,
): Flow<Resource<AutopilotSnapshot>> =
    combine(stateFor(vehicleId), cruiseFor(vehicleId), followFor(vehicleId)) { state, cruise, follow ->
        combineAutopilotSnapshot(state, cruise, follow)
    }

/**
 * Folds the three feeds' best-available values into one [AutopilotSnapshot] resource, with the polled
 * [state] feed carrying the loading / freshness / error semantics (it is the web component's live driver,
 * `refetchInterval: 5_000`) and the two observations folded in as auxiliary readings. The snapshot reads each
 * source's `cached` (which for a terminal `Success` is its data), so a tile shows immediately whenever any
 * feed has a value; an all-empty snapshot is collapsed to `null` cache so the surface honestly shows its
 * loading skeleton (Loading) or hard error (Error) rather than a populated grid.
 */
internal fun combineAutopilotSnapshot(
    state: Resource<VehicleStateEnvelope>,
    cruise: Resource<List<SignalObservation>>,
    follow: Resource<List<SignalObservation>>,
): Resource<AutopilotSnapshot> {
    val snapshot =
        AutopilotSnapshot(
            speedMps = state.cached?.state?.speed,
            cruiseSetMps = latestNumeric(cruise.cached),
            followDistanceRaw = followDistanceRawFrom(follow.cached),
        )
    val present = snapshot.takeIf { it.hasAny }
    return when (state) {
        is Resource.Loading -> Resource.Loading(cached = present, fetchedAt = state.fetchedAt, stale = state.stale)
        is Resource.Success -> Resource.Success(snapshot, fetchedAt = state.fetchedAt, stale = state.stale)
        is Resource.Error ->
            Resource.Error(cached = present, fetchedAt = state.fetchedAt, stale = state.stale, error = state.error)
    }
}

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
internal fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }

/** Folds a fleet-list [Resource] onto a no-reading snapshot, preserving loading/empty/error. */
private fun Resource<List<Vehicle>>.toNoVehicleSnapshot(): Resource<AutopilotSnapshot> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = null, fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(AutopilotSnapshot(), fetchedAt = fetchedAt, stale = stale)
        is Resource.Error -> Resource.Error(cached = null, fetchedAt = fetchedAt, stale = stale, error = error)
    }
