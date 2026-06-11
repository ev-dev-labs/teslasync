// UI-thread-free state holder backing the Software Update Status widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/SoftwareUpdateStatusWidget.tsx). It binds
// the shared vehicles + vehicle-state + latest-config feeds (P1/S8) through [SoftwareUpdateStatusSource],
// projects each cache-then-network emission onto the shared [UiState] surface (loading / content / empty /
// stale / offline / error), and exposes the single refresh action plus the PII-safe `view.opened`
// diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[retry]/[onViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SoftwareUpdateStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.softwareupdatestatus

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
 * @param source the cache-then-network vehicles + vehicle-state + latest-config seam (a shared-data-layer
 *   adapter in production, a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the first
 *   enrolled vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SoftwareUpdateStatusWidgetViewModel(
    private val source: SoftwareUpdateStatusSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's update state as a lifecycle-aware [UiState]: loading / content / empty (no
     * decodable vehicle state) / stale / offline / error, carrying the freshness stamp + error kind. Empty
     * mirrors the web `state ? … : <EmptyState/>` gate — a snapshot with no vehicle state is the empty
     * surface; the `software_update_*` config fields only enrich a present state.
     */
    val state: StateFlow<UiState<SoftwareUpdateSnapshot>> =
        refreshTrigger
            .flatMapLatest {
                softwareUpdateResource(source.vehicles(), vehicleId, source::vehicleState, source::vehicleConfig)
            }.asUiState { !it.hasState }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no firmware version/payload, so a diagnostics line can never leak vehicle state. Call
     * from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to SoftwareUpdateStatusRegistration.SLUG))
    }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the header refresh control). */
    fun refresh() {
        logger.info("softwareUpdateStatus.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: SoftwareUpdateStatusSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SoftwareUpdateStatusWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
