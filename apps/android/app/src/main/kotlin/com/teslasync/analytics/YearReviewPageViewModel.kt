// The state holder backing the YearReviewPage analytics surface (P1/S8) — the native counterpart of the web
// page's React state + TanStack-Query hooks (web/src/features/analytics/pages/YearReviewPage.tsx). It projects
// the `useYearReview` cache-then-network read onto the shared lifecycle-aware [UiState] surface, scoped to the
// vehicle the page selects, and exposes the `useVehicles` scope-picker options + the auto-selected default. All
// decode/derivation logic lives in the framework-free model (YearReviewPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// Vehicle scope (web parity): the web page reads the `vehicle_id` URL query param and, when absent, auto-selects
// the first enrolled vehicle (`setSearchParams({ vehicle_id: vehicleList[0].id })`). This holder mirrors that
// with an explicit-selection flow folded over the live vehicle list: [selectedVehicleId] is the explicit pick or
// the first vehicle's id. The year-review feed re-collects whenever that resolves or changes (a new
// `/analytics/year-review?year=&vehicle_id=` read); until a vehicle resolves the feed stays Loading (web
// `enabled: !!vehicleId` ⇒ no data ⇒ the loading screen), never issuing a `vehicle_id`-less request.
//
// Empty (web parity): an all-zero payload (`total_drives === 0 && total_charge_sessions === 0`), or a null /
// non-object document, resolves to UiPhase.Empty via [hasYearReviewData] so the page shows its no-data screen
// (web's second short-circuit); any positive drive or charge count yields the slide deck.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.yearreview

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.feature.views.summaryslide.SummarySlideSource
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.serialization.json.JsonElement

/**
 * @param source the P1/S8 data seam (real [VehiclesStore][io.teslasync.shared.core.presentation.vehicles.VehiclesStore]
 *   + [AnalyticsStore][io.teslasync.shared.core.presentation.analytics.AnalyticsStore] adapter ↔ test fake); the
 *   view never performs HTTP.
 * @param year the recap year from the route (web `Number(yearParam) || new Date().getFullYear()`).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class YearReviewPageViewModel(
    private val source: YearReviewPageSource,
    val year: Int,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val explicitSelection = MutableStateFlow<Long?>(null)
    private var viewOpenedRecorded = false

    /** The enrolled vehicle list (the cache value of the `GET /vehicles` feed), driving the picker + default. */
    private val vehicles: StateFlow<List<Vehicle>> =
        source
            .vehicles()
            .map { it.cached ?: emptyList() }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    /** The scope-picker options (web `vehicleOptions`). Shown only when more than one vehicle is enrolled. */
    val vehicleOptions: StateFlow<List<YearReviewVehicleOption>> =
        vehicles
            .map(::vehicleOptionsFrom)
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), emptyList())

    /**
     * The vehicle scoping the recap — the explicit selection (web `searchParams.get('vehicle_id')`) or, when
     * none, the first enrolled vehicle (web auto-select `vehicleList[0].id`). `null` only before any vehicle
     * loads, which keeps the feed Loading (web `enabled: !!vehicleId`).
     */
    val selectedVehicleId: StateFlow<Long?> =
        combine(explicitSelection, vehicles) { explicit, list -> explicit ?: list.firstOrNull()?.id }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), null)

    /**
     * The decoded `/analytics/year-review` payload as cache-then-network UI state (loading / content / empty /
     * stale / offline / error). Re-collected whenever the selected vehicle changes. Empty mirrors the web no-data
     * gate ([hasYearReviewData]); a null selection emits Loading so the page shows its building-your-review
     * screen rather than a blank deck or a `vehicle_id`-less request.
     */
    val state: StateFlow<UiState<JsonElement>> =
        selectedVehicleId
            .flatMapLatest { id -> id?.let { source.yearReview(year, it.toString()) } ?: PENDING_FEED }
            .asUiState(isEmpty = { !hasYearReviewData(it) })

    /** The data seam the self-contained SummarySlide child binds to (web `<SummarySlide />`'s own hooks). */
    val summarySource: SummarySlideSource = source.summarySource()

    /**
     * Selects the recap vehicle (web `setSearchParams({ vehicle_id })`). Switching vehicles re-collects the
     * year-review feed; the page resets the slide index to the first slide, mirroring the web `setSlideIndex(0)`.
     */
    fun select(vehicleId: Long) {
        explicitSelection.value = vehicleId
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id / year payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordYearReviewPageOpened(logger)
    }

    private companion object {
        /** The "no vehicle resolved yet" feed — a permanent Loading so the page shows its loading screen. */
        private val PENDING_FEED =
            flowOf<Resource<JsonElement>>(Resource.Loading(cached = null, fetchedAt = null, stale = false))
    }
}
