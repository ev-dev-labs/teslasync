// UI-thread-free state holder backing the Drive Telemetry widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx). It binds
// the shared drives + per-drive-telemetry feeds (P1/S8) through [DriveTelemetrySource], projects each
// cache-then-network emission onto the shared [UiState] surface (loading / content / empty / stale /
// offline / error), and exposes the refresh/retry actions plus the PII-safe `view.opened` diagnostic.
// The view never performs HTTP — it only collects [state] and calls [refresh]/[retry]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DriveTelemetryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivetelemetry

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.driving.DrivingStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [DriveTelemetryWidget]. It consumes the
 * cache-then-network [DriveTelemetrySource] (P1/S8) and re-shares it as a single [UiState] stream via
 * [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. A
 * `null`-drive snapshot (no vehicle / no recent drives / resolved-empty list) maps to the empty surface
 * — the web `!latestDrive` "No recent drives" empty state; a present drive maps to content.
 *
 * It owns no networking. [refresh]/[retry] re-collect the source (the web `refetch`) and
 * [recordViewOpened] emits the one-shot `view.opened` diagnostics event with the surface
 * [DriveTelemetryRegistration.SLUG] (P1/S11).
 *
 * @param source the cache-then-network drives + telemetry seam (a shared-data-layer adapter in
 *   production, a fake in tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DriveTelemetryWidgetViewModel(
    private val source: DriveTelemetrySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance), exactly
    // as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The latest drive + telemetry as a lifecycle-aware [UiState]: loading / content / empty (no recent
     * drive) / stale / offline / error, carrying the freshness stamp + error kind. Empty mirrors the web
     * `!latestDrive` gate (no vehicle, no recent drives, or a resolved-empty list).
     */
    val state: StateFlow<UiState<DriveTelemetrySnapshot>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState { it.drive == null }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance). */
    fun refresh() {
        logger.info("driveTelemetry.refresh")
        refreshTrigger.update { it + 1 }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no vehicle id, location, distance or telemetry payload, so a diagnostics line can
     * never leak fleet data. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to DriveTelemetryRegistration.SLUG))
    }

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: DriveTelemetrySource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { DriveTelemetryWidgetViewModel(source, logger) }
            }

        /**
         * Wire the surface from the shared [VehiclesStore] + [DrivingStore] (P1/S8). An explicit
         * [vehicleId] overrides the first-enrolled-vehicle fallback (web `vehicleId` prop precedence).
         */
        fun create(
            vehiclesStore: VehiclesStore,
            drivingStore: DrivingStore,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): DriveTelemetryWidgetViewModel =
            DriveTelemetryWidgetViewModel(
                source = driveTelemetrySource(vehiclesStore, drivingStore, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
