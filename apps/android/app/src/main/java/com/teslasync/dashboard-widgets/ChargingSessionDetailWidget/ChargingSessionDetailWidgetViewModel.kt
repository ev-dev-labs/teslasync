// UI-thread-free state holder backing the ChargingSessionDetail widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/ChargingSessionDetailWidget.tsx). It
// binds the shared session-detail feed (P1/S8) through [ChargingSessionDetailSource], projects each
// cache-then-network emission onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error), and exposes the refresh/retry actions plus the PII-safe `view.opened` diagnostic.
// The view never performs HTTP — it only collects [state] and calls [refresh]/[retry]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingSessionDetailWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingsessiondetail

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
 * @param source the cache-then-network session-detail seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingSessionDetailWidgetViewModel(
    private val source: ChargingSessionDetailSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The latest charge session as a lifecycle-aware [UiState]: loading / content / empty (no detail) /
     * stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors the web `!detail`
     * gate (no vehicle, no charging sessions, or the detail resolved to nothing).
     */
    val state: StateFlow<UiState<ChargingSessionDetailSnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { it.detail == null }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance). */
    fun refresh() {
        logger.info("chargingSessionDetail.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no kWh figure, peak power, charger type, session id or vehicle id, so a diagnostics
     * line can never leak fleet data. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to ChargingSessionDetailRegistration.SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: ChargingSessionDetailSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { ChargingSessionDetailWidgetViewModel(source, logger) }
            }
    }
}
