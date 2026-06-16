// The state holder backing the CostAnalysisPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/charging/pages/CostAnalysisPage.tsx). It owns the page's local
// filter state (the date range the web `RangePicker` drives) and projects the two cache-then-network reads
// (`useChargingSessionsPaginated`, `useCostForecast`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState], plus the live display-unit preference (distance unit) the web `useUnits`/
// `useSettings` derive from the `/settings` document. The sessions feed re-collects whenever the active vehicle
// changes (web `useSelectedVehicle`), the range changes, or the refresh trigger bumps; with no vehicle in scope it
// parks on an empty success (the web disabled-hook case), which the page renders as its no-sessions empty state.
// All derivation logic lives in the framework-free model (CostAnalysisPageModel.kt); this holder is the thin
// orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.costanalysis

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate
import java.util.Locale

/**
 * The page's date-window filter — the web `RangePicker` `{ start, end }` cell (web `from` / `to` URL params,
 * defaulting to the last year). [startIso] / [endIso] render the ISO `yyyy-MM-dd` bounds the `GET /charging`
 * query carries (web `toISOString().split('T')[0]`).
 */
data class CostRange(
    val start: LocalDate,
    val end: LocalDate,
) {
    /** The inclusive lower bound as an ISO `yyyy-MM-dd` string (web `from`). */
    val startIso: String get() = start.toString()

    /** The inclusive upper bound as an ISO `yyyy-MM-dd` string (web `to`). */
    val endIso: String get() = end.toString()

    companion object {
        /** The web default: one year back through today (`d.setFullYear(d.getFullYear() - 1)` … `new Date()`). */
        fun lastYear(today: LocalDate = LocalDate.now()): CostRange = CostRange(today.minusYears(1), today)
    }
}

/**
 * The live display-unit preference this surface threads into the summary cards — the native port of the web
 * `useUnits`/`useSettings` distance read. [isMiles] selects the Cost-Per label's distance word, [distanceUnit] the
 * `mi`/`km` abbreviation, [locale] the per-session trend date label. The currency symbol is resolved by each
 * feature view from the same settings document, so it is not duplicated here.
 */
data class CostDisplayPrefs(
    val isMiles: Boolean,
    val distanceUnit: String,
    val locale: Locale,
) {
    companion object {
        /** The metric / en-US cold-start defaults applied before settings load (web `useUnits` defaults). */
        val DEFAULT: CostDisplayPrefs = fromSettings(null)

        /** Resolves the distance preference + locale from one `/settings` document (web `useUnits`). */
        fun fromSettings(settings: JsonElement?): CostDisplayPrefs {
            val pref = UnitPreferences.fromSettings(settings)
            val isMiles = pref.distance == DistanceUnitPref.MI
            return CostDisplayPrefs(
                isMiles = isMiles,
                distanceUnit = if (isMiles) DISTANCE_UNIT_MILES else DISTANCE_UNIT_KM,
                locale = Locale.forLanguageTag(pref.locale),
            )
        }
    }
}

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.ChargingRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] + settings store ↔ test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class CostAnalysisPageViewModel(
    private val source: CostAnalysisPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private val mutableRange = MutableStateFlow(CostRange.lastYear())
    private var viewOpenedRecorded = false

    /** The page's date-window filter (web `RangePicker` value). */
    val range: StateFlow<CostRange> = mutableRange.asStateFlow()

    /** The global active-vehicle selection (web `vehicleId`), threaded into the monthly-cost annotation scope. */
    val vehicleId: StateFlow<Long?> = source.selectedVehicleId()

    /** The active vehicle id (re-emitted on selection change or refresh) that scopes the per-vehicle reads. */
    private val scopedVehicleId: Flow<Long?> =
        combine(source.selectedVehicleId(), refreshTrigger) { id, _ -> id }

    /**
     * The paginated charging sessions as cache-then-network UI state (web `useChargingSessionsPaginated`).
     * Re-collected whenever the active vehicle changes, the range moves, or the refresh trigger bumps. Gated on a
     * selected vehicle (web `enabled: vehicleId != null`): with no vehicle it parks on an empty success the page
     * renders as its no-sessions empty state. The page fans this single feed out into every cost panel's input
     * via the framework-free model.
     */
    val sessionsState: StateFlow<UiState<List<ChargingSession>>> =
        combine(scopedVehicleId, mutableRange) { id, window -> id to window }
            .flatMapLatest { (id, window) ->
                if (id == null || id <= 0L) {
                    flowOf<Resource<List<ChargingSession>>>(Resource.Success(emptyList(), fetchedAt = 0L, stale = false))
                } else {
                    source.sessionsPaginated(id, window.startIso, window.endIso)
                }
            }
            .asUiState(isEmpty = { it.isEmpty() })

    /**
     * The cost-forecast payload as cache-then-network UI state (web `useCostForecast`). Re-collected on vehicle
     * change or refresh; never gated to an empty surface (the forecast feature views own their own friendly empty
     * states), so the page always renders the forecast sections. With no vehicle it parks on an empty object the
     * model parses to the empty forecast.
     */
    val forecastState: StateFlow<UiState<JsonElement>> =
        scopedVehicleId
            .flatMapLatest { id ->
                if (id == null || id <= 0L) emptyObjectFeed else source.costForecast(id)
            }
            .asUiState(isEmpty = { false })

    /** The live display-unit preference (distance unit + locale), re-derived as the settings document changes. */
    val displayPrefs: StateFlow<CostDisplayPrefs> =
        source
            .settings()
            .map { resource -> CostDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = CostDisplayPrefs.DEFAULT,
            )

    /** Update the date window (web `setRangeBatch({ from, to })`). */
    fun setRange(
        start: LocalDate,
        end: LocalDate,
    ) {
        mutableRange.update { CostRange(start = start, end = end) }
    }

    /** Re-collect every cache-then-network feed — the web query `refetch` / the page error-retry affordance. */
    fun refresh() {
        logger.info("costAnalysis.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the sessions feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordCostAnalysisPageOpened(logger)
    }

    private companion object {
        /** The synthetic "no selection" forecast payload so a null scope renders the empty forecast, not a fetch. */
        private val emptyObjectFeed: Flow<Resource<JsonElement>> =
            flowOf(Resource.Success(JsonObject(emptyMap()), 0L, false))
    }
}
