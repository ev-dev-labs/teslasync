// The data port the Sleep Efficiency widget binds to (P1/S8 state-holder seam) — the native analogue of
// the web `useVehicles` + `useSleepEfficiency` hook composition
// (web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx + web/src/api/hooks/useEnergy.ts),
// vehicle resolution included. The view never performs HTTP itself; a shared-store-backed adapter (or a
// test fake) drives this seam. Cache-then-network freshness is preserved end to end (ADR-013): every
// emission's cached/stale/error flags flow through the parse so the view-model can render the full state
// matrix. Sleep-efficiency figures are unitless (percent / hours / count), so the parse performs no SI
// conversion — it only shapes the raw JSON into the [SleepEfficiencySnapshot] the projection consumes.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SleepEfficiencyWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.sleepefficiency

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.EnergyRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.energy.EnergyStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`) and
 * the per-vehicle [sleepEfficiency] card (the rendered `GET /analytics/sleep` feed, already parsed into a
 * [SleepEfficiencySnapshot]). A narrow two-method seam so the view-model depends on an abstraction (real
 * adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface SleepEfficiencySource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /analytics/sleep?vehicle_id=` feed for [vehicleId] (web `useSleepEfficiency`). */
    fun sleepEfficiency(vehicleId: Long): Flow<Resource<SleepEfficiencySnapshot?>>
}

/**
 * Parse a raw [Resource] of the `GET /analytics/sleep` JSON into a [Resource] of a parsed
 * [SleepEfficiencySnapshot], preserving every freshness flag (cached / refreshing / stale / offline) so
 * the view-model can render the full state matrix. Pure, so the parse-and-preserve contract is unit-tested
 * without a network or cache. A present-but-not-object body parses to `null` (web's `data ?` falsy gate →
 * the "No sleep efficiency data" empty state).
 */
internal fun Resource<JsonElement>.toSleepEfficiencySnapshot(): Resource<SleepEfficiencySnapshot?> =
    when (this) {
        is Resource.Loading ->
            Resource.Loading(
                cached = cached?.let(SleepEfficiencySnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Success ->
            Resource.Success(
                data = SleepEfficiencySnapshot.fromJson(data),
                fetchedAt = fetchedAt,
                stale = stale,
            )

        is Resource.Error ->
            Resource.Error(
                cached = cached?.let(SleepEfficiencySnapshot::fromJson),
                fetchedAt = fetchedAt,
                stale = stale,
                error = error,
            )
    }

/**
 * Binds the widget to the shared **S8** state holders: the [VehiclesStore] supplies the memoized
 * enrolled-vehicle list (web `useVehicles`) and the [EnergyStore] supplies the per-vehicle sleep card
 * (web `useSleepEfficiency`). The live values (incl. each store's background refresh) flow through
 * unchanged; re-collecting a feed performs a genuine cache-then-network re-fetch, which backs the
 * widget's manual refresh / error-retry affordance. No HTTP touches the view.
 */
fun sleepEfficiencySource(
    vehicles: VehiclesStore,
    energy: EnergyStore,
): SleepEfficiencySource =
    object : SleepEfficiencySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun sleepEfficiency(vehicleId: Long): Flow<Resource<SleepEfficiencySnapshot?>> =
            energy.sleepEfficiency(vehicleId.toString()).map { it.toSleepEfficiencySnapshot() }
    }

/**
 * Binds the widget directly to the shared **S7** repositories — the cold cache-then-network `Flow`s the
 * S8 stores also wrap. Use this when a host wants the widget to own its own collection rather than fold
 * into the shared store's memoized feeds; the freshness contract is identical. No HTTP touches the view.
 */
fun sleepEfficiencySource(
    vehicles: VehiclesRepository,
    energy: EnergyRepository,
): SleepEfficiencySource =
    object : SleepEfficiencySource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun sleepEfficiency(vehicleId: Long): Flow<Resource<SleepEfficiencySnapshot?>> =
            energy.sleepEfficiency(vehicleId.toString()).map { it.toSleepEfficiencySnapshot() }
    }
