// UI-thread-free state holder backing the Recent Drives List widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/RecentDrivesListWidget.tsx). It binds
// the shared cache-then-network [RecentDrivesListSource] (P1/S8) and re-shares it as a single [UiState]
// stream (loading / content / empty / stale / offline / error), exposing the single refresh action plus
// the PII-safe `view.opened` diagnostic. An empty drive list maps to the empty surface; a non-empty list
// maps to content (the web `items.length > 0 ? … : <EmptyState/>` gate). The view never performs HTTP —
// it only collects [state] and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RecentDrivesListWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentdriveslist

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [RecentDrivesListWidget]. It consumes the
 * cache-then-network [RecentDrivesListSource] (P1/S8) and re-shares it as a single [UiState] stream
 * (loading / content / empty / stale / offline / error), exposing the single refresh action plus the
 * PII-safe `view.opened` diagnostic.
 *
 * It owns no networking. [refresh] re-collects the source (the web `refetch`) and [recordViewOpened]
 * emits the one-shot `view.opened` diagnostics event with the surface
 * [RecentDrivesListRegistration.SLUG] (P1/S11).
 *
 * @param source the cache-then-network recent-drives seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RecentDrivesListWidgetViewModel(
    source: RecentDrivesListSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The recent drives as cache-then-network UI state: loading / content / empty (no drives) / stale /
     * offline / error, carrying the freshness stamp + error kind. Empty mirrors the web
     * `items.length === 0` gate (the disabled query / empty list both resolve to no rows).
     */
    val state: StateFlow<UiState<List<Drive>>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no drive id / address / location, so a diagnostics line can never leak where a
     * vehicle has been. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to RecentDrivesListRegistration.SLUG))
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "recentDrivesList.refresh"

        /**
         * Wire the surface from the shared [DrivingStore] (P1/S8) and the app-wide active-vehicle
         * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An explicit
         * [vehicleId] overrides the active selection (web `vehicleId` prop precedence). The holder runs on
         * `viewModelScope`; a custom scope is a test-only concern handled via the constructor.
         */
        fun create(
            drivingStore: DrivingStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): RecentDrivesListWidgetViewModel =
            RecentDrivesListWidgetViewModel(
                source = DrivingStoreRecentDrivesListSource(drivingStore, activeVehicleId, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
