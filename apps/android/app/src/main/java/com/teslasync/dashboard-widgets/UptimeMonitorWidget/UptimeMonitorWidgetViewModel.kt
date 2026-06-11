// UI-thread-free state holder backing the Uptime Monitor widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/UptimeMonitorWidget.tsx). It binds the shared
// Admin system-health feed (P1/S8) through [UptimeMonitorSource], projecting each cache-then-network
// emission onto the shared [UiState] surface (loading / content / empty / stale / offline / error) and
// carrying the freshness stamp + error kind, then exposes the single refresh action plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/UptimeMonitorWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.uptimemonitor

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network system-health seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class UptimeMonitorWidgetViewModel(
    private val source: UptimeMonitorSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the web `refetch()` affordance); the
    // repository-backed source re-fetches on re-subscribe, exactly as the shared store's own
    // trigger ▸ flatMapLatest pipeline does for its memoized feed.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The resolved system health as a lifecycle-aware [UiState]: loading (no cache) / content / empty
     * (no snapshot resolved — web `data ? body : <EmptyState>`) / stale / offline / error, carrying the
     * freshness stamp + error kind. A `null` snapshot is treated as structurally empty so the friendly
     * empty surface renders instead of a blank body.
     */
    val state: StateFlow<UiState<UptimeHealth?>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it == null })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the freshness/error retry). */
    fun refresh() {
        logger.info("uptimeMonitor.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no service status, DB size, or table count, so a diagnostics line can never leak
     * the install's health posture. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to UptimeMonitorRegistration.SLUG))
    }

    companion object {
        /**
         * Wire the surface from the shared **S7** [AdminRepository] — the cold cache-then-network feed
         * where the refresh trigger re-subscribing performs a genuine re-fetch (the web `refetch()`).
         */
        fun create(
            repository: AdminRepository,
            logger: Logger,
        ): UptimeMonitorWidgetViewModel = UptimeMonitorWidgetViewModel(repository.asUptimeMonitorSource(), logger)

        /**
         * Wire the surface from the shared **S8** [AdminStore] — the memoized, multi-observer
         * system-health feed every Admin surface shares (incl. its standard-cadence background refresh).
         */
        fun create(
            store: AdminStore,
            logger: Logger,
        ): UptimeMonitorWidgetViewModel = UptimeMonitorWidgetViewModel(store.asUptimeMonitorSource(), logger)
    }
}
