// UI-thread-free state holder backing the NotificationFilterBar feature view — the native port of the
// Notifications data dependency the web component reads (web/src/features/notifications/components/
// NotificationFilterBar.tsx). It binds the shared cache-then-network [NotificationFilterBarSource] (P1/S8),
// projects each emission onto the shared [UiState] surface (loading / content / stale / offline / error),
// and exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never performs
// HTTP — it only collects [state] and calls [refresh] / [recordViewOpened]. The edited filters themselves
// are owned by the caller (web `filters` + `onChange` props), exactly like the web controlled component.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/NotificationFilterBar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.notificationfilterbar

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.AlertRule
import io.teslasync.shared.core.presentation.notifications.NotificationsStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [NotificationFilterBar]. It consumes the
 * cache-then-network [NotificationFilterBarSource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders.
 *
 * The alert-rule list drives the surface CHROME only (the freshness chip + the Rule dropdown options), never
 * whether the whole bar renders: an empty rule list is still valid content (the dropdown shows just the "All
 * rules" sentinel and the always-usable severity / search / vehicle / date controls stay live), and a failed
 * load keeps the best-effort cached list visible with the offline/error chip + a retry (refresh), exactly as
 * the web degrades gracefully (`rules ?? []`, it never blanks the bar). The bar's "empty" representation is
 * the absence of active-filter chips, decided by the caller-owned filters at the render boundary, so
 * [asUiState] is told the rule payload is never "empty" (`isEmpty = { false }`).
 *
 * It owns no networking. [refresh] re-collects the source and [recordViewOpened] emits the one-shot
 * `view.opened` diagnostics event with [NOTIFICATION_FILTER_BAR_SLUG] (P1/S11).
 *
 * @param source the cache-then-network alert-rule seam (a shared-data-layer adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class NotificationFilterBarViewModel(
    source: NotificationFilterBarSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The alert-rule list as cache-then-network UI state: loading / content / stale / offline / error,
     * carrying the freshness stamp + error kind. The payload is never treated as "empty" (an empty rule list
     * is valid content); the bar's own empty state is the caller-owned active filters.
     */
    val state: StateFlow<UiState<List<AlertRule>>> =
        refreshTrigger
            .flatMapLatest { source.streamRules() }
            .asUiState(isEmpty = { false })

    /** Re-runs the cache-then-network alert-rule load (the manual refresh affordance). */
    fun refresh() {
        logger.info("notificationFilterBar.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no rule names, ids, vehicle names, or filter values, so a diagnostics line can never
     * leak a user's filtering activity. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to NOTIFICATION_FILTER_BAR_SLUG))
    }

    companion object {
        /** Wire the surface from the shared [NotificationsStore] (P1/S8). */
        fun create(
            notificationsStore: NotificationsStore,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): NotificationFilterBarViewModel =
            NotificationFilterBarViewModel(
                source = notificationFilterBarSource(notificationsStore),
                logger = logger,
                scope = scope,
            )
    }
}
