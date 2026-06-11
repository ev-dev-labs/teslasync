package io.teslasync.android.dashboardwidgets.alertfeed

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.notifications.Alert
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * State holder backing the Compose [AlertFeedWidget] — the Android port of the web
 * `AlertFeedWidget`'s hook composition (`web/src/features/dashboard/widgets/AlertFeedWidget.tsx`).
 *
 * It binds the injected [AlertFeedSource] (the P1/S8 shared-layer seam) to a lifecycle-aware
 * [UiState] of the alert list via [BaseFeedViewModel.asUiState], covering every state the web
 * widget renders: loading (no cache), content, empty, hard error, and — through the ADR-013
 * freshness contract — stale / offline (cached rows kept visible with the staleness + error flags).
 * The view stays a thin renderer; it performs no HTTP and owns no business logic (ADR-002).
 *
 * [refresh]/[retry] bump a trigger that restarts a fresh upstream collection (the web `refetch()`),
 * and [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared cache-then-network alert feed seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AlertFeedWidgetViewModel(
    private val source: AlertFeedSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The alert inbox as cache-then-network UI state (empty inbox → [io.teslasync.android.data.UiPhase.Empty]). */
    val alerts: StateFlow<UiState<List<Alert>>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { it.isEmpty() }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to AlertFeedRegistration.SLUG))
    }

    /** Re-fetches the alert inbox (web `refetch()`); restarts a fresh cache-then-network collection. */
    fun refresh() {
        logger.info("alertFeed.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: AlertFeedSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { AlertFeedWidgetViewModel(source, logger) }
            }
    }
}
