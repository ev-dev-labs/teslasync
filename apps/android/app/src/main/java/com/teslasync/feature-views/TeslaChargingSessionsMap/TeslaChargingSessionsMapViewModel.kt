// UI-thread-free state holder backing the TeslaChargingSessionsMap surface — the native port of the web
// component's hook composition (web/src/features/charging/pages/TeslaChargingSessionsMap.tsx, fed by
// `useTeslaChargingSessions`). It binds the shared cache-then-network [ChargingSessionsSource] (P1/S8),
// projects each emission onto the shared [UiState] surface (loading / content / empty / stale / offline /
// error), and exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TeslaChargingSessionsMap) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.teslachargingsessionsmap

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.charging.ChargingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [TeslaChargingSessionsMap]. It consumes the
 * cache-then-network [ChargingSessionsSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. A response
 * with no plottable session — an empty list OR a list whose every row lacks a valid coordinate — maps to
 * the empty surface ("No location data available yet."); a response with at least one renderable
 * coordinate maps to content (the map).
 *
 * It owns no networking. [refresh] re-collects the source (the web `refetch`) and [recordViewOpened] emits
 * the one-shot `view.opened` diagnostics event with the surface slug (P1/S11).
 *
 * @param source the cache-then-network sessions seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaChargingSessionsMapViewModel(
    source: ChargingSessionsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The latest sessions response as cache-then-network UI state: loading / content (≥1 plottable
     * session) / empty (no sessions, or none with a valid coordinate) / stale / offline / error, carrying
     * the freshness stamp + error kind.
     */
    val state: StateFlow<UiState<List<TeslaChargingSession>>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { sessions -> !TeslaChargingSessionsMapProjection.hasAnyRenderableLocation(sessions) })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info(REFRESH_EVENT)
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no site name, coordinate, cost, or vin. Call from the composable's first-composition
     * effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        TeslaChargingSessionsMapDiagnostics.recordViewOpened(logger)
    }

    companion object {
        private const val REFRESH_EVENT = "teslaChargingSessionsMap.refresh"

        /**
         * Wire the surface from the shared [ChargingStore] (P1/S8). An optional [vin] scopes the feed to
         * one vehicle (web `useTeslaChargingSessions(vin)`); `null` fetches every business-account session.
         */
        fun create(
            chargingStore: ChargingStore,
            logger: Logger,
            vin: String? = null,
            scope: CoroutineScope? = null,
        ): TeslaChargingSessionsMapViewModel =
            TeslaChargingSessionsMapViewModel(
                source = ChargingStoreSessionsSource(chargingStore, vin),
                logger = logger,
                scope = scope,
            )
    }
}
