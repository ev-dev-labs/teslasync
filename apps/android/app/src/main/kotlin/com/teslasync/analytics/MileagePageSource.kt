// The data seam the analytics MileagePage surface binds to, plus its production bindings over the shared
// S8 stores / S7 repositories. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's three TanStack-Query reads
// (`useMileageStats`, `useDailyMileage`, `useMonthlyMileage`) plus the `useVehicles` list the header
// vehicle picker resolves the active vehicle from (web `useSelectedVehicle`).
//
// Every feed is the raw verbatim server JSON the shared layer already exposes; the daily/monthly feeds are
// the `{days}` / `{months}` arrays the repository already unwraps. A narrow seam so the view-model depends
// on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network. Each
// (re)collection is a fresh cache-then-network `Resource` stream, so the view-model's refresh trigger
// re-subscribing performs the web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics)
// diverges from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName`
// is suppressed for the co-located binding helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.analytics.mileage

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AnalyticsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [MileagePageViewModel] depends on so it binds to an abstraction (the shared holders
 * in production, a fake in tests), never to a concrete store/repository or the network. All members are
 * cache-then-network raw-JSON `Resource` flows (the web read hooks). No HTTP touches the view.
 */
interface MileageSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to resolve the active vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /mileage/stats?vehicle_id=` feed for [vehicleId] (web `useMileageStats`). */
    fun mileageStats(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * The cache-then-network `GET /mileage/daily?vehicle_id=&days=` feed for [vehicleId]/[days] (web
     * `useDailyMileage`); the shared repository already unwraps the `{days}` envelope into a plain array.
     */
    fun dailyMileage(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>>

    /**
     * The cache-then-network `GET /mileage/monthly?vehicle_id=` feed for [vehicleId] (web
     * `useMonthlyMileage`); the shared repository already unwraps the `{months}` envelope into a plain array.
     */
    fun monthlyMileage(vehicleId: String): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** holders — the memoized, multi-observer feeds every analytics
 * surface shares app-wide (incl. their standard-cadence background refresh). The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). No HTTP touches the view.
 */
fun mileageSource(
    vehicles: VehiclesStore,
    analytics: AnalyticsStore,
): MileageSource =
    object : MileageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun mileageStats(vehicleId: String): Flow<Resource<JsonElement>> = analytics.mileageStats(vehicleId)

        override fun dailyMileage(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = analytics.dailyMileage(vehicleId, days)

        override fun monthlyMileage(vehicleId: String): Flow<Resource<JsonElement>> = analytics.monthlyMileage(vehicleId)
    }

/**
 * Binds the surface to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * page's manual refresh / error-retry affordance (the web `refetch()`). No HTTP touches the view.
 */
fun mileageSource(
    vehicles: VehiclesRepository,
    analytics: AnalyticsRepository,
): MileageSource =
    object : MileageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun mileageStats(vehicleId: String): Flow<Resource<JsonElement>> = analytics.mileageStats(vehicleId)

        override fun dailyMileage(
            vehicleId: String,
            days: Int,
        ): Flow<Resource<JsonElement>> = analytics.dailyMileage(vehicleId, days)

        override fun monthlyMileage(vehicleId: String): Flow<Resource<JsonElement>> = analytics.monthlyMileage(vehicleId)
    }
