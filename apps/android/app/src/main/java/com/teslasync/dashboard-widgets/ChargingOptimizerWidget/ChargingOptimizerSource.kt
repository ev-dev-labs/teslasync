// The data port the Charging Optimizer widget binds to — the native analogue of the web
// `useChargingOptimizer` + `useVehicles` hook composition
// (web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx). The view never performs HTTP; a
// concrete adapter over the shared S8 Charging/Vehicles state holders (or a test fake) drives this seam,
// mirroring the WinUI `IChargingOptimizerSource` reference. Cache-then-network freshness is preserved end
// to end (ADR-013): each emission's cached/stale/error flags flow through unchanged, and the raw
// snake_case JSON body is parsed into a [ChargingOptimizerReport] at this boundary so the composable and
// view-model work on a typed model.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingOptimizerWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingoptimizer

import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.charging.ChargingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the cache-then-network `GET /analytics/charging-optimizer?vehicle_id=` snapshots the widget
 * renders, already parsed into a [ChargingOptimizerReport]. A single-method seam so the view-model depends
 * on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
fun interface ChargingOptimizerSource {
    /** The cache-then-network optimizer feed (cached value first for an instant cold start, then refreshed). */
    fun optimizer(): Flow<Resource<ChargingOptimizerReport>>
}

/**
 * Parses a raw `Resource<JsonElement>` emission into a `Resource<ChargingOptimizerReport>`, preserving
 * every freshness flag (cached / fetchedAt / stale / error). A resolved body with no optimizer data
 * collapses to an empty report so the view shows the "No optimizer data" state (web `!data` parity). Pure
 * so the parse-and-preserve contract is unit-tested without a network or cache.
 */
internal fun Resource<JsonElement>.mapToReport(): Resource<ChargingOptimizerReport> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(cached?.let(ChargingOptimizerReport::fromJson), fetchedAt, stale)

        is Resource.Success ->
            Resource.Success(ChargingOptimizerReport.fromJson(data), fetchedAt, stale)

        is Resource.Error ->
            Resource.Error(cached?.let(ChargingOptimizerReport::fromJson), fetchedAt, stale, error)
    }

/**
 * Binds the widget to the shared **S8** [ChargingStore] optimizer feed for an explicit [vehicleId] — the
 * memoized, multi-observer feed every Charging surface shares. The live value (incl. the store's
 * background refresh) flows through unchanged. No HTTP touches the view.
 */
fun ChargingStore.asChargingOptimizerSource(vehicleId: Long): ChargingOptimizerSource =
    ChargingOptimizerSource { chargingOptimizer(vehicleId.toString()).map { it.mapToReport() } }

/**
 * Binds the widget to the shared **S8** [ChargingStore] optimizer feed with web-faithful vehicle
 * resolution: the optimizer is scoped to [explicitVehicleId] when supplied, otherwise the first enrolled
 * vehicle from the shared [VehiclesStore] (the native analogue of the web `vehicleId ?? vehicles?.[0]?.id`
 * plus `enabled: vehicleId !== null`). With no vehicle available the feed short-circuits to an empty report
 * — the disabled-query parity — so the widget renders its "No optimizer data" state rather than spinning.
 * No HTTP touches the view.
 */
@OptIn(ExperimentalCoroutinesApi::class)
fun ChargingStore.asChargingOptimizerSource(
    vehicles: VehiclesStore,
    explicitVehicleId: Long? = null,
): ChargingOptimizerSource =
    ChargingOptimizerSource {
        vehicles.vehicles().flatMapLatest { vehiclesResource ->
            val resolved = explicitVehicleId ?: vehiclesResource.cached?.firstOrNull()?.id
            if (resolved == null) {
                flowOf(Resource.Success(ChargingOptimizerReport.Empty, 0L, stale = false))
            } else {
                chargingOptimizer(resolved.toString()).map { it.mapToReport() }
            }
        }
    }

/**
 * Binds the widget to the shared **S7** [ChargingRepository] optimizer feed for an explicit [vehicleId] —
 * the cold cache-then-network `Flow` the S8 [ChargingStore] also wraps. Use this when a host wants a
 * dedicated (non-shared) collection. No HTTP touches the view.
 */
fun ChargingRepository.asChargingOptimizerSource(vehicleId: Long): ChargingOptimizerSource =
    ChargingOptimizerSource { chargingOptimizer(vehicleId.toString()).map { it.mapToReport() } }
