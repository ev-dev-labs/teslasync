// File hosts the ChargePlans data seam + its shared-layer bindings; named after the surface bundle
// (ChargePlansWidget*) rather than the single interface it declares.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.chargeplans

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
 * The data port the [ChargePlansWidgetViewModel] binds to — the Android analogue of the web
 * `ChargePlansWidget`'s hook composition (`useVehicles` + `useChargePlans` + `useRatePlans` +
 * `useSettings`) and the P1/S8 state-holder boundary. The view never performs HTTP itself; a test
 * fake stands in for the whole domain, and re-collecting a stream (the ViewModel's refresh/retry)
 * restarts a fresh upstream so a manual refresh actually re-fetches.
 *
 * Four reads back the surface: [vehicles] resolves the active vehicle id (web `vehicles?.[0]?.id`
 * fallback), [chargePlans] is that vehicle's plan history, [ratePlans] the available TOU plans, and
 * [settings] the document the display preferences (currency symbol, precision, locale) derive from.
 */
interface ChargePlansSource {
    /** Stream the enrolled vehicles, newest data following cache (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /** Stream a vehicle's charge-plan history (`GET /charge-planner/history`, web `useChargePlans`). */
    fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>>

    /** Stream the available TOU rate plans (`GET /charge-planner/rate-plans`, web `useRatePlans`). */
    fun ratePlans(): Flow<Resource<JsonElement>>

    /** Stream the settings document (`GET /settings`, web `useSettings`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared S7 repositories — the cache-then-network data ports. Each stream
 * starts a NEW repository collection, so the ViewModel's refresh/retry trigger a real re-fetch of the
 * charge plans, rate plans, vehicles and settings (the web `refetch()` behaviour).
 */
fun chargePlansSource(
    charging: ChargingRepository,
    vehicles: VehiclesRepository,
    settings: SettingsRepository,
): ChargePlansSource =
    object : ChargePlansSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>> = charging.chargePlans(vehicleId)

        override fun ratePlans(): Flow<Resource<JsonElement>> = charging.ratePlans()

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the surface to the shared S8 stores (web hook ports) — use this when a host shares one
 * app-wide Charging / Vehicles / Settings feed across surfaces; each store folds every observer of
 * the same feed into a single upstream collection.
 */
fun chargePlansSource(
    charging: ChargingStore,
    vehicles: VehiclesStore,
    settings: SettingsStore,
): ChargePlansSource =
    object : ChargePlansSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun chargePlans(vehicleId: Long): Flow<Resource<JsonElement>> = charging.chargePlans(vehicleId)

        override fun ratePlans(): Flow<Resource<JsonElement>> = charging.ratePlans()

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
