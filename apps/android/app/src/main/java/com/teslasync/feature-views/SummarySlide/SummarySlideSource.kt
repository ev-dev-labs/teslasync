// The data port the SummarySlide feature view binds to (P1/S8 state-holder seam) — the native analogue of
// the hooks the web slide's data depends on: `useVehicles` (to resolve the default vehicle), the
// `/analytics/year-review` feed that produces the `YearReview` the slide renders, and `useUnits` (reads
// the `/settings` document for the distance unit). See
// web/src/features/analytics/components/review/SummarySlide.tsx +
// web/src/features/analytics/pages/YearReviewPage.tsx + web/src/api/hooks/useAnalytics.ts. The view never
// performs HTTP; a concrete adapter over the shared S7/S8 data layer (or a test fake) drives this seam.
// Cache-then-network freshness is preserved end to end (ADR-013): the view-model projects each emission's
// cached / stale / error flags onto the render surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SummarySlide) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.feature.views.summaryslide

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
 * Streams the three cache-then-network feeds the slide needs: the enrolled-vehicle [vehicles] list (used
 * only to resolve the default vehicle when no explicit id is configured — web `vehicles?.[0]?.id`), the
 * [yearReview] envelope (the rendered `GET /analytics/year-review` feed for a given year + vehicle), and
 * the [settings] document (web `useUnits`, for the distance unit). A narrow seam so the view-model depends
 * on an abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network.
 */
interface SummarySlideSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`), used to pick the default vehicle. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The cache-then-network `GET /analytics/year-review?year={year}&vehicle_id={vehicleId}` feed (web
     * `useYearReview`). The web query is `enabled: !!vehicleId`, so the view-model only calls this with a
     * resolved [vehicleId] and otherwise renders the empty surface — never a `vehicle_id`-less request.
     */
    fun yearReview(
        year: Int,
        vehicleId: String,
    ): Flow<Resource<JsonElement>>

    /** The cache-then-network `GET /settings` document feed (web `useUnits`). */
    fun settings(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared **S7** repositories — the cold cache-then-network `Flow`s the S8 stores
 * also wrap. Re-collecting any feed performs a genuine cache-then-network re-fetch, which is what backs the
 * slide's manual refresh / error-retry affordance (the web `refetch()`). The vehicles list and the
 * settings document live on the [VehiclesRepository] / [SettingsRepository] seams, while the annual feed
 * comes from the [AnalyticsRepository]. No HTTP touches the view.
 */
fun summarySlideSource(
    vehicles: VehiclesRepository,
    analytics: AnalyticsRepository,
    settings: SettingsRepository,
): SummarySlideSource =
    object : SummarySlideSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun yearReview(
            year: Int,
            vehicleId: String,
        ): Flow<Resource<JsonElement>> = analytics.yearReview(year, vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }

/**
 * Binds the surface to the shared **S8** stores — the memoized, multi-observer feeds every surface shares.
 * Use this when a host wants the slide to fold into the same shared collections as the rest of the app;
 * the live values (incl. each store's background refresh) flow through unchanged. No HTTP touches the view.
 */
fun summarySlideSource(
    vehicles: VehiclesStore,
    analytics: AnalyticsStore,
    settings: SettingsStore,
): SummarySlideSource =
    object : SummarySlideSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun yearReview(
            year: Int,
            vehicleId: String,
        ): Flow<Resource<JsonElement>> = analytics.yearReview(year, vehicleId)

        override fun settings(): Flow<Resource<JsonElement>> = settings.settings()
    }
