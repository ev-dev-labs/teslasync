// UI-thread-free state holder backing the Climate History widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/ClimateHistoryWidget.tsx). It binds the shared
// vehicles + climate-history feeds (P1/S8) through [ClimateHistorySource] — resolving the active vehicle
// from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id`) and projecting the `useClimateHistory`
// cache-then-network body onto the shared [UiState] surface (loading / content / empty / stale / offline /
// error). It exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ClimateHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatehistory

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network vehicles + climate-history seam (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only resolves the active vehicle
 *   and projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the first
 *   enrolled vehicle.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ClimateHistoryWidgetViewModel(
    private val source: ClimateHistorySource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feeds (the manual refetch affordance), exactly
    // as the web `useClimateHistory().refetch()` re-runs its query.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The active vehicle's climate history as a lifecycle-aware [UiState]: loading / content / empty (no
     * chart points) / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors
     * the web `isEmpty={!hasData}` gate — a resolved-but-pointless history (or no vehicle / disabled
     * query) is the "No climate history" surface.
     */
    val state: StateFlow<UiState<ClimateHistorySnapshot>> =
        refreshTrigger
            .flatMapLatest { historyFeed() }
            .asUiState(isEmpty = { !it.hasData })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the header refresh control). */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the offline surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no temperature payload or vehicle identity, so a diagnostics line can never leak
     * cabin state. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ClimateHistoryRegistration.SLUG))
    }

    private fun historyFeed(): Flow<Resource<ClimateHistorySnapshot>> =
        climateHistoryResource(
            vehicles = source.vehicles(),
            preferredVehicleId = vehicleId,
            historyFor = source::climateHistory,
        )

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_REFRESH = "climateHistory.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: ClimateHistorySource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ClimateHistoryWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
