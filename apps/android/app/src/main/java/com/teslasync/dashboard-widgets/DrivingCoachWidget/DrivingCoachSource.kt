// The data port the Driving Coach widget binds to — the native analogue of the web `useDrivingCoach` +
// `useVehicles` hook composition (web/src/features/dashboard/widgets/DrivingCoachWidget.tsx). The view
// never performs HTTP; a concrete adapter over the shared S8 Driving/Vehicles state holders (or a test
// fake) drives this seam, mirroring the sibling `ChargingOptimizerSource`. Cache-then-network freshness is
// preserved end to end (ADR-013): each emission's cached/stale/error flags flow through unchanged, and the
// raw snake_case JSON body is parsed into a [DrivingCoachReport] at this boundary so the composable and
// view-model work on a typed model.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DrivingCoachWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivingcoach

import io.teslasync.shared.core.data.repo.DrivingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the cache-then-network `GET /analytics/driving-coach?vehicle_id=&days=` snapshots the widget
 * renders, already parsed into a [DrivingCoachReport]. A single-method seam so the view-model depends on an
 * abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
fun interface DrivingCoachSource {
    /** The cache-then-network coach feed (cached value first for an instant cold start, then refreshed). */
    fun coach(): Flow<Resource<DrivingCoachReport>>
}

/**
 * Parses a raw `Resource<JsonElement>` emission into a `Resource<DrivingCoachReport>`, preserving every
 * freshness flag (cached / fetchedAt / stale / error). A resolved body with no coach data collapses to an
 * empty report so the view shows the "No tips available" state (web `!data` parity). Pure so the
 * parse-and-preserve contract is unit-tested without a network or cache.
 */
internal fun Resource<JsonElement>.mapToReport(): Resource<DrivingCoachReport> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let(DrivingCoachReport::fromJson), fetchedAt, stale)

        is Resource.Success ->
            Resource.Success(DrivingCoachReport.fromJson(data), fetchedAt, stale)

        is Resource.Error ->
            Resource.Error(cached?.let(DrivingCoachReport::fromJson), fetchedAt, stale, error)
    }

/**
 * Binds the widget to the shared **S8** [DrivingStore] coach feed for an explicit [vehicleId] over a
 * [days] window (web `useDrivingCoach(days = 30)`) — the memoized, multi-observer feed every Driving
 * surface shares. The live value (incl. the store's background refresh) flows through unchanged. No HTTP
 * touches the view.
 */
fun DrivingStore.asDrivingCoachSource(
    vehicleId: Long,
    days: Int = DrivingRepository.DEFAULT_COACH_DAYS,
): DrivingCoachSource = DrivingCoachSource { drivingCoach(vehicleId.toString(), days).map { it.mapToReport() } }

/**
 * Binds the widget to the shared **S8** [DrivingStore] coach feed with web-faithful vehicle resolution:
 * the coach is scoped to [explicitVehicleId] when supplied, otherwise the first enrolled vehicle from the
 * shared [VehiclesStore] (the native analogue of the web `vehicleId ?? vehicles?.[0]?.id` plus
 * `enabled: !!vehicleId`). With no vehicle available the feed short-circuits to an empty report — the
 * disabled-query parity — so the widget renders its "No tips available" state rather than spinning. No
 * HTTP touches the view.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun DrivingStore.asDrivingCoachSource(
    vehicles: VehiclesStore,
    explicitVehicleId: Long? = null,
    days: Int = DrivingRepository.DEFAULT_COACH_DAYS,
): DrivingCoachSource =
    DrivingCoachSource {
        vehicles.vehicles().flatMapLatest { vehiclesResource ->
            val resolved = explicitVehicleId ?: vehiclesResource.cached?.firstOrNull()?.id
            if (resolved == null) {
                flowOf(Resource.Success(DrivingCoachReport.Empty, 0L, stale = false))
            } else {
                drivingCoach(resolved.toString(), days).map { it.mapToReport() }
            }
        }
    }

/**
 * Binds the widget to the shared **S7** [DrivingRepository] coach feed for an explicit [vehicleId] — the
 * cold cache-then-network `Flow` the S8 [DrivingStore] also wraps. Use this when a host wants a dedicated
 * (non-shared) collection. No HTTP touches the view.
 */
fun DrivingRepository.asDrivingCoachSource(
    vehicleId: Long,
    days: Int = DrivingRepository.DEFAULT_COACH_DAYS,
): DrivingCoachSource = DrivingCoachSource { drivingCoach(vehicleId.toString(), days).map { it.mapToReport() } }
