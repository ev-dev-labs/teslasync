// UI-thread-free state holder backing the LayoutSwitcher feature view — the native port of the
// `useSelectedVehicle` resolution the web component reads (web/src/hooks/useSelectedVehicle.ts +
// web/src/api/hooks/useVehicles.ts). It binds the shared enrolled-vehicle feed (P1/S8) through
// [LayoutSwitcherSource], projects each cache-then-network emission onto the shared [UiState] surface
// (loading / content / empty / stale / offline / error), and exposes the single refresh action plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[retry]/[onViewOpened]. The layouts themselves are host-owned props, not a feed.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LayoutSwitcher) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.layoutswitcher

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
 * @param source the cache-then-network enrolled-vehicle seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the host-selected vehicle (web `useSelectedVehicle`); `null` defaults to the first
 *   enrolled vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LayoutSwitcherViewModel(
    private val source: LayoutSwitcherSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The selected-vehicle context as a lifecycle-aware [UiState]: loading / content / empty (no enrolled
     * vehicle) / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors the web
     * `vehicle == null` branch — the switcher still renders (user-global layouts), so empty is not a blank box.
     */
    val state: StateFlow<UiState<SelectedVehicleContext>> =
        refreshTrigger
            .flatMapLatest { selectedVehicleResource(source.vehicles(), vehicleId) }
            .asUiState { !it.hasVehicle }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no layout name or vehicle id, so a diagnostics line can never leak the user's dashboards.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        LayoutSwitcherDiagnostics.recordViewOpened(logger)
    }

    /** Re-runs the cache-then-network vehicle load (backs the freshness auto-refresh + offline retry). */
    fun refresh() {
        logger.info("layoutSwitcher.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the offline/error retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: LayoutSwitcherSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { LayoutSwitcherViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
