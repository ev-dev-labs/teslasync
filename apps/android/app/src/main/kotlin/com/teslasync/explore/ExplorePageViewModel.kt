// The state holder backing the ExplorePage feature-hub surface (P1/S8) — the native counterpart of the web
// page's two TanStack-Query hooks + its recently-visited subscription
// (web/src/features/explore/pages/ExplorePage.tsx). It folds the `useVehicles` list feed and the
// `useIsForwardAuth` derivation into a single lifecycle-aware [UiState] of the page's [ExploreGate] (fleet size +
// auth mode), draping the cache-then-network freshness (refreshing / stale / offline + retry) over the static
// catalog without ever hiding it — the web page renders the catalog immediately with `vehicleCount` defaulting
// to `0`. It also re-shares the on-device recently-visited list the strip resolves against the catalog.
//
// All derivation (gating, filter, grouping, highlight, suggestions) lives in the framework-free model
// (ExplorePageModel.kt); this holder is the thin orchestration layer and performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/explore) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.explore

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.recentlyviewed.RecentPageEntry
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.authmode.AuthModeStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import io.teslasync.android.featureviews.recentlyviewed.RecentPagesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real shared Vehicles + auth-mode holders + the on-device recent-pages store
 *   ↔ test fakes); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ExplorePageViewModel(
    private val source: ExplorePageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The page gate (fleet count + auth mode) as a lifecycle-aware [UiState], folded from the `useVehicles`
     * feed + the `useIsForwardAuth` derivation. Marked never structurally empty (the gate is always present —
     * `vehicleCount` defaults to `0`), so the catalog renders from the first frame and the cache-then-network
     * lifecycle only drives the freshness chip + retry, never a blank region. Re-collected when [refresh] bumps.
     */
    val uiState: StateFlow<UiState<ExploreGate>> =
        refreshTrigger
            .flatMapLatest {
                combine(source.vehicles(), source.isForwardAuth()) { vehicles, isForwardAuth ->
                    exploreGateResource(vehicles, isForwardAuth)
                }
            }
            .asUiState(isEmpty = { false })

    /**
     * The on-device recently-visited entries (web `getRecentPages()` + `subscribeRecentPages()`), newest-first.
     * The strip resolves these against the visible catalog at the render boundary and shows only those that map
     * to a currently-visible feature (web `recentResolved`).
     */
    val recent: StateFlow<List<RecentPageEntry>> =
        source
            .recentPages()
            .stateIn(stateScope, SharingStarted.WhileSubscribed(RECENT_STOP_TIMEOUT_MS), emptyList())

    /** Re-collect the reads (web's `refetch`) — re-subscribes the vehicle feed and re-fetches the auth contract. */
    fun refresh() {
        logger.info("explore.refresh")
        refreshTrigger.update { it + 1 }
        source.refresh()
    }

    /** Retry affordance for the bound feed's stale/offline surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordExplorePageOpened(logger)
    }

    companion object {
        /** Keep the recent-pages feed's upstream alive briefly across config changes / fast re-subscribes. */
        private const val RECENT_STOP_TIMEOUT_MS = 5_000L

        /**
         * Wire the surface from the shared [VehiclesStore] + [AuthModeStore] (P1/S8) and the on-device
         * [RecentPagesStore]. The holder runs on `viewModelScope`; a custom scope is a test-only concern handled
         * via the constructor.
         */
        fun create(
            vehiclesStore: VehiclesStore,
            authModeStore: AuthModeStore,
            recentPagesStore: RecentPagesStore,
            logger: Logger,
        ): ExplorePageViewModel =
            ExplorePageViewModel(
                source = explorePageSourceOf(vehiclesStore, authModeStore, recentPagesStore),
                logger = logger,
            )
    }
}
