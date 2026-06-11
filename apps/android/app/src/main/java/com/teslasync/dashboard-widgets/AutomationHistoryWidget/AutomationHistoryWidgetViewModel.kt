// UI-thread-free state holder backing the Automation History widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx). It binds
// the shared Automations history feed (P1/S8) through [AutomationHistorySource], projects each
// cache-then-network emission onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error), and exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The
// view never performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/AutomationHistoryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.automationhistory

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network history seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AutomationHistoryWidgetViewModel(
    source: AutomationHistorySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The history feed as a lifecycle-aware [UiState]: loading / content / empty (no runs) / stale / offline
     * / error, carrying the freshness stamp + error kind. Empty mirrors the web `items.length === 0` gate.
     */
    val state: StateFlow<UiState<AutomationHistoryListResponse>> =
        refreshTrigger
            .flatMapLatest { source.history() }
            .asUiState(isEmpty = { it.items.isEmpty() })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("automationHistory.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no automation name/status/run payload, so a diagnostics line can never leak what an
     * automation did. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to AutomationHistoryRegistration.SLUG))
    }
}
