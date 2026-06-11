package io.teslasync.android.dashboardwidgets.livesignalsparklines

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
 * State holder backing the Compose [LiveSignalSparklinesWidget] — the Android port of the web
 * `LiveSignalSparklinesWidget`'s hook composition (`web/src/features/dashboard/widgets/
 * LiveSignalSparklinesWidget.tsx`).
 *
 * It binds the injected [LiveSignalSparklinesSource] (the P1/S8 shared-layer seam) to a lifecycle-aware
 * [UiState] of the projected [LiveSignalSparklinesData]: the fleet list resolves the default vehicle (web
 * `vehicles?.[0]?.id`) unless a [vehicleId] is supplied, the catalog narrows the configured signals (web
 * `useSignals`), the realtime feed drives each row's value + the freshness header (web `useSignalGaps`),
 * and each row's trailing-hour history backs its sparkline + trend (web `useSignalHistory`). The result
 * covers every state the web widget renders — loading, content, empty (no configured/available signals ⇒
 * `configuredSignals.length === 0`), hard error, and — through the ADR-013 freshness contract — stale /
 * offline (cached rows kept visible with the staleness + error flags). The view stays a thin renderer; it
 * performs no HTTP (ADR-002).
 *
 * [refresh]/[retry] re-fetch the realtime + catalog feeds through the source (web `refetchLive()`), and
 * [onViewOpened] emits the P1/S11 `view.opened` diagnostics event exactly once per surface open.
 *
 * @param source the shared vehicles + signals seam.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 * @param vehicleId the widget's bound vehicle (web `WidgetProps.vehicleId`); `null` defaults to the first
 *   enrolled vehicle.
 * @param configuredSignals the host-configured signal names (web `config.signals`); `null` uses the
 *   built-in [DEFAULT_SIGNALS].
 */
class LiveSignalSparklinesWidgetViewModel(
    private val source: LiveSignalSparklinesSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val vehicleId: Long? = null,
    private val configuredSignals: List<String>? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The projected sparkline rows as cache-then-network UI state (no configured signals ⇒ Empty). */
    val state: StateFlow<UiState<LiveSignalSparklinesData>> =
        liveSparklinesResource(
            source = source,
            preferredVehicleId = vehicleId,
            configSignals = configuredSignals,
        ).asUiState { it.isEmpty }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info(EVENT_VIEW_OPENED, mapOf("slug" to LiveSignalSparklinesRegistration.SLUG))
    }

    /** Re-fetches the realtime + catalog feeds (web `refetchLive()`); resolves the id, then asks the source. */
    fun refresh() {
        logger.info(EVENT_REFRESH, mapOf("slug" to LiveSignalSparklinesRegistration.SLUG))
        launch {
            val id = vehicleId?.takeIf { it > 0L } ?: firstVehicleId(source.vehicles().firstOrNull()?.cached)
            id?.let { source.refresh(it) }
        }
    }

    /** Retry after a failure — identical to [refresh]; backs the error surface's retry affordance. */
    fun retry() = refresh()

    companion object {
        private const val EVENT_VIEW_OPENED = "view.opened"
        private const val EVENT_REFRESH = "liveSignalSparklines.refresh"

        /** A [ViewModelProvider.Factory] a dashboard host uses to construct this surface's ViewModel. */
        fun factory(
            source: LiveSignalSparklinesSource,
            logger: Logger,
            vehicleId: Long? = null,
            configuredSignals: List<String>? = null,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer {
                    LiveSignalSparklinesWidgetViewModel(source, logger, vehicleId = vehicleId, configuredSignals = configuredSignals)
                }
            }
    }
}
