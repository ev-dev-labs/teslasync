// UI-thread-free state holder backing the AutopilotSection feature view — the native port of the three
// per-vehicle queries the web component owns (web/src/features/driving/components/driving-dynamics/
// AutopilotSection.tsx: `useVehicleState` + two `useSignalObservations`). It binds the shared vehicles +
// telemetry feeds (P1/S8) through [AutopilotSectionSource], folds each cache-then-network emission onto the
// shared [UiState] surface (loading / content / empty / stale / offline / error), and exposes the single
// refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects
// [state] and calls [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AutopilotSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.autopilotsection

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
 * @param source the cache-then-network vehicles + telemetry seam (a shared-data-layer adapter in production,
 *   a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the host-selected vehicle (web `vehicleId` prop); `null` defaults to the first enrolled
 *   vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AutopilotSectionViewModel(
    private val source: AutopilotSectionSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly as
    // the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's cruise/autopilot readings as a lifecycle-aware [UiState]: loading / content /
     * empty (no speed, cruise-set, or follow value) / stale / offline / error, carrying the freshness stamp +
     * error kind. Empty mirrors the web `hasAny` false branch — the friendly empty state, never a blank box.
     */
    val state: StateFlow<UiState<AutopilotSnapshot>> =
        refreshTrigger
            .flatMapLatest {
                autopilotSnapshotResource(
                    vehicles = source.vehicles(),
                    preferredVehicleId = vehicleId,
                    stateFor = source::vehicleState,
                    cruiseFor = source::cruiseSetSpeed,
                    followFor = source::followDistance,
                )
            }.asUiState { !it.hasAny }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no speed/cruise/vehicle payload, so a diagnostics line can never leak vehicle state. Call from
     * the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordAutopilotSectionOpened(logger)
    }

    /** Re-runs the cache-then-network load (the web page's 5s poll / `refetch()` + the freshness retry). */
    fun refresh() {
        logger.info("autopilotSection.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: AutopilotSectionSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AutopilotSectionViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
