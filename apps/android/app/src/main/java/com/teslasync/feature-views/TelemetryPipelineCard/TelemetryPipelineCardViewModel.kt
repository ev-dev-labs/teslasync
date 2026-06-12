// UI-thread-free state holder backing the TelemetryPipelineCard feature view — the native port of the
// web component's hook composition (web/src/features/system/components/status/TelemetryPipelineCard.tsx).
// It binds the shared Telemetry feed (P1/S8) + the polling-engine feed through
// [TelemetryPipelineCardSource], composing the two cache-then-network streams onto the shared [UiState]
// surface (loading / content / stale / offline / error) and carrying the freshness stamp + error kind.
//
// MQTT (`useMQTTStatus`) is the spine that drives the surface phase (it is THE telemetry-liveness feed);
// the polling-engine status is folded in best-effort from whatever is cached, so a still-loading or
// failed polling feed never blanks the surface — exactly like the web renders polling data
// opportunistically with `?.` and section guards. It exposes the single refresh action plus the PII-safe
// `view.opened` diagnostic; the view performs no HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TelemetryPipelineCard) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.telemetrypipelinecard

import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.update

/**
 * @param source the cache-then-network seam (a shared-data-layer adapter in production, a fake in
 *   tests). The view-model owns no networking — it only composes the two feeds and projects them.
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + `refresh`.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TelemetryPipelineCardViewModel(
    private val source: TelemetryPipelineCardSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    // Bumping the trigger re-collects both cache-then-network feeds (the web `refetch()` /
    // `refetchInterval` affordance); the repository-backed source re-fetches on re-subscribe.
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /**
     * The composed feeds as a lifecycle-aware [UiState]: loading (no cache) / content / stale /
     * offline / error, carrying the freshness stamp + error kind from the **MQTT** feed (the spine).
     * A present payload always renders the card body (the empty no-vehicles surface is a content
     * sub-state, mirroring the web's empty-list branch which keeps the rollup grid + footer), so the
     * payload is never treated as structurally empty here.
     */
    val state: StateFlow<UiState<TelemetryPipelineFeeds>> =
        refreshTrigger
            .flatMapLatest { composedFeed() }
            .asUiState(isEmpty = { false })

    /** Re-runs the cache-then-network load (the web `refetch()` affordance + the freshness/error retry). */
    fun refresh() {
        logger.info("telemetryPipeline.refresh")
        refreshTrigger.update { it + 1 }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per
     * holder. Carries no VIN, broker, or message-rate payload. Call from the composable's
     * first-composition effect.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordTelemetryPipelineCardOpened(logger)
    }

    private fun composedFeed(): Flow<Resource<TelemetryPipelineFeeds>> =
        combine(source.mqttStatus(), source.pollingStatus()) { mqtt, polling ->
            combinePipelineResources(mqtt, polling)
        }

    companion object {
        /** Wire the surface from the shared **S8** [TelemetryStore] (MQTT) + the resilient [api] client. */
        fun create(
            telemetry: TelemetryStore,
            api: ApiHttpClient,
            logger: Logger,
        ): TelemetryPipelineCardViewModel = TelemetryPipelineCardViewModel(telemetryPipelineCardSource(telemetry, api), logger)

        /** Wire the surface from the shared **S7** [TelemetryRepository] (MQTT) + the resilient [api] client. */
        fun create(
            telemetry: TelemetryRepository,
            api: ApiHttpClient,
            logger: Logger,
        ): TelemetryPipelineCardViewModel = TelemetryPipelineCardViewModel(telemetryPipelineCardSource(telemetry, api), logger)
    }
}

/**
 * Composes the two feeds with MQTT as the spine and polling folded in best-effort: the MQTT phase /
 * freshness drives the resulting [Resource], while the polling status is always folded into the
 * payload from whatever it has cached (a still-loading or failed polling feed never blanks the
 * surface — the web reads it opportunistically). Extracted as a pure function so the gate unit-tests
 * the spine/best-effort contract without a coroutine host.
 */
internal fun combinePipelineResources(
    mqtt: Resource<TelemetryStatus>,
    polling: Resource<PollEngineStatus>,
): Resource<TelemetryPipelineFeeds> {
    val data = TelemetryPipelineFeeds(mqtt = mqtt.cached, polling = polling.cached)
    return when (mqtt) {
        is Resource.Loading ->
            if (mqtt.cached == null) {
                Resource.Loading(cached = null, fetchedAt = mqtt.fetchedAt, stale = mqtt.stale)
            } else {
                Resource.Loading(cached = data, fetchedAt = mqtt.fetchedAt, stale = mqtt.stale)
            }
        is Resource.Error ->
            if (mqtt.cached == null) {
                Resource.Error(cached = null, fetchedAt = mqtt.fetchedAt, stale = mqtt.stale, error = mqtt.error)
            } else {
                Resource.Error(cached = data, fetchedAt = mqtt.fetchedAt, stale = true, error = mqtt.error)
            }
        is Resource.Success -> Resource.Success(data = data, fetchedAt = mqtt.fetchedAt, stale = mqtt.stale)
    }
}
