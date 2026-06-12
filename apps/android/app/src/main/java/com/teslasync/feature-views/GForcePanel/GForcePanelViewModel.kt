// UI-thread-free state holder backing the GForcePanel feature view — the native port of the single polled
// `useDriveDynamicsLatest` query the web component owns
// (web/src/features/driving/components/driving-dynamics/GForcePanel.tsx + web/src/api/hooks/useVehicles.ts).
// It binds the shared latest-drive-dynamics feed (P1/S8) through [GForcePanelSource], projects each
// cache-then-network emission onto the shared [UiState] surface (loading / content / empty / stale / offline /
// error), and exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/GForcePanel) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.gforcepanel

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
 * @param source the cache-then-network latest-drive-dynamics seam (a shared-data-layer adapter in production,
 *   a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the host-selected vehicle (web `GForcePanel({ vehicleId })`); a `null`/non-positive id
 *   reproduces the web disabled query (`enabled: vehicleId > 0`) and renders the empty state.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class GForcePanelViewModel(
    private val source: GForcePanelSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's latest g-force snapshot as a lifecycle-aware [UiState]: loading / content / empty
     * (no usable reading) / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors
     * the web `!hasAny` branch — the panel still renders its title + the friendly empty state, never a blank
     * box.
     */
    val state: StateFlow<UiState<JsonElement>> =
        refreshTrigger
            .flatMapLatest { gForceResource(vehicleId, source::driveDynamics) }
            .asUiState { GForcePanelProjection.isEmptySnapshot(it) }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no acceleration payload, so a diagnostics line can never leak fleet telemetry. Call from the
     * composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordGForcePanelOpened(logger)
    }

    /** Re-runs the cache-then-network load (the web component's 5s realtime poll / `refetch()` + the retry). */
    fun refresh() {
        logger.info("gForcePanel.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: GForcePanelSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { GForcePanelViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
