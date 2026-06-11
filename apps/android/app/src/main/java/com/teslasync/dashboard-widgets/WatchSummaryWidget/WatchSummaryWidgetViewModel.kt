// UI-thread-free state holder backing the Watch Summary widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/WatchSummaryWidget.tsx). It binds the shared Watch
// summary + complication feeds (P1/S8) through [WatchSummarySource], folds them onto the shared [UiState]
// surface (loading / content / empty / stale / offline / error), and exposes the single refresh action
// plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and
// calls [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WatchSummaryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.watchsummary

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * @param source the cache-then-network Watch summary + complication seam (a shared-store adapter in
 *   production, a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` reads the primary
 *   vehicle (the watch endpoints omit `vehicle_id`), mirroring the web hooks — there is NO fleet-list
 *   fallback for this surface.
 */
class WatchSummaryWidgetViewModel(
    private val source: WatchSummarySource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's watch summary (with the complication's charge flag folded in) as a
     * lifecycle-aware [UiState]: loading / content / empty (no usable summary) / stale / offline / error,
     * carrying the freshness stamp + error kind. Empty mirrors the web `summary ? … : <EmptyState/>` gate
     * — a summary with neither a state nor a last-updated stamp is the empty surface.
     */
    val state: StateFlow<UiState<WatchView>> =
        watchSummaryResource(source.summary(vehicleId), source.complication(vehicleId))
            .asUiState { WatchSummaryProjection.isEmpty(it.summary) }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no battery/range/location payload, so a diagnostics line can never leak vehicle
     * state. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to WatchSummaryRegistration.SLUG))
    }

    /** Re-runs the cache-then-network load (web `refetchSummary()` + the header refresh control). */
    fun refresh() {
        logger.info("watchSummary.refresh")
        source.refresh(vehicleId)
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: WatchSummarySource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { WatchSummaryWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
