// The data seam the FleetComparePage analytics surface binds to, plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives this
// seam, reproducing the web page's six TanStack-Query reads: `useVehicles` (the picker + auto-select),
// `useVehicleState` (each vehicle's live state), `useDrivingStats` (lifetime drives), `useCostBreakdown`
// (`/analytics/tco`), `useMonthlyMileage` (`/mileage/monthly`), and `useUnits` (the `/settings` document for the
// display units + currency).
//
// Every feed is a shared-core cache-then-network `Resource` stream the S8 holders already expose. A narrow seam so
// the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the network.
// Each (re)collection is a fresh cache-then-network stream, so the view-model's refresh trigger re-subscribing
// performs the web `refetch()`.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for
// the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.analytics.fleetcompare

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [FleetComparePageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * Analytics + Driving + Settings holders in production, a fake in tests), never to a concrete store or the
 * network. Every member is a cache-then-network `Resource` flow (the web read hooks). No HTTP touches the view.
 */
interface FleetCompareSource {
    /** The fleet list feed for the selectors + the first-two auto-select (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The per-vehicle live-state feed for [vehicleId] (web `useVehicleState`). */
    fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>>

    /** The per-vehicle lifetime `GET /drives/stats?vehicle_id={id}` feed (web `useDrivingStats`). */
    fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>>

    /** The per-vehicle `GET /analytics/tco?vehicle_id={id}` cost feed (web `useCostBreakdown`). */
    fun costBreakdown(vehicleId: String): Flow<Resource<JsonElement>>

    /** The per-vehicle `GET /mileage/monthly?vehicle_id={id}` buckets feed (web `useMonthlyMileage`). */
    fun monthlyMileage(vehicleId: String): Flow<Resource<JsonElement>>

    /** The `GET /settings` document feed for the display units + currency (web `useUnits` / `useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S8** stores — the memoized, multi-observer feeds every surface shares
 * app-wide. The live values flow through unchanged so the view-model renders the full state matrix (loading /
 * content / empty / error / stale / offline) for each source. No HTTP touches the view.
 */
fun fleetCompareSourceOf(
    vehiclesStore: VehiclesStore,
    analyticsStore: AnalyticsStore,
    drivingStore: DrivingStore,
    settingsStore: SettingsStore,
): FleetCompareSource =
    object : FleetCompareSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun vehicleState(vehicleId: Long): Flow<Resource<VehicleStateEnvelope>> = vehiclesStore.vehicleState(vehicleId)

        override fun drivingStats(vehicleId: String): Flow<Resource<JsonElement>> = drivingStore.drivingStats(vehicleId)

        override fun costBreakdown(vehicleId: String): Flow<Resource<JsonElement>> = analyticsStore.costBreakdown(vehicleId)

        override fun monthlyMileage(vehicleId: String): Flow<Resource<JsonElement>> = analyticsStore.monthlyMileage(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settingsStore.settings()
    }
