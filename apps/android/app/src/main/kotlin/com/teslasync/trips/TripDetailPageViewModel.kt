// The state holder backing the TripDetailPage trips surface (P1/S8) — the native counterpart of the web page's
// React state + TanStack-Query hook (web/src/features/trips/pages/TripDetailPage.tsx). It projects the single
// cache-then-network trip read (`useTrip(id)`) onto the shared lifecycle-aware [UiState] surface via
// [BaseFeedViewModel.asUiState], and derives the live display preferences from the settings document (web
// `useUnits`/`useFormatting`). The trip feed re-collects whenever the refresh trigger bumps (the error-surface
// retry). All formatting/derivation logic lives in the framework-free model (TripDetailPageModel.kt); this holder
// is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/trips) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.trips.tripdetail

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.trips.Trip
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.TripsRepository] adapter +
 *   [io.teslasync.shared.core.presentation.settings.SettingsStore] ↔ a test fake); the view never performs HTTP.
 * @param id the trip id from the route (web `useParams().id`).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TripDetailPageViewModel(
    private val source: TripDetailPageSource,
    val id: String,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)

    /**
     * The trip detail as cache-then-network UI state (web `useTrip`). Re-collected when refresh bumps. A loaded
     * trip is [io.teslasync.android.data.UiPhase.Content] (the panels); a hard transport failure with nothing
     * cached is [io.teslasync.android.data.UiPhase.Error] (the web PageContainer error surface). A trip is never
     * structurally "empty", so the empty predicate is constant-false — the web's `notFound` empty surface is the
     * render-side fallback for a non-loading, non-error state with no trip.
     */
    val tripState: StateFlow<UiState<Trip>> =
        refreshTrigger
            .flatMapLatest { source.trip(id) }
            .asUiState(isEmpty = { false })

    /**
     * The live display preferences derived from the settings document (web `useUnits` + `useFormatting`). Shared
     * while observed; falls back to the metric/`$`/2dp defaults before settings load so the first frame is never
     * blank.
     */
    val displayPrefs: StateFlow<TripDetailDisplayPrefs> =
        source.settings()
            .map { resource -> TripDetailDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS), TripDetailDisplayPrefs.DEFAULT)

    /** Re-collect the trip feed — the web query `refetch` / the page error-retry affordance. */
    fun refresh() {
        logger.info("tripDetail.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the trip feed's hard-error surface. */
    fun retry(): Unit = refresh()
}
