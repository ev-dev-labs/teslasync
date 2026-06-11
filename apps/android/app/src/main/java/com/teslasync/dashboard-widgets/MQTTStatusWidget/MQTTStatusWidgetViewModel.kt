// UI-thread-free state holder backing the MQTT Status widget — the native port of the web component's hook
// composition (web/src/features/dashboard/widgets/MQTTStatusWidget.tsx). It binds the shared Telemetry feed
// (P1/S8) through [MqttStatusSource], projecting each cache-then-network emission onto the shared [UiState]
// surface (loading / content / empty / stale / offline / error) and carrying the freshness stamp + error
// kind, then exposes the single refresh action plus the PII-safe `view.opened` diagnostic. The view never
// performs HTTP — it only collects [state] and calls [refresh] / [recordViewOpened].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/MQTTStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mqttstatus

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network Telemetry seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only projects this feed.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh` events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MQTTStatusWidgetViewModel(
    private val source: MqttStatusSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects the cache-then-network feed (the web `refetch()` affordance); the
    // repository-backed source re-fetches on re-subscribe, exactly as the shared store's own
    // trigger ▸ flatMapLatest pipeline does for its memoized feed.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The normalized MQTT status as a lifecycle-aware [UiState]: loading (no cache) / content / stale /
     * offline / error, carrying the freshness stamp + error kind. A present status always renders the body
     * (web `data ? body : <EmptyState>`); the empty surface is the defensive no-status branch, so the
     * payload is never treated as structurally empty here.
     */
    val state: StateFlow<UiState<TelemetryStatus>> =
        refreshTrigger
            .flatMapLatest { source.stream() }
            .asUiState(isEmpty = { false })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the freshness/error retry). */
    fun refresh() {
        logger.info("mqttStatus.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no broker address, VIN, or message-rate payload, so a diagnostics line can never leak
     * the fleet's telemetry posture. Call from the composable's first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        logger.info("view.opened", mapOf("surface" to MqttStatusRegistration.SLUG))
    }

    companion object {
        /**
         * Wire the surface from the shared **S7** [TelemetryRepository] — the cold cache-then-network feed
         * where the refresh trigger re-subscribing performs a genuine re-fetch (the web `refetch()`).
         */
        fun create(
            repository: TelemetryRepository,
            logger: Logger,
        ): MQTTStatusWidgetViewModel = MQTTStatusWidgetViewModel(repository.asMqttStatusSource(), logger)

        /**
         * Wire the surface from the shared **S8** [TelemetryStore] — the memoized, multi-observer MQTT-status
         * feed every Telemetry surface shares (incl. its REALTIME-cadence background refresh).
         */
        fun create(
            store: TelemetryStore,
            logger: Logger,
        ): MQTTStatusWidgetViewModel = MQTTStatusWidgetViewModel(store.asMqttStatusSource(), logger)
    }
}
