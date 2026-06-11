// UI-thread-free state holder backing the Charging Telemetry widget — the native port of the web
// component's hook composition (web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx). It
// binds the shared cache-then-network [ChargingTelemetrySource] (P1/S8), projects each emission onto
// the shared [UiState] surface (loading / content / empty / stale / offline / error), accumulates the
// rolling power-reading series the wide sparkline draws (the web `powerHistoryRef`), and exposes the
// single retry action plus the PII-safe `view.opened` diagnostic. The view never performs HTTP — it
// only collects [state] / [powerHistory] and calls [retry] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ChargingTelemetryWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.chargingtelemetry

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * Lifecycle-aware state holder backing the Compose [ChargingTelemetryWidget]. It consumes the
 * cache-then-network [ChargingTelemetrySource] (P1/S8) and re-shares it as a single [UiState] stream
 * via [BaseFeedViewModel.asUiState], so the screen stays a stateless Composable that only renders. A
 * `null` snapshot (no vehicle / no body) AND an inactive (`charging_state != 'Charging'`) snapshot
 * both map to the empty surface — the web "Not currently charging" empty state; an actively-charging
 * snapshot maps to content. The [powerHistory] series accumulates one watt reading per distinct
 * snapshot timestamp (web `powerHistoryRef`), capped at [PowerHistoryAccumulator.MAX_POWER_HISTORY].
 *
 * It owns no networking. [retry] re-collects the source (the web `refetch`) and [recordViewOpened]
 * emits the one-shot `view.opened` diagnostics event with the surface
 * [ChargingTelemetryRegistration.SLUG] (P1/S11).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ChargingTelemetryWidgetViewModel(
    source: ChargingTelemetrySource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val retryTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    // Re-collecting this feed performs a genuine cache-then-network re-fetch (the manual retry
    // affordance), exactly as the shared store's own trigger ▸ flatMapLatest pipeline does.
    private val snapshots: Flow<Resource<ChargingTelemetrySnapshot?>> =
        retryTrigger.flatMapLatest { source.stream() }

    /**
     * The latest telemetry as cache-then-network UI state. Empty mirrors the web empty-state gate:
     * a `null` snapshot OR one whose `charging_state` is not `Charging` both surface as
     * [io.teslasync.android.data.UiPhase.Empty].
     */
    val state: StateFlow<UiState<ChargingTelemetrySnapshot?>> =
        snapshots.asUiState(isEmpty = { it == null || !it.isCharging })

    /**
     * The rolling power-reading series the wide sparkline draws (web `powerHistoryRef.current`),
     * folded across emissions and de-duplicated by snapshot timestamp. Empty until at least one
     * reading arrives; the view only draws the sparkline once it holds more than one point.
     */
    val powerHistory: StateFlow<List<Double>> =
        snapshots
            .map { it.cached }
            .scan(PowerHistoryAccumulator.EMPTY) { accumulator, snapshot -> accumulator.append(snapshot) }
            .map { it.values }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(POWER_HISTORY_STOP_TIMEOUT_MS),
                initialValue = emptyList(),
            )

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once
     * per holder. Carries no vehicle id or telemetry payload, so a diagnostics line can never leak a
     * vehicle's charging state. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to ChargingTelemetryRegistration.SLUG))
    }

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the error-surface retry). */
    fun retry() {
        logger.info("chargingTelemetry.retry")
        retryTrigger.update { it + 1 }
    }

    companion object {
        // Keep the power-history fold's upstream alive briefly across config changes / fast re-subscribes.
        private const val POWER_HISTORY_STOP_TIMEOUT_MS = 5_000L

        /**
         * Wire the surface from the shared [VehiclesStore] (P1/S8) and the app-wide active-vehicle
         * selection ([activeVehicleId], typically `SelectedVehicleStore.selectedId`). An explicit
         * [vehicleId] overrides the active selection (web `vehicleId` prop precedence).
         */
        fun create(
            vehiclesStore: VehiclesStore,
            activeVehicleId: StateFlow<Long?>,
            logger: Logger,
            vehicleId: Long? = null,
            scope: CoroutineScope? = null,
        ): ChargingTelemetryWidgetViewModel =
            ChargingTelemetryWidgetViewModel(
                source = VehiclesStoreChargingTelemetrySource(vehiclesStore, activeVehicleId, vehicleId),
                logger = logger,
                scope = scope,
            )
    }
}
