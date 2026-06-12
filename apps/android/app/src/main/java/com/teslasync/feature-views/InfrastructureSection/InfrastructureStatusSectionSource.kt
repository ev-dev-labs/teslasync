// The data seam the system-status Infrastructure section binds to, plus its production binding over the
// shared resilient HTTP client + offline cache. The view (composable) performs NO HTTP — it collects state
// from the ViewModel, which drives this seam, satisfying the "no direct HTTP from the view" contract while
// reproducing the web component's two polled `useQuery` feeds (GET /telemetry and GET /system/health).
//
// Why a dedicated cache-then-network seam and not the shared TelemetryStore: the shared
// TelemetryRepository.mqttStatus() normalizes GET /telemetry to the `useMQTTStatus` read model
// (connected/broker/vehicles/topics) and drops the exact fields this surface renders (enabled, mode,
// endpoint, protocol, speed_comparison) — binding to it would be a parity shortcut. The web surface reads
// the raw GET /telemetry shape via `getTelemetryStatus()`. Reproducing that — and the raw GET /system/health
// shape `getExtendedHealth()` reads — requires raw [JsonElement] feeds, which this file builds over the same
// shared [ApiHttpClient] + [CacheStore] machinery every S7 repository uses (auto `/api/v1` prefix,
// retry/backoff, circuit breaker, [io.teslasync.shared.core.net.ApiError] mapping, ADR-013 cache-then-network
// with an explicit per-feed staleness TTL mirroring the web `refetchInterval`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InfrastructureSection) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infrastructurestatus

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.data.repo.CachingRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.defaultApiJson
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** `GET /telemetry` — the raw telemetry-status payload the web `getTelemetryStatus()` reads. */
private const val TELEMETRY_PATH = "/telemetry"

/** `GET /system/health` — the raw extended-health payload the web `getExtendedHealth()` reads. */
private const val HEALTH_PATH = "/system/health"

/** Cache/feed key for the telemetry-status feed. */
private const val KEY_TELEMETRY = "system-status|telemetry"

/** Cache/feed key for the system-health feed. */
private const val KEY_HEALTH = "system-status|system-health"

/** Staleness TTL for the telemetry feed — the web `refetchInterval: 2_000` poll cadence. */
private const val TELEMETRY_TTL_MILLIS = 2_000L

/** Staleness TTL for the health feed — the web `refetchInterval: 30_000` poll cadence. */
private const val HEALTH_TTL_MILLIS = 30_000L

/**
 * The single seam the [InfrastructureStatusSectionViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete client — the Android analogue of the web component's two
 * `useQuery(getTelemetryStatus | getExtendedHealth)` calls (P1/S8 state-holder boundary). Each function
 * streams a cache-then-network [Resource] of the raw server [JsonElement] (ADR-013). No HTTP touches the view.
 */
interface InfrastructureStatusSectionSource {
    /** `GET /telemetry` cache-then-network feed (web `getTelemetryStatus`, refetch 2s). */
    fun telemetryStatus(): Flow<Resource<JsonElement>>

    /** `GET /system/health` cache-then-network feed (web `getExtendedHealth`, refetch 30s). */
    fun systemHealth(): Flow<Resource<JsonElement>>
}

/**
 * Binds the surface to the shared resilient [ApiHttpClient] + offline [cache]. The two raw feeds are built
 * on the same generic cache-then-network operator every S7 repository uses ([CachingRepository.observe]), so
 * each first replays its last cached value for an instant cold start, then refreshes; a transport fault keeps
 * the cached value visible flagged stale (offline / last-known) rather than blanking the cards. A host
 * constructs the surface with `api.asInfrastructureStatusSectionSource(cache)`, exactly as a page host binds
 * a sibling surface with `store.as…Source()`. No HTTP touches the view.
 */
fun ApiHttpClient.asInfrastructureStatusSectionSource(
    cache: CacheStore,
    clock: Clock = SystemClock,
    json: Json = defaultApiJson,
): InfrastructureStatusSectionSource {
    val feeds = InfrastructureStatusFeeds(this, cache, clock, json)
    return object : InfrastructureStatusSectionSource {
        override fun telemetryStatus(): Flow<Resource<JsonElement>> = feeds.telemetry()

        override fun systemHealth(): Flow<Resource<JsonElement>> = feeds.health()
    }
}

/**
 * The cache-then-network feeds backing the surface — a thin [CachingRepository] over the resilient client,
 * sharing the [CacheDomain.System] partition with the other system-status reads, with an explicit per-feed
 * TTL so each flags staleness on its own web-faithful threshold (telemetry 2s, health 30s).
 */
private class InfrastructureStatusFeeds(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock,
    json: Json,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()) {
    override val domain: CacheDomain = CacheDomain.System

    fun telemetry(): Flow<Resource<JsonElement>> =
        observe(KEY_TELEMETRY, TELEMETRY_TTL_MILLIS) { api.request<JsonElement>(path = TELEMETRY_PATH) }

    fun health(): Flow<Resource<JsonElement>> = observe(KEY_HEALTH, HEALTH_TTL_MILLIS) { api.request<JsonElement>(path = HEALTH_PATH) }
}
