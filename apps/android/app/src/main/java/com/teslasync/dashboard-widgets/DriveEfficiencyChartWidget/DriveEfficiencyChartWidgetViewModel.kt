// UI-thread-free state holder backing the Drive Efficiency Chart widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/DriveEfficiencyChartWidget.tsx). It
// binds the shared cache-then-network [DriveEfficiencyChartSource] (P1/S8) and re-shares it as a
// single [UiState] stream via [BaseFeedViewModel.asUiState], so the screen stays a stateless
// Composable that only renders. An empty drive list maps to the empty surface; a non-empty list maps
// to content (the composable further narrows to the empty state when no drive yields a plausible
// efficiency, mirroring the web `displayData.length === 0` gate). The view never performs HTTP — it
// only collects [state] and calls [retry] / [onAppear].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveEfficiencyChartWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.driveefficiencychart

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Drive
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.driving.DrivingStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [DriveEfficiencyChartWidget]. It consumes the
 * cache-then-network [DriveEfficiencyChartSource] (P1/S8) and re-shares it as a single [UiState]
 * stream (loading / content / empty / stale / offline / error), exposing the single retry action plus
 * the PII-safe `view.opened` diagnostic.
 *
 * It owns no networking. [retry] re-collects the source (the web `refetch`) and [onAppear] emits the
 * one-shot `view.opened` diagnostics event with the surface [DriveEfficiencyRegistration.SLUG]
 * (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveEfficiencyChartWidgetViewModel(
    source: DriveEfficiencyChartSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val retryTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The recent drives as cache-then-network UI state (loading / content / empty / stale / error). */
    val state: StateFlow<UiState<List<Drive>>> =
        retryTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** Records the one-shot `view.opened` diagnostics event the first time the surface appears (P1/S11). */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to DriveEfficiencyRegistration.SLUG))
    }

    /** Re-collects the source feed (web `refetch`) — used by the error/offline retry affordance. */
    fun retry() {
        logger.info(EVENT_RETRY)
        retryTrigger.update { it + 1 }
    }

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val FIELD_SURFACE = "surface"
        private const val EVENT_RETRY = "driveEfficiencyChart.retry"

        /**
         * Wire the surface from the shared [DrivingStore] (P1/S8) and the app-wide active-vehicle
         * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An explicit
         * [vehicleId] overrides the active selection (web `vehicleId` prop precedence).
         */
        fun create(
            drivingStore: DrivingStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): DriveEfficiencyChartWidgetViewModel =
            DriveEfficiencyChartWidgetViewModel(
                source = DrivingStoreDriveEfficiencyChartSource(drivingStore, activeVehicleId, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
