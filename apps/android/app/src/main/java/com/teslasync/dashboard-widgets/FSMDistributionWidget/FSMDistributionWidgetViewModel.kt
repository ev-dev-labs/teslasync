// UI-thread-free state holder backing the FSM State Distribution widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/FSMDistributionWidget.tsx). It binds the
// shared data feeds (P1/S8) through [FSMDistributionSource]: when no explicit vehicle is configured it
// resolves the default vehicle from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id`), then
// combines the `useFSMStats` + `useFSMTransitions` cache-then-network feeds onto the shared [UiState]
// surface (loading / content / empty / stale / offline / error) via
// [FSMDistributionProjection.foldState], reproducing the web's merged freshness. It exposes the single
// refresh action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it only
// collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/FSMDistributionWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.fsmdistribution

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
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
 * @param source the cache-then-network vehicles + fsm-stats + fsm-transitions seam (a shared-data-layer
 *   adapter in production, a fake in tests). The view-model owns no networking — it only resolves the
 *   default vehicle and composes the two feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class FSMDistributionWidgetViewModel(
    private val source: FSMDistributionSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The FSM distribution surface as a lifecycle-aware [UiState]: loading / content / empty (no
     * positive-time state) / stale / offline / error, carrying the merged freshness stamp + error kind.
     * The two feeds are combined by [FSMDistributionProjection.foldState], which treats the stats feed as
     * primary (the donut + `hasData` gate) and folds the transitions feed's freshness in.
     */
    val state: StateFlow<UiState<FSMDistributionSnapshot>> =
        refreshTrigger
            .flatMapLatest { snapshotFeed() }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = UiState.loading(),
            )

    /** Re-runs both cache-then-network loads (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("fsmDistribution.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no state-name / transition / vehicle payload, so a diagnostics line can never leak
     * where or how the vehicle has been. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to FSMDistributionRegistration.SLUG))
    }

    /**
     * The rendered feed: the explicit vehicle's FSM distribution when one is configured, otherwise the
     * first enrolled vehicle's distribution resolved from the live vehicles list. While the list is loading
     * (no cached vehicle) the surface stays in loading; an empty/unresolved list resolves to the empty
     * state (web's disabled `enabled: !!entityId` queries ⇒ no data ⇒ empty) rather than issuing a bogus
     * `vehicle_id=0` request — all without ever issuing HTTP from the view.
     */
    private fun snapshotFeed(): Flow<UiState<FSMDistributionSnapshot>> {
        val explicit = vehicleId?.takeIf { it > 0L }
        return if (explicit != null) {
            combinedFor(explicit)
        } else {
            source.vehicles().flatMapLatest { vehiclesResource ->
                val firstId = vehiclesResource.cached?.firstOrNull()?.id
                when {
                    firstId != null && firstId > 0L -> combinedFor(firstId)
                    vehiclesResource is Resource.Loading -> flowOf(UiState.loading())
                    else -> flowOf(FSMDistributionProjection.emptyState())
                }
            }
        }
    }

    /** Combines the stats + transitions feeds for one vehicle into the merged [UiState]. */
    private fun combinedFor(vid: Long): Flow<UiState<FSMDistributionSnapshot>> =
        combine(source.stats(vid.toString()), source.transitions(vid.toString())) { stats, transitions ->
            FSMDistributionProjection.foldState(stats, transitions)
        }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: FSMDistributionSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { FSMDistributionWidgetViewModel(source, logger, vehicleId) }
            }
    }
}
