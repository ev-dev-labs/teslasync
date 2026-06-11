// UI-thread-free state holder backing the Energy Flow Animated widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx). It
// binds the live vehicle-state feed (P1/S8) through [EnergyFlowAnimatedSource], projects each
// cache-then-network emission onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error), and exposes the single refresh action plus the PII-safe `view.opened` diagnostic.
// The view never performs HTTP — it only collects [state] and calls [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/EnergyFlowAnimatedWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energyflowanimated

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network live-state seam (a shared-data-layer adapter in production, a
 *   fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class EnergyFlowAnimatedWidgetViewModel(
    source: EnergyFlowAnimatedSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance).
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The live energy-flow feed as a lifecycle-aware [UiState]: loading / content / empty (no resolved
     * vehicle state) / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors
     * the web `state ? ... : <EmptyState>` gate.
     */
    val state: StateFlow<UiState<EnergyFlowAnimatedSnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it.state == null })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("energyFlowAnimated.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no power/energy figure, battery percent or vehicle id, so a diagnostics line can
     * never leak fleet data. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to EnergyFlowAnimatedRegistration.SLUG))
    }

    companion object {
        /**
         * Wire the surface from the shared [VehiclesStore] (P1/S8) and the app-wide active-vehicle
         * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An explicit
         * [vehicleId] overrides the active selection (web `vehicleId` prop precedence). The holder runs
         * on `viewModelScope`; a custom scope is a test-only concern handled via the constructor.
         */
        fun create(
            vehiclesStore: VehiclesStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
        ): EnergyFlowAnimatedWidgetViewModel =
            EnergyFlowAnimatedWidgetViewModel(
                source = StoreEnergyFlowAnimatedSource(vehiclesStore, activeVehicleId, vehicleId),
                logger = logger,
            )
    }
}
