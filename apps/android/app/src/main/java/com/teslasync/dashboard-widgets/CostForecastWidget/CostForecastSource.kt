// The data port the Cost Forecast widget binds to — the native analogue of the five web hooks the
// component composes: `useVehicles` (to resolve the default vehicle when no explicit id is configured —
// web `vehicles?.[0]?.id`), `useCostForecast` (the rendered `/analytics/cost-forecast?vehicle_id=&months=`
// feed, which the web declares in `useCharging.ts`), and `useFormatting` (which reads the `/settings`
// document for the currency symbol). See web/src/features/dashboard/widgets/CostForecastWidget.tsx +
// web/src/api/hooks/useCharging.ts. The view never performs HTTP; a concrete adapter over the shared
// S7/S8 data layer (or a test fake) drives this seam. Cache-then-network freshness is preserved end to
// end (ADR-013): the view-model projects each emission's cached/stale/error flags onto the render
// surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/CostForecastWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.costforecast

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.ChargingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.charging.ChargingStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list
 * (used only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`),
 * the per-vehicle [costForecast] envelope (the rendered `GET /analytics/cost-forecast?vehicle_id=` feed,
 * web `useCostForecast`, six-month default), and the [settings] document (web `useFormatting`, for the
 * currency symbol). A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network.
 */
interface CostForecastSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** The cache-then-network `GET /analytics/cost-forecast?vehicle_id={id}` six-month feed (web `useCostForecast`). */
    fun costForecast(vehicleId: String): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs
 * the widget's manual refresh / error-retry affordance (the web `refetch()`). The vehicles list and the
 * settings document live on the [VehiclesRepository]/[SettingsRepository] seams, while the cost-forecast
 * envelope comes from the [ChargingRepository] (where the web declares `useCostForecast`). No HTTP
 * touches the view.
 */
fun costForecastSource(
    vehicles: VehiclesRepository,
    charging: ChargingRepository,
    settings: SettingsRepository,
): CostForecastSource =
    object : CostForecastSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun costForecast(vehicleId: String): Flow<Resource<JsonElement>> = charging.costForecast(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the
 * view.
 */
fun costForecastSource(
    vehicles: VehiclesStore,
    charging: ChargingStore,
    settings: SettingsStore,
): CostForecastSource =
    object : CostForecastSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun costForecast(vehicleId: String): Flow<Resource<JsonElement>> = charging.costForecast(vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
