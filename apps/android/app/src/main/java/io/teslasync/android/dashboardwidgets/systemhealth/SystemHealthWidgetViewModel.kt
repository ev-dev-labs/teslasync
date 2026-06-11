package io.teslasync.android.dashboardwidgets.systemhealth

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
 * State holder backing the Compose [SystemHealthWidget] — the Android port of the web
 * `SystemHealthWidget`'s hook composition
 * (`web/src/features/dashboard/widgets/SystemHealthWidget.tsx`).
 *
 * It binds the injected [SystemHealthSource] (the P1/S8 shared-layer seam) to a lifecycle-aware
 * [UiState] of the projected [SystemHealthData]: the `/system/health` feed drives the overall status,
 * the per-service grid and the panel's loading / freshness / error envelope (web `useSystemHealth`),
 * `/dev-tools/db-stats` fills the DB Size fallback (web `useDBStats`), and `/dev-tools/runtime-info`
 * fills Active Conns / Memory / Goroutines (web `useConnectionPool`). The result covers every state the
 * web widget renders — loading, content, empty (web `!hasData`), hard error, and — through the ADR-013
 * freshness contract — stale / offline (cached analysis kept visible with the staleness + error flags).
 * The view stays a thin renderer; it performs no HTTP (ADR-002).
 *
 * [refresh]/[retry] restart the combined feed through the source (web `health.refetch()`), and
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared Admin seam (S8 `AdminStore` in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SystemHealthWidgetViewModel(
    private val source: SystemHealthSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false
    private val restart = MutableStateFlow(0)

    /** The projected system-health analysis as cache-then-network UI state (unresolved feed ⇒ Empty). */
    val state: StateFlow<UiState<SystemHealthData>> =
        restart
            .flatMapLatest { systemHealthResource(source) }
            .asUiState { !it.hasData }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("slug" to SystemHealthRegistration.SLUG))
    }

    /** Re-fetches the system-health + db-stats + runtime-info feeds (web `health.refetch()`). */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("slug" to SystemHealthRegistration.SLUG))
        restart.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "systemHealth.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: SystemHealthSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SystemHealthWidgetViewModel(source, logger) }
            }
    }
}
