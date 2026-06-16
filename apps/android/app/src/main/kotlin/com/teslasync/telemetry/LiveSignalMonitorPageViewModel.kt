// UI-thread-free state holder backing the LiveSignalMonitorPage telemetry surface (P1/S8) — the native port of
// the connection slice the web page derives from `useLiveSignalStream` to drive its header badge
// (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx). It binds the shared live pipeline through
// [LiveSignalMonitorPageSource]: it collects the single SSE stream's connection state from the app-scoped
// `LiveSessionStore` (ADR-009) and projects it onto a lifecycle-aware [LiveMonitorUiState] the stateless page
// renders. The view never performs HTTP — it only collects [uiState] and calls [retry] / [recordViewOpened].
//
// All derivation lives in the framework-free model (LiveSignalMonitorPageModel.kt); this holder is the thin
// orchestration layer, exactly as the sibling A7 page ViewModels are.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.livesignalmonitor

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * @param source the live-pipeline seam (the shared `LiveSessionStore` adapter in production, a fake in tests);
 *   the view-model owns no networking — it only collects + projects the connection slice.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + the retry event.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class LiveSignalMonitorPageViewModel(
    private val source: LiveSignalMonitorPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /**
     * The page's connection state as a lifecycle-aware [StateFlow]. The shared live wire's connection slice is
     * projected onto [LiveMonitorUiState] (the header badge's `connected` flag + the freshness fields) and
     * re-shared in [stateScope] with `WhileSubscribed`, so the single SSE stream is collected only while the
     * screen observes it (via `collectAsStateWithLifecycle`) and dropped a short timeout after it leaves.
     */
    val uiState: StateFlow<LiveMonitorUiState> =
        source.connection()
            .map { liveMonitorUiStateOf(it) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = LiveMonitorUiState.Initial,
            )

    /** Re-opens the live stream (the page's stale/offline retry); forwards to the shared stream. */
    fun retry() {
        logger.info("liveSignalMonitor.retry")
        source.reconnect()
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no signal name or value, so a diagnostics line can never leak the vehicle's live state. Call from
     * the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordLiveSignalMonitorPageOpened(logger)
    }

    private companion object {
        /** Keep the upstream alive briefly across config changes / fast re-subscribes. */
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
