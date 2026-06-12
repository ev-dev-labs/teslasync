// The data seam the TelemetryPipelineCard feature view binds to, plus its production bindings over
// the shared data layer. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web component's two data hooks:
//   - `useMQTTStatus()`  -> the normalized Fleet-Telemetry MQTT status (web/src/api/hooks/useTelemetry.ts)
//   - `useQuery(getPollingStatus)` -> the REST polling-engine status (web/src/api/polling.ts)
//
// The MQTT feed is the shared **S8** TelemetryStore / **S7** TelemetryRepository `mqttStatus()` feed
// (already normalized + SI by the shared layer). The polling feed (`GET /polling/status`) has no
// shared store/repository yet, so it is fetched through the same resilient [ApiHttpClient] every
// shared repository builds on, wrapped here as a cache-then-network-shaped [Resource] stream: a
// `Loading` then a terminal `Success`/`Error`, re-collected on every refresh — the native analogue
// of the web `useQuery({ queryFn: getPollingStatus, refetchInterval })` (no durable cache, refetch
// on each tick). This keeps all networking in the data layer; no HTTP touches the view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TelemetryPipelineCard) cannot form a valid Kotlin package.
// `MatchingDeclarationName` / `filename` are suppressed for the co-located bindings.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.telemetrypipelinecard

import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.TelemetryRepository
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.telemetry.TelemetryStatus
import io.teslasync.shared.core.presentation.telemetry.TelemetryStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow

/** `GET /polling/status` path (the client prepends `/api/v1`; never include it here — ADR rule #7). */
internal const val POLLING_STATUS_PATH: String = "/polling/status"

/**
 * Streams the two cache-then-network feeds the card needs: the normalized Fleet-Telemetry MQTT
 * [TelemetryStatus] (`GET /telemetry`, web `useMQTTStatus`) and the [PollEngineStatus]
 * (`GET /polling/status`, web `getPollingStatus`). A narrow seam so the view-model depends on an
 * abstraction (real adapter ↔ test fake), never on a concrete store/repository or the network. Each
 * (re)collection is a fresh stream, so the view-model's refresh trigger re-subscribing performs the
 * web `refetch()` / `refetchInterval`.
 */
interface TelemetryPipelineCardSource {
    /** The cache-then-network normalized MQTT status feed (`GET /telemetry`, web `useMQTTStatus`). */
    fun mqttStatus(): Flow<Resource<TelemetryStatus>>

    /** The polling-engine status feed (`GET /polling/status`, web `getPollingStatus`). */
    fun pollingStatus(): Flow<Resource<PollEngineStatus>>
}

/**
 * Binds the card to the shared **S8** [TelemetryStore] (the memoized, multi-observer MQTT feed every
 * Telemetry surface shares) for liveness, plus the resilient [api] client for the polling-engine
 * status. Use this when a host wants the MQTT feed to fold into the same shared collection as the
 * rest of the app. No HTTP touches the view.
 */
fun telemetryPipelineCardSource(
    telemetry: TelemetryStore,
    api: ApiHttpClient,
    clock: Clock = SystemClock,
): TelemetryPipelineCardSource =
    object : TelemetryPipelineCardSource {
        override fun mqttStatus(): Flow<Resource<TelemetryStatus>> = telemetry.mqttStatus()

        override fun pollingStatus(): Flow<Resource<PollEngineStatus>> = api.pollingStatusFeed(clock)
    }

/**
 * Binds the card to the shared **S7** [TelemetryRepository] (the cold cache-then-network MQTT feed
 * where re-collecting performs a genuine re-fetch) plus the resilient [api] client for the
 * polling-engine status. No HTTP touches the view.
 */
fun telemetryPipelineCardSource(
    telemetry: TelemetryRepository,
    api: ApiHttpClient,
    clock: Clock = SystemClock,
): TelemetryPipelineCardSource =
    object : TelemetryPipelineCardSource {
        override fun mqttStatus(): Flow<Resource<TelemetryStatus>> = telemetry.mqttStatus()

        override fun pollingStatus(): Flow<Resource<PollEngineStatus>> = api.pollingStatusFeed(clock)
    }

/**
 * The polling-engine status as a cache-then-network-shaped [Resource] stream over the resilient
 * shared client: emit `Loading` (no cache — `/polling/status` is not persisted), then the terminal
 * `Success` (stamped with [clock]'s now) or `Error` (the resilient client's already-classified
 * [io.teslasync.shared.core.net.ApiError]). Re-collecting performs the web `refetch()`. Lives in the
 * data layer, so the view stays HTTP-free.
 */
internal fun ApiHttpClient.pollingStatusFeed(clock: Clock): Flow<Resource<PollEngineStatus>> =
    flow {
        emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
        safeRequest<PollEngineStatus>(path = POLLING_STATUS_PATH).fold(
            onSuccess = { emit(Resource.Success(data = it, fetchedAt = clock.nowMillis(), stale = false)) },
            onFailure = { emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = it)) },
        )
    }
