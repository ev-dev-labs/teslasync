// UI-thread-free state holder backing the AnomalyInlineRow feature view — the native port of the web
// component's `useVehicles` + inline `useQuery('/analytics/anomalies?vehicle_id=…&days=1')` composition
// (web/src/features/system/components/status/AnomalyInlineRow.tsx). It binds the shared vehicles + anomalies
// feeds (P1/S8) through [AnomalyInlineRowSource], projects each cache-then-network emission onto the shared
// [UiState] surface (loading / content / empty / stale / offline / error), and exposes the single refresh
// action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state]
// and calls [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AnomalyInlineRow) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.anomalyinlinerow

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * @param source the cache-then-network vehicles + anomalies seam (a shared-data-layer adapter in production,
 *   a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events
 *   carrying only the non-PII surface slug (never a vehicle id, signal name, or anomaly payload).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param days the rolling anomaly window (web `days=1`); injectable so tests can pin it.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AnomalyInlineRowViewModel(
    private val source: AnomalyInlineRowSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val days: Int = ANOMALY_INLINE_WINDOW_DAYS,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the web query's `refetch()`), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's 24h anomaly envelope as a lifecycle-aware [UiState]: loading / content / empty
     * (no qualifying anomaly) / stale / offline / error, carrying the freshness stamp + error kind. Empty
     * mirrors the web component's null branch — the row still renders ("No anomalies"), so empty is never a
     * blank box.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { anomalyInlineResource(source.vehicles(), days, source::anomalies) }
            .asUiState { AnomalyInlineRowProjection.isEmpty(it) }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no vehicle id or anomaly payload, so a diagnostics line can never leak fleet state.
     * Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to ANOMALY_INLINE_ROW_SLUG))
    }

    /** Re-runs the cache-then-network load (the web query's `refetch()` + the freshness auto-refresh). */
    fun refresh() {
        logger.info("anomalyInlineRow.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AnomalyInlineRowSource,
            logger: Logger,
            days: Int = ANOMALY_INLINE_WINDOW_DAYS,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AnomalyInlineRowViewModel(source, logger, days = days) }
            }
    }
}
