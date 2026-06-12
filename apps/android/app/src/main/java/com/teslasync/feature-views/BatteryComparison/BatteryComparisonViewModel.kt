// UI-thread-free state holder backing the BatteryComparison feature view — the native port of the single
// aggregating `useQuery` the web component owns over the enrolled fleet
// (web/src/features/vehicles/components/BatteryComparison.tsx + web/src/api/hooks/useVehicles.ts). It binds
// the shared vehicles + per-vehicle state feeds (P1/S8) through [BatteryComparisonSource] +
// [batteryComparisonResource], projects each cache-then-network emission onto the shared [UiState] surface
// (loading / content / empty / stale / offline / error), and exposes the single refresh action plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh] / [retry] / [onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryComparison) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterycomparison

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

/**
 * @param source the cache-then-network vehicles + per-vehicle-state seam (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryComparisonViewModel(
    private val source: BatteryComparisonSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The fleet's battery bars as a lifecycle-aware [UiState]: loading (first fetch) / content (≥1 resolved
     * bar) / empty (no fleet or no vehicle reported a state — the web `bars.length === 0`) / stale / offline /
     * error (the fleet list itself failed with no cache), carrying the freshness stamp + error kind.
     */
    val state: StateFlow<UiState<List<BatteryComparisonRow>>> =
        refreshTrigger
            .flatMapLatest { batteryComparisonResource(source.vehicles(), source::vehicleState) }
            .asUiState()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle name, VIN, level, or range, so a diagnostics line can never leak the fleet's charge
     * posture. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        BatteryComparisonDiagnostics.recordViewOpened(logger)
    }

    /** Re-runs the cache-then-network load (the web query's 30s `refetchInterval` / `refetch()`). */
    fun refresh() {
        logger.info("batteryComparison.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: BatteryComparisonSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BatteryComparisonViewModel(source, logger) }
            }
    }
}
