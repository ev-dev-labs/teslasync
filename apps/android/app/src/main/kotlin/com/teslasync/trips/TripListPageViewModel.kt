// The state holder backing the TripListPage trips surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/trips/pages/TripListPage.tsx). It owns the page's local
// interaction state (the pagination cursor) as an immutable [TripListInteraction] snapshot, projects the single
// cache-then-network trips read (`useTrips`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState], and derives the live display preferences from the settings document (web
// `useUnits`/`useFormatting`). The trips feed re-collects whenever the active vehicle changes (web
// `useSelectedVehicle`), the page changes, or the refresh trigger bumps. Unlike the drives list, the web trips
// query is NOT gated on a selected vehicle — it queries `/trips` with an optional `vehicle_id`, so this holder
// queries regardless and an absent vehicle simply drops the filter. All derivation logic lives in the
// framework-free model (TripListPageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.trips.triplist

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.presentation.trips.TripsParams
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import java.time.LocalDate
import java.time.ZoneId

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.TripsRepository] adapter +
 *   [io.teslasync.android.data.SelectedVehicleStore] + [io.teslasync.shared.core.presentation.settings.SettingsStore]
 *   ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TripListPageViewModel(
    private val source: TripListPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val mutableInteraction = MutableStateFlow(TripListInteraction())
    private val tripsRefresh = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The stable default `start`/`end` range computed once at construction (web `useMemo` over `now()`). */
    private val range = defaultRange()

    /** The page's local interaction snapshot (web `useUrlNumber('page', 1)`). */
    val interaction: StateFlow<TripListInteraction> = mutableInteraction.asStateFlow()

    /**
     * The trips as cache-then-network UI state (web `useTrips`). Re-collected whenever the active vehicle, the
     * page, or the refresh trigger changes. The query mirrors the web hook's params (optional `vehicle_id`,
     * `limit`/`offset` from the page cursor, the default 365-day `start`/`end` range); an empty result parks on
     * [io.teslasync.android.data.UiPhase.Empty], which the page renders as its no-trips empty state.
     */
    val tripsState: StateFlow<UiState<List<Trip>>> =
        combine(source.selectedVehicleId(), mutableInteraction, tripsRefresh) { vehicleId, interaction, _ ->
            vehicleId to interaction.page
        }.flatMapLatest { (vehicleId, page) ->
            source.trips(
                TripsParams(
                    vehicleId = vehicleId?.takeIf { it > 0L },
                    limit = TripListPageRegistration.PAGE_SIZE,
                    offset = (page - 1) * TripListPageRegistration.PAGE_SIZE,
                    start = range.first,
                    end = range.second,
                ),
            )
        }.asUiState(isEmpty = { it.isEmpty() })

    /**
     * The live display preferences derived from the settings document (web `useUnits` + `useFormatting`). Shared
     * while observed; falls back to the metric/`$`/2dp defaults before settings load so the first frame is never
     * blank.
     */
    val displayPrefs: StateFlow<TripListDisplayPrefs> =
        source.settings()
            .map { resource -> TripListDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), TripListDisplayPrefs.DEFAULT)

    /** Jumps to a 1-based page (web `setPage`). */
    fun setPage(page: Int) = mutableInteraction.update { it.copy(page = page.coerceAtLeast(1)) }

    /** Re-collect the trips feed — the web query `refetch` / the page error-retry + pull-to-refresh affordance. */
    fun refresh() {
        logger.info("trips.refresh")
        tripsRefresh.update { it + 1 }
    }

    /** Retry affordance for the trips feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to TripListPageRegistration.SLUG))
    }

    /** The web default range: `[today - 365d, today]` as ISO `yyyy-MM-dd` strings (web `defaultStart`/`defaultEnd`). */
    private fun defaultRange(): Pair<String, String> {
        val today = LocalDate.now(ZoneId.systemDefault())
        return today.minusDays(TripListPageRegistration.DEFAULT_RANGE_DAYS).toString() to today.toString()
    }
}
