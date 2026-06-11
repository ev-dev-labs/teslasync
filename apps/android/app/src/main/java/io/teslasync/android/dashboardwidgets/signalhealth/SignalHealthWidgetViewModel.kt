package io.teslasync.android.dashboardwidgets.signalhealth

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.firstOrNull

/**
 * State holder backing the Compose [SignalHealthWidget] — the Android port of the web
 * `SignalHealthWidget`'s hook composition
 * (`web/src/features/dashboard/widgets/SignalHealthWidget.tsx`).
 *
 * It binds the injected [SignalHealthSource] (the P1/S8 shared-layer seam) to a lifecycle-aware
 * [UiState] of the projected [SignalHealthData]: the fleet list resolves the default vehicle (web
 * `vehicles?.[0]?.id`) unless a [vehicleId] is supplied, the catalog gives the Total Signals count (web
 * `useSignals`), the live-gap map drives the active/stale split + freshness age (web `useSignalGaps`),
 * and the stats feed drives the panel's loading / freshness / error envelope (web `useSignalStats`).
 * The result covers every state the web widget renders — loading, content, empty (web `!hasData`),
 * hard error, and — through the ADR-013 freshness contract — stale / offline (cached analysis kept
 * visible with the staleness + error flags). The view stays a thin renderer; it performs no HTTP
 * (ADR-002).
 *
 * [refresh]/[retry] re-fetch the stats + catalog + live-gap feeds through the source (web
 * `refetchStats()`), and [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once
 * per surface open.
 *
 * @param source the shared vehicles + telemetry seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the
 *   first enrolled vehicle.
 */
class SignalHealthWidgetViewModel(
    private val source: SignalHealthSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The projected signal-health analysis as cache-then-network UI state (no resolved feed ⇒ Empty). */
    val state: StateFlow<UiState<SignalHealthData>> =
        signalHealthResource(
            source = source,
            preferredVehicleId = vehicleId,
        ).asUiState { !it.hasData }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("slug" to SignalHealthRegistration.SLUG))
    }

    /** Re-fetches the stats + catalog + live-gap feeds (web `refetchStats()`); resolves the id first. */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("slug" to SignalHealthRegistration.SLUG))
        launch {
            val id = vehicleId?.takeIf { it > 0L } ?: firstVehicleId(source.vehicles().firstOrNull()?.cached)
            id?.let { source.refresh(it) }
        }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "signalHealth.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: SignalHealthSource,
            logger: Logger,
            vehicleId: Long? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { SignalHealthWidgetViewModel(source, logger, vehicleId = vehicleId) }
            }
    }
}
