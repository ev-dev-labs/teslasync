// The data port the Maintenance Tracker widget binds to — the native analogue of the web hooks the
// component composes: `useMaintenance` (the global `/maintenance` schedule feed), `useServiceRecords`
// (the global `/maintenance/records` feed), and `useUnits` + `useFormatting` (both read from the
// `/settings` document, for the distance unit + currency symbol + precision). See
// web/src/features/dashboard/widgets/MaintenanceTrackerWidget.tsx + web/src/api/hooks/useVehicleSystems.ts.
// The view never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake)
// drives this seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model
// projects each emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MaintenanceTrackerWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.maintenancetracker

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.data.repo.VehicleSystemsRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehiclesystems.VehicleSystemsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the widget needs: the global [maintenance] schedule catalog
 * (the rendered `GET /maintenance` feed — web `useMaintenance`), the global [serviceRecords] history (the
 * `GET /maintenance/records` feed — web `useServiceRecords`), and the [settings] document (web
 * `useUnits`/`useFormatting`, for the distance unit + currency symbol + precision). Both maintenance feeds
 * are deployment-global and take no `vehicle_id`, exactly like their web hooks. A narrow seam so the
 * view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or
 * the network.
 */
interface MaintenanceTrackerSource {
    /** The cache-then-network `GET /maintenance` schedule feed (web `useMaintenance`). */
    fun maintenance(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /maintenance/records` service-history feed (web `useServiceRecords`). */
    fun serviceRecords(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useFormatting`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `refetch()`). The maintenance + service-record
 * feeds live on the [VehicleSystemsRepository]; the settings document on the [SettingsRepository]. No HTTP
 * touches the view.
 */
fun maintenanceTrackerSource(
    vehicleSystems: VehicleSystemsRepository,
    settings: SettingsRepository,
): MaintenanceTrackerSource =
    object : MaintenanceTrackerSource {
        override fun maintenance(): Flow<Resource<JsonElement>> = vehicleSystems.maintenance()

        override fun serviceRecords(): Flow<Resource<JsonElement>> = vehicleSystems.serviceRecords()

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun maintenanceTrackerSource(
    vehicleSystems: VehicleSystemsStore,
    settings: SettingsStore,
): MaintenanceTrackerSource =
    object : MaintenanceTrackerSource {
        override fun maintenance(): Flow<Resource<JsonElement>> = vehicleSystems.maintenance()

        override fun serviceRecords(): Flow<Resource<JsonElement>> = vehicleSystems.serviceRecords()

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
