// UI-thread-free state holder backing the Maintenance Tracker widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/MaintenanceTrackerWidget.tsx). It binds
// the shared global maintenance + service-records feeds (P1/S8) through [MaintenanceTrackerSource] and
// combines them onto the shared [UiState] surface (loading / content / empty / stale / offline / error) via
// [MaintenanceTrackerProjection.foldState], reproducing the web shell precedence
// (`isLoading = maintLoading || recordsLoading`, `isError = maintIsError`, `hasData = items || records`).
// The display preferences (distance unit + currency symbol + precision) are derived separately from the
// live `/settings` feed (web `useUnits`/`useFormatting`). It exposes the single refresh action plus the
// PII-safe `view.opened` diagnostic. The view never performs HTTP — it only collects [state] /
// [displayPrefs] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MaintenanceTrackerWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.maintenancetracker

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network maintenance + service-records + settings seam (a shared-data-layer
 *   adapter in production, a fake in tests). The view-model owns no networking — it only combines + projects
 *   the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MaintenanceTrackerWidgetViewModel(
    private val source: MaintenanceTrackerSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The maintenance + service-records surface as a lifecycle-aware [UiState]: loading / content / empty
     * (no items and no records) / stale / offline / error, carrying the freshness stamp + error kind. The
     * two feeds are combined by [MaintenanceTrackerProjection.foldState], which reproduces the web shell
     * precedence (maintenance primary for error/stale; records supplementary for the timeline + freshness).
     */
    val state: StateFlow<UiState<MaintenanceTrackerData>> =
        refreshTrigger
            .flatMapLatest { snapshotFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /** The live display preferences (distance unit + currency symbol + precision), re-derived as settings change. */
    val displayPrefs: StateFlow<MaintenanceTrackerDisplayPrefs> =
        source
            .settings()
            .map { resource -> MaintenanceTrackerDisplayPrefs.fromSettings(resource.cached) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = MaintenanceTrackerDisplayPrefs.METRIC_DEFAULT,
            )

    /** Re-runs both cache-then-network loads (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("maintenanceTracker.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no schedule / service / vehicle payload, so a diagnostics line can never leak the
     * owner's maintenance history. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to MaintenanceTrackerRegistration.SLUG))
    }

    /**
     * Combines the maintenance + service-records cache-then-network feeds into one folded [UiState] (web
     * `useMaintenance` + `useServiceRecords`). Re-collected whenever [refresh] bumps the trigger, so a
     * re-collection performs a genuine cache-then-network re-fetch of both feeds.
     */
    private fun snapshotFeed(): Flow<UiState<MaintenanceTrackerData>> =
        combine(source.maintenance(), source.serviceRecords()) { maintenance, records ->
            MaintenanceTrackerProjection.foldState(maintenance, records)
        }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: MaintenanceTrackerSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { MaintenanceTrackerWidgetViewModel(source, logger) }
            }
    }
}
