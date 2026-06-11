// UI-thread-free state holder backing the Speed Heatmap widget — the native port of the web component's
// hook composition (web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx). It binds the shared data
// feeds (P1/S8) through [SpeedHeatmapSource]: when no explicit vehicle is configured it resolves the
// default vehicle from the `useVehicles` list (web `vehicleId ?? vehicles?.[0]?.id`), then projects the
// `/drives?vehicle_id=&limit=200` cache-then-network list onto the shared [UiState] surface (loading /
// content / empty / stale / offline / error). It exposes the single refresh action plus the PII-safe
// `view.opened` diagnostic. The view never performs HTTP — it only collects [state] and calls
// [refresh]/[recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SpeedHeatmapWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.speedheatmap

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Drive
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
 * Lifecycle-aware state holder backing the Compose [SpeedHeatmapWidget].
 *
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in tests).
 *   The view-model owns no networking — it only resolves the default vehicle and projects the feeds.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param vehicleId the explicitly configured vehicle (web `WidgetProps.vehicleId`). When `null`/non-positive
 *   the first enrolled vehicle is used, exactly as the web `vehicles?.[0]?.id` fallback does.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SpeedHeatmapWidgetViewModel(
    private val source: SpeedHeatmapSource,
    logger: Logger,
    private val vehicleId: Long? = null,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the manual refetch affordance),
    // exactly as the shared store's own trigger ▸ flatMapLatest pipeline does for its memoized feeds.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The drive list as cache-then-network UI state (loading / content / empty / stale / offline / error),
     * carrying the freshness stamp + error kind. Empty mirrors the web `totalDrives > 0` gate — the
     * no-vehicle disabled query, an empty drive list, AND a list whose drives all lack a positive speed all
     * resolve to the empty surface (no cell would render).
     */
    val state: StateFlow<UiState<List<Drive>>> =
        refreshTrigger
            .flatMapLatest { speedHeatmapResource(source.vehicles(), vehicleId) { id -> source.drives(id.toString()) } }
            .asUiState(isEmpty = { drives -> drives.none(::hasRenderableSpeed) })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun refresh() {
        logger.info("speedHeatmap.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no drive speed / location / vehicle payload, so a diagnostics line can never leak how
     * or where the owner drove. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to SpeedHeatmapRegistration.SLUG))
    }

    companion object {
        /**
         * Wire the surface from the shared [VehiclesStore] + [DrivingStore] (P1/S8). An explicit [vehicleId]
         * overrides the default-vehicle resolution (web `vehicleId` prop precedence). The holder runs on
         * `viewModelScope`; a custom scope is a test-only concern handled via the constructor.
         */
        fun create(
            vehiclesStore: VehiclesStore,
            drivingStore: DrivingStore,
            logger: Logger,
            vehicleId: Long? = null,
        ): SpeedHeatmapWidgetViewModel =
            SpeedHeatmapWidgetViewModel(
                source = speedHeatmapSource(vehiclesStore, drivingStore),
                logger = logger,
                vehicleId = vehicleId,
            )
    }
}
