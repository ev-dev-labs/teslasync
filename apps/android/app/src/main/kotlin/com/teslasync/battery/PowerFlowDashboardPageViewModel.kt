// The state holder backing the PowerFlowDashboardPage surface (P1/S8) — the native counterpart of the web page's React
// state + TanStack-Query hooks (web/src/features/battery/pages/PowerFlowDashboardPage.tsx). It projects the two
// cache-then-network reads onto the shared lifecycle-aware [UiState] surface, scoped to the fixed energy-site id (web
// `DEFAULT_SITE_ID`), and drives the "Refresh from Tesla" mutation. All decode/derivation logic lives in the
// framework-free model (PowerFlowDashboardPageModel.kt); this holder is the thin orchestration layer and performs no
// HTTP.
//
// The primary feed is the live-status read (web `liveStatus`): a snapshot with no `id` (the backend "no data yet"
// message) resolves to UiPhase.Empty via [PowerFlowLive.hasData] so the page shows its `empty` state (the web
// `!hasLiveData` guard). The history feed is its own lifecycle-aware [UiState] so each chart renders its own loading /
// content / empty surface without ever hiding a section (web `empty={chartData.length === 0}`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.battery.powerflow

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (the shared Energy holder in production ↔ a test fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class PowerFlowDashboardPageViewModel(
    private val source: PowerFlowDashboardPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val siteId = PowerFlowDashboardPageRegistration.DEFAULT_SITE_ID
    private val refreshing = MutableStateFlow(false)
    private var viewOpenedRecorded = false

    /**
     * The primary `/live-status` feed as cache-then-network UI state (web `liveStatus`). A backend "no data" message
     * (no `id`) resolves to the empty surface (web `!hasLiveData`).
     */
    val live: StateFlow<UiState<PowerFlowLive>> =
        source
            .liveStatus(siteId)
            .map { it.mapData(::parsePowerFlowLive) }
            .asUiState(isEmpty = { !it.hasData })

    /** The `/live-status/history` feed projected to the chart samples (web `chartData`) — empty when no history exists. */
    val history: StateFlow<UiState<List<PowerFlowSample>>> =
        source
            .liveStatusHistory(siteId)
            .map { it.mapData(::parsePowerFlowHistory) }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Whether the "Refresh from Tesla" mutation is in flight (web `refreshMutation.isPending`) — drives the spinner. */
    val isRefreshing: StateFlow<Boolean> = refreshing.asStateFlow()

    /**
     * Refreshes the site's live power-flow status from Tesla (web `refreshMutation.mutate(siteId)`). On success the
     * shared store re-fetches both the live-status and history feeds, so the page updates without any further call.
     * Re-entrancy is guarded so a double-tap cannot stack two POSTs.
     */
    fun refresh() {
        if (refreshing.value) return
        refreshing.update { true }
        logger.info("powerFlow.refresh")
        launch {
            val result = source.refreshLiveStatus(siteId)
            result.onFailure { logger.warn("powerFlow.refresh.failed") }
            refreshing.update { false }
        }
    }

    /** Retry affordance for the hard-error surface (web `PageContainer` error → refetch); re-runs the refresh. */
    fun retry(): Unit = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder. Carries
     * no site id / power / energy / charge payload. Call from the composable's first composition.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordPowerFlowOpened(logger)
    }
}
