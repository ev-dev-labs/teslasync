package io.teslasync.android.dashboard.widgets

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * Canonical registry metadata for the Battery Cells surface — the native mirror of the web registry
 * entry in web/src/features/dashboard/widgets/registry/battery.ts. A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint constraints.
 */
object BatteryCellsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "battery-cells"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "battery"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BatteryCellsWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: BatteryCellsSize get() = BatteryCellsSize.Default

    /** Minimum footprint: 2 columns × 4 rows. */
    val minSize: BatteryCellsSize get() = BatteryCellsSize.MinSize

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: BatteryCellsSize get() = BatteryCellsSize.MaxSize

    /** True when [size] falls within the supported footprint constraints. */
    fun withinBounds(size: BatteryCellsSize): Boolean = BatteryCellsSize.withinBounds(size)

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: BatteryCellsSize): BatteryCellsSize = BatteryCellsSize.clamp(size)
}

/**
 * Lifecycle-aware state holder backing the Compose [BatteryCellsWidget] — the native port of the web
 * `BatteryCellsWidget`'s hook composition (web/src/features/dashboard/widgets/BatteryCellsWidget.tsx).
 * It consumes the cache-then-network [BatteryCellsSource] (P1/S8) and re-shares it as a single
 * [UiState] stream via [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that
 * only renders. A `null` summary (no vehicle / no body) maps to the empty surface; a present summary
 * (even all-zero) maps to content, mirroring the web `data ?` gate.
 *
 * It owns no networking. [retry] re-collects the source (the web `refetch`) and [onAppear] emits the
 * one-shot `view.opened` diagnostics event with the surface [BatteryCellsRegistration.SLUG] (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class BatteryCellsWidgetViewModel(
    private val source: BatteryCellsSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val retryTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The battery-cell summary as cache-then-network UI state (loading / content / empty / stale / error). */
    val state: StateFlow<UiState<BatteryCellSummary?>> =
        retryTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { it == null })

    /** Records the one-shot `view.opened` diagnostics event the first time the surface appears. */
    fun onAppear() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to BatteryCellsRegistration.SLUG))
    }

    /** Re-collects the source feed (web `refetch`) — used by the error/offline retry affordance. */
    fun retry() {
        logger.info("battery_cells.retry")
        retryTrigger.update { it + 1 }
    }

    companion object {
        /**
         * Wire the surface from the shared [EnergyStore] (P1/S8) and the app-wide active-vehicle
         * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An explicit
         * [vehicleId] overrides the active selection (web `vehicleId` prop precedence).
         */
        fun create(
            energyStore: EnergyStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): BatteryCellsWidgetViewModel =
            BatteryCellsWidgetViewModel(
                source = EnergyStoreBatteryCellsSource(energyStore, activeVehicleId, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
