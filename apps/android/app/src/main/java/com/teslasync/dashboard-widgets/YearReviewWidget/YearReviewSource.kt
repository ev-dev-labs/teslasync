// The data port the Year in Review widget binds to — the native analogue of the four web hooks the
// component composes: `useVehicles` (to resolve the default vehicle), `useYearReview` (the rendered
// `/analytics/year-review` feed), and `useUnits` (reads from the `/settings` document). See
// web/src/features/dashboard/widgets/YearReviewWidget.tsx + web/src/api/hooks/useAnalytics.ts. The view
// never performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives this
// seam. Cache-then-network freshness is preserved end to end (ADR-013): the view-model projects each
// emission's cached/stale/error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/YearReviewWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.yearreview

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.AnalyticsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SettingsRepository
import io.teslasync.shared.core.data.repo.VehiclesRepository
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * Streams the three cache-then-network feeds the widget needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`), the
 * [yearReview] envelope (the rendered `GET /analytics/year-review` feed for a given year + vehicle), and
 * the [settings] document (web `useUnits`, for the distance + speed units). A narrow seam so the
 * view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or
 * the network.
 */
interface YearReviewSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The cache-then-network `GET /analytics/year-review?year={year}&vehicle_id={vehicleId}` feed (web
     * `useYearReview`). Unlike the lifetime feed there is no fleet-wide shape: the web query is
     * `enabled: !!vehicleId`, so the view-model only calls this with a resolved [vehicleId] and otherwise
     * renders the empty surface — never a `vehicle_id`-less request.
     */
    fun yearReview(
        year: Int,
        vehicleId: String,
    ): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the widget to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * widget's manual refresh / error-retry affordance (the web `refetch()`). The vehicles list and the
 * settings document live on the [VehiclesRepository]/[SettingsRepository] seams, while the annual feed
 * comes from the [AnalyticsRepository]. No HTTP touches the view.
 */
fun yearReviewSource(
    vehicles: VehiclesRepository,
    analytics: AnalyticsRepository,
    settings: SettingsRepository,
): YearReviewSource =
    object : YearReviewSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun yearReview(
            year: Int,
            vehicleId: String,
        ): Flow<Resource<JsonElement>> = analytics.yearReview(year, vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the widget to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the widget to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun yearReviewSource(
    vehicles: VehiclesStore,
    analytics: AnalyticsStore,
    settings: SettingsStore,
): YearReviewSource =
    object : YearReviewSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun yearReview(
            year: Int,
            vehicleId: String,
        ): Flow<Resource<JsonElement>> = analytics.yearReview(year, vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
