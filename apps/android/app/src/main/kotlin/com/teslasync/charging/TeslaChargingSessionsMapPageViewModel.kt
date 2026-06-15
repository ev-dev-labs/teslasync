// State holder backing the TeslaChargingSessionsMap page surface (P1/S8) — the native counterpart of the data
// the web component binds (web/src/features/charging/pages/TeslaChargingSessionsMap.tsx, fed by its parent's
// `useTeslaChargingSessions` read). The web map is presentational: the Fleet Charging Sessions page passes the
// rows down. This page-layer holder projects that shared cache-then-network sessions feed (the shared S8
// [io.teslasync.shared.core.presentation.charging.ChargingStore] via the feature view's [ChargingSessionsSource]
// seam) onto the lifecycle-aware [UiState] surface the stateless screen renders, so the same loading / content /
// empty / stale-offline / error chrome the shared feature view implements is reachable from a single
// [StateFlow]. It performs NO HTTP and owns no business logic — the sessions fetch + decode live entirely in the
// feature view's data seam, and this binding is the standard [BaseFeedViewModel.asUiState] page-VM job.
//
// The empty gate mirrors the web map's "nothing to plot" condition exactly: a response with no session, OR a
// response whose every row lacks a finite coordinate, is the surface's empty state (NOT content). It is the
// feature view's own [TeslaChargingSessionsMapProjection.hasAnyRenderableLocation] predicate — the same contract
// the marker layer applies — so the page state holder and the rendered markers never disagree. A failed refresh
// over a cached list keeps the best-effort cached markers visible with an offline/error chip + retry (refresh),
// exactly as the sibling surfaces degrade gracefully.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/charging) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling page surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.charging.teslachargingsessionsmap

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.android.featureviews.teslachargingsessionsmap.ChargingSessionsSource
import io.teslasync.android.featureviews.teslachargingsessionsmap.ChargingStoreSessionsSource
import io.teslasync.android.featureviews.teslachargingsessionsmap.TeslaChargingSession
import io.teslasync.android.featureviews.teslachargingsessionsmap.TeslaChargingSessionsMapProjection
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.charging.ChargingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder for the TeslaChargingSessionsMap page surface. It consumes the cache-then-network
 * sessions [source] (P1/S8) and re-shares it as a single [UiState] stream via [BaseFeedViewModel.asUiState], so
 * the screen stays a stateless Composable that only renders. The rows themselves are owned by the shared data
 * layer, exactly like the web component's parent, so no networking happens here.
 *
 * The states are honest cache-then-network projections: a first frame of [UiState.loading] until the feed emits,
 * then content (≥1 plottable session) or empty (no session, or none with a valid coordinate — the web map's
 * "nothing to plot" case), with the offline/error chip + retry surfacing when a refresh fails over cached data.
 * [refresh] re-collects the feed (the web `refetch` / error-state retry) and [recordViewOpened] emits the
 * one-shot `view.opened` diagnostic with [TeslaChargingSessionsMapPageRegistration.SLUG] (P1/S11).
 *
 * @param source the cache-then-network sessions seam (a [ChargingStoreSessionsSource] adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaChargingSessionsMapPageViewModel(
    source: ChargingSessionsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refresh/retry affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The latest sessions response as cache-then-network UI state: loading / content (≥1 plottable session) /
     * empty (no session, or none with a valid coordinate) / stale / offline / error, carrying the freshness
     * stamp + error kind. The empty predicate is the feature view's own renderable-location gate so the page
     * state holder and the rendered markers stay in lock-step.
     */
    val state: StateFlow<UiState<List<TeslaChargingSession>>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { sessions -> !TeslaChargingSessionsMapProjection.hasAnyRenderableLocation(sessions) })

    /** Re-runs the cache-then-network sessions load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to TeslaChargingSessionsMapPageRegistration.SLUG))
        refreshTrigger.update { it + 1 }
    }

    /** Emits the one-shot PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTeslaChargingSessionsMapPageOpened(logger)
    }

    companion object {
        private const val EVENT_REFRESH = "teslaChargingSessionsMap.page.refresh"
        private const val FIELD_SURFACE = "surface"

        /** A [ViewModelProvider.Factory] the page composable uses to construct this surface's ViewModel. */
        fun factory(
            source: ChargingSessionsSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TeslaChargingSessionsMapPageViewModel(source, logger) }
            }

        /**
         * Wire the surface from the shared [ChargingStore] (P1/S8) — the web `useTeslaChargingSessions(vin)`
         * seam. An optional [vin] scopes the feed to one vehicle; `null` fetches every business-account session.
         */
        fun create(
            chargingStore: ChargingStore,
            logger: Logger,
            vin: String? = null,
            scope: CoroutineScope? = null,
        ): TeslaChargingSessionsMapPageViewModel =
            TeslaChargingSessionsMapPageViewModel(
                source = ChargingStoreSessionsSource(chargingStore, vin),
                logger = logger,
                scope = scope,
            )
    }
}
