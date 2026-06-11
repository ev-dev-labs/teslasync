package io.teslasync.android.dashboardwidgets.batteryradialgauge

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.firstOrNull

/**
 * State holder backing the Compose [BatteryRadialGaugeWidget] — the Android port of the web
 * `BatteryRadialGaugeWidget`'s hook composition (`web/src/features/dashboard/widgets/
 * BatteryRadialGaugeWidget.tsx`).
 *
 * It binds the injected [BatteryRadialGaugeSource] (the P1/S8 shared-layer seam) to a lifecycle-aware
 * [UiState] of the active vehicle's [VehicleStateEnvelope]: the fleet list resolves the default vehicle
 * (web `vehicles?.[0]?.id`) unless a [vehicleId] is supplied, and the resulting state feed drives every
 * state the web widget renders — loading, content, empty (no decodable state ⇒ `state == null`), hard
 * error, and — through the ADR-013 freshness contract — stale / offline (cached state kept visible with
 * the staleness + error flags). The view stays a thin renderer; it performs no HTTP (ADR-002).
 *
 * [refresh]/[retry] re-fetch the active vehicle through the source, and [onViewOpened] emits the P1/S11
 * `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared vehicles + vehicle-state seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the
 *   first enrolled vehicle.
 */
class BatteryRadialGaugeWidgetViewModel(
    private val source: BatteryRadialGaugeSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The active vehicle's last-known state as cache-then-network UI state (`state == null` ⇒ Empty). */
    val state: StateFlow<UiState<VehicleStateEnvelope>> =
        batteryRadialGaugeResource(source.vehicles(), vehicleId, source::vehicleState)
            .asUiState { it.state == null }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("slug" to BatteryRadialGaugeRegistration.SLUG))
    }

    /** Re-fetches the active vehicle's state (web `refetch()`); resolves the id, then asks the source. */
    fun refresh() {
        logger.info("batteryRadialGauge.refresh")
        launch {
            val id = vehicleId?.takeIf { it > 0L } ?: firstVehicleId(source.vehicles().firstOrNull()?.cached)
            id?.let { source.refresh(it) }
        }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: BatteryRadialGaugeSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { BatteryRadialGaugeWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
