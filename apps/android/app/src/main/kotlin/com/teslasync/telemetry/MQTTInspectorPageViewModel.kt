// The state holder backing the MQTTInspectorPage telemetry surface (P1/S8) — the native counterpart of the web
// page's single TanStack-Query hook plus its client-side throughput accumulator
// (web/src/features/telemetry/pages/MQTTInspectorPage.tsx). It projects the one cache-then-network MQTT-status read
// (`useMQTTStatus`) onto the shared lifecycle-aware [UiState] surface via [BaseFeedViewModel.asUiState], and derives
// the throughput series by folding successive status snapshots through the framework-free [ThroughputAccumulator]
// (the native port of the web `throughputHistory` `useEffect`). All derivation logic lives in the framework-free
// model (MQTTInspectorPageModel.kt) and the seam (MQTTInspectorPageSource.kt); this holder is the thin orchestration
// layer and performs no HTTP.
//
// Both exposed flows ([state] and [throughput]) share the SAME upstream `Resource` feed: [throughput] scans over
// [state] rather than re-opening the network read, so the page collecting both never fans out two `GET /telemetry`
// streams. The history is re-shared with `WhileSubscribed`, so it accumulates only while the screen observes it and
// resets when the screen leaves — mirroring the web effect's per-mount lifetime.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.mqttinspector

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * @param source the P1/S8 data seam (real [io.teslasync.shared.core.data.repo.TelemetryRepository] adapter ↔ test
 *   fake); the view never performs HTTP.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param now wall-clock seam stamping each throughput sample (web `new Date()`); injectable for deterministic tests.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class MQTTInspectorPageViewModel(
    private val source: MQTTInspectorPageSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val now: () -> Long = System::currentTimeMillis,
) : BaseFeedViewModel(logger, scope) {
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The normalized MQTT status as a lifecycle-aware [UiState]: loading (first fetch) / content (a status with
     * data) / empty (the normalizer returned a default/absent status — web `noStatus`) / stale / offline / error.
     * Re-collected whenever the refresh trigger bumps. The empty boundary is [isEmptyStatus] so a disconnected,
     * vehicle-less, topic-less status renders the friendly empty state rather than a populated-but-blank grid.
     */
    val state: StateFlow<UiState<TelemetryStatus>> =
        refreshTrigger
            .flatMapLatest { source.mqttStatus() }
            .asUiState(isEmpty = ::isEmptyStatus)

    /**
     * The client-accumulated throughput series (web `throughputHistory`), folded from successive [state] snapshots
     * through [ThroughputAccumulator] at the injected wall clock. Scans over [state] (not a second network read),
     * so it shares the single `GET /telemetry` upstream; re-shared with `WhileSubscribed` so it accumulates only
     * while observed and resets on resubscribe, exactly as the web effect re-runs per mount.
     */
    val throughput: StateFlow<List<ThroughputPoint>> =
        state
            .scan(ThroughputAccumulator()) { acc, ui -> acc.next(ui.data, now()) }
            .map { it.points }
            .stateIn(stateScope, SharingStarted.WhileSubscribed(THROUGHPUT_SHARE_TIMEOUT_MILLIS), emptyList())

    /** Re-collect the MQTT-status feed — the web query's 5s `refetchInterval` / the page error-retry affordance. */
    fun refresh() {
        logger.info(EVENT_REFRESH)
        refreshTrigger.update { it + 1 }
    }

    /** Retry affordance for the status feed's hard-error surface. */
    fun retry(): Unit = refresh()

    /** Emit the one-shot, PII-safe `view.opened` diagnostic with the surface slug (P1/S11). */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordMqttInspectorPageOpened(logger)
    }

    private companion object {
        const val EVENT_REFRESH = "mqtt-inspector.refresh"

        /** Keep the throughput history's upstream alive briefly across config changes / fast re-subscribes. */
        const val THROUGHPUT_SHARE_TIMEOUT_MILLIS = 5_000L
    }
}
