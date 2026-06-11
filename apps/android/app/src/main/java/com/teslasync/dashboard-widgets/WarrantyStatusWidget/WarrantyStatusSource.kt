// The data port the Warranty Status widget binds to — the native analogue of the hooks the web component
// composes: `useWarrantyDetails` (the account-level `GET /tesla/warranty` envelope) and `useUnits`/
// `useDateFormat` (both read from the `/settings` document, for the distance unit + locale). See
// web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx + web/src/api/hooks/useVehicles.ts. The view
// never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives this seam,
// and cache-then-network freshness is preserved end to end (ADR-013): the view-model projects each emission's
// cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WarrantyStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.warrantystatus

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the two cache-then-network feeds the widget needs: the account-level [warrantyDetails] envelope
 * (the rendered `GET /tesla/warranty` feed — web `useWarrantyDetails`) and the [settings] document (web
 * `useUnits`/`useDateFormat`, for the distance unit + locale). The warranty feed is deployment-global and
 * takes no `vehicle_id`, exactly like its web hook. A narrow seam so the view-model depends on an abstraction
 * (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface WarrantyStatusSource {
    /** The cache-then-network `GET /tesla/warranty` envelope feed (web `useWarrantyDetails`). */
    fun warrantyDetails(): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`/`useDateFormat`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores also
 * wrap. Re-collecting either feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `useWarrantyDetails().refetch()`). The warranty
 * envelope lives on the [VehiclesRepository]; the settings document on the [SettingsRepository]. No HTTP
 * touches the view.
 */
fun warrantyStatusSource(
    vehicles: VehiclesRepository,
    settings: SettingsRepository,
): WarrantyStatusSource =
    object : WarrantyStatusSource {
        override fun warrantyDetails(): Flow<Resource<JsonElement>> = vehicles.warrantyDetails()

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares. Use
 * this when a host wants the widget to fold into the same shared collections as the rest of the app; the live
 * values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun warrantyStatusSource(
    vehicles: VehiclesStore,
    settings: SettingsStore,
): WarrantyStatusSource =
    object : WarrantyStatusSource {
        override fun warrantyDetails(): Flow<Resource<JsonElement>> = vehicles.warrantyDetails()

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
