// UI-thread-free state holder backing the Live Power Flow widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/LivePowerFlowWidget.tsx). It binds the
// shared data feeds (P1/S8) through [LivePowerFlowSource] — resolving the first linked site from the
// `useTeslaEnergySites` list (web `(sites ?? [])[0]?.energy_site_id`) and projecting the
// `useTeslaEnergyLiveStatus` cache-then-network body onto the shared [UiState] surface (loading /
// content / empty / stale / offline / error). It exposes the single refresh action plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/LivePowerFlowWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.livepowerflow

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only resolves the first site and projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LivePowerFlowWidgetViewModel(
    private val source: LivePowerFlowSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feeds (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The combined site + live-status payload as cache-then-network UI state (loading / content / empty /
     * stale / offline / error), carrying the freshness stamp + error kind. Empty mirrors the web
     * `!hasSites` gate — no linked Tesla Energy site resolves to the "No Tesla Energy site linked" empty
     * surface, while a linked site with no live body stays content and the flow diagram shows its own
     * "No live power data" empty state.
     */
    val state: StateFlow<UiState<LivePowerFlowSnapshot>> =
        refreshTrigger
            .flatMapLatest { liveFeed() }
            .asUiState(isEmpty = { !it.hasSites })

    /** Re-runs the cache-then-network load (the web `refetchSites()` + `refetchLive()` affordance + retry). */
    fun refresh() {
        logger.info("livePowerFlow.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no power figure, site id or location, so a diagnostics line can never leak the
     * owner's energy system. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to LivePowerFlowRegistration.SLUG))
    }

    private fun liveFeed(): Flow<Resource<LivePowerFlowSnapshot>> =
        livePowerFlowResource(
            sites = source.energySites(),
            liveStatus = { siteId -> source.liveStatus(siteId) },
        )

    companion object {
        /**
         * Wire the surface from the shared **S8** [EnergyStore] (P1/S8) — the cross-platform port of the
         * web `useEnergy` domain. The holder runs on `viewModelScope`; a custom scope is a test-only
         * concern handled via the constructor.
         */
        fun create(
            energy: EnergyStore,
            logger: Logger,
        ): LivePowerFlowWidgetViewModel = LivePowerFlowWidgetViewModel(livePowerFlowSource(energy), logger)
    }
}
