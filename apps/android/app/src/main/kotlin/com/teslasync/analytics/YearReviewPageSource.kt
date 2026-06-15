// The data seam the YearReviewPage analytics surface binds to, plus its production binding over the shared S8
// holders. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's data reads: `useVehicles` (the `GET /vehicles` list that fills the
// scope picker and supplies the auto-selected default) and `useYearReview` (the rendered
// `GET /analytics/year-review?year=&vehicle_id=` feed). The self-contained SummarySlide child surface keeps its
// own data hook, so the seam also hands it a [SummarySlideSource] built over the same shared stores.
//
// Each feed is a shared-core cache-then-network `Resource` stream the S8 holders already expose
// (`GET /vehicles` ▸ VehiclesStore.vehicles(); `GET /analytics/year-review` ▸ AnalyticsStore.yearReview(...)).
// A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// store or the network. Re-collecting the year-review feed performs a genuine cache-then-network re-fetch (the
// web `refetch()`), which backs the per-slide stale/offline refresh.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.analytics.yearreview

import io.teslasync.android.feature.views.summaryslide.SummarySlideSource
import io.teslasync.android.feature.views.summaryslide.summarySlideSource
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.analytics.AnalyticsStore
import io.teslasync.shared.core.presentation.settings.SettingsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [YearReviewPageViewModel] depends on so it binds to an abstraction (the shared Vehicles +
 * Analytics holders in production, a fake in tests), never to a concrete store or the network. The two read
 * feeds are cache-then-network `Resource` flows (the web read hooks); [summarySource] is the sub-seam the
 * self-contained SummarySlide child binds to (it owns its own `useYearReview`/`useVehicles`/`useUnits` reads).
 * No HTTP touches the view.
 */
interface YearReviewPageSource {
    /** The cache-then-network `GET /vehicles` list feed (web `useVehicles`) — fills the scope picker + default. */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The cache-then-network `GET /analytics/year-review?year={year}&vehicle_id={vehicleId}` feed (web
     * `useYearReview`). The web query is `enabled: !!vehicleId`, so the view-model only calls this with a
     * resolved [vehicleId] (the explicit selection or the auto-selected first vehicle).
     */
    fun yearReview(
        year: Int,
        vehicleId: String,
    ): Flow<Resource<JsonElement>>

    /** The data seam the self-contained SummarySlide child binds to (web `<SummarySlide />`'s own hooks). */
    fun summarySource(): SummarySlideSource
}

/**
 * Binds the surface to the shared **S8** [VehiclesStore] + [AnalyticsStore] (+ [SettingsStore] for the summary
 * child) — the memoized, multi-observer feeds every surface shares app-wide. The live values flow through
 * unchanged so the view-model renders the full state matrix (loading / content / empty / error / stale /
 * offline). The SummarySlide sub-seam is built from the same three stores via [summarySlideSource]. No HTTP
 * touches the view.
 */
fun yearReviewPageSourceOf(
    vehiclesStore: VehiclesStore,
    analyticsStore: AnalyticsStore,
    settingsStore: SettingsStore,
): YearReviewPageSource =
    object : YearReviewPageSource {
        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehiclesStore.vehicles()

        override fun yearReview(
            year: Int,
            vehicleId: String,
        ): Flow<Resource<JsonElement>> = analyticsStore.yearReview(year, vehicleId)

        override fun summarySource(): SummarySlideSource =
            summarySlideSource(vehicles = vehiclesStore, analytics = analyticsStore, settings = settingsStore)
    }
