// UI-thread-free state holder backing the Dashboard Stats widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/DashboardStatsWidget.tsx). It binds the shared feeds
// (P1/S8) through [DashboardStatsSource]: the vehicle-independent `useDashboardStats` summary is the primary
// feed, and when no explicit vehicle is configured it resolves the default vehicle from the `useVehicles`
// list (web `vehicleId ?? vehicles?.[0]?.id`) to drive the per-vehicle `useVehicleStateMachine` +
// `useStateTimeline` reads. The three feeds are folded onto the shared [UiState] surface via
// [DashboardStatsProjection.foldState], reproducing the web's merged freshness + `stats || fsm` loading
// precedence. It exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DashboardStatsWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.dashboardstats

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
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network summary + vehicles + fsm + timeline seam (a shared-data-layer adapter
 *   in production, a fake in tests). The view-model owns no networking — it only resolves the default vehicle
 *   and composes the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DashboardStatsWidgetViewModel(
    private val source: DashboardStatsSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects every cache-then-network feed (the manual refetch affordance), exactly
    // as the web component re-runs `stats.refetch()` + `fsm.refetch()` + `timeline.refetch()`.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The Dashboard Stats surface as a lifecycle-aware [UiState]: loading (web `stats.isLoading || fsm.isLoading`)
     * / content / empty (no fleet summary) / stale / offline / error, carrying the merged freshness stamp +
     * error kind. The primary summary feed is combined with the resolved fsm + timeline feeds by
     * [DashboardStatsProjection.foldState]; a missing vehicle simply disables the latter two without blanking
     * the surface (the summary is vehicle-independent).
     */
    val state: StateFlow<UiState<DashboardStatsSnapshot>> =
        refreshTrigger
            .flatMapLatest { snapshotFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /** Re-runs every cache-then-network load (the web `refetch()` calls + the freshness chip's retry). */
    fun refresh() {
        logger.info("dashboardStats.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no stat value / FSM state / transition payload, so a diagnostics line can never leak vehicle
     * state. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        DashboardStatsDiagnostics.recordViewOpened(logger)
    }

    /** Combines the primary summary feed with the resolved fsm + timeline feeds into the merged [UiState]. */
    private fun snapshotFeed(): Flow<UiState<DashboardStatsSnapshot>> =
        combine(source.stats(), fsmTimelineFeed()) { statsRes, fsmTimeline ->
            DashboardStatsProjection.foldState(statsRes, fsmTimeline.fsm, fsmTimeline.timeline)
        }

    /**
     * The per-vehicle fsm + timeline feeds: the explicit vehicle's reads when one is configured, otherwise the
     * first enrolled vehicle's reads resolved from the live vehicles list. With no resolved vehicle (list
     * loading, empty, or unresolved) the reads are disabled (web `enabled: !!idStr`) — the summary still drives
     * the surface — without ever issuing a bogus `vehicle_id=0` request or HTTP from the view.
     */
    private fun fsmTimelineFeed(): Flow<FsmTimeline> {
        val explicit = vehicleId?.takeIf { it > 0L }
        return if (explicit != null) {
            combinedFor(explicit)
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                if (firstId != null && firstId > 0L) combinedFor(firstId) else flowOf(FsmTimeline.DISABLED)
            }
        }
    }

    /** Combines the fsm-state + timeline reads for one vehicle into the [FsmTimeline] envelope. */
    private fun combinedFor(vid: Long): Flow<FsmTimeline> =
        combine(
            source.vehicleStateMachine(vid.toString()),
            source.stateTimeline(vid.toString()),
        ) { fsm, timeline -> FsmTimeline(fsm, timeline) }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: DashboardStatsSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DashboardStatsWidgetViewModel(source, logger, vehicleId) }
            }
    }
}
