package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [AnalyticsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every Analytics feed shares the single [CacheDomain.Analytics] partition, keyed
 * by a stable per-feed string that mirrors the web TanStack query keys, so a feed can be read
 * independently while logout still clears the whole domain in one call.
 *
 * The domain is read-only (the web `useAnalytics` file declares zero mutations), so there are
 * no eviction paths here. Reads go through the generic cache-then-network operator
 * ([observe]); the envelope-unwrapping reads ([monthlyMileage], [dailyMileage], [timeline])
 * apply [unwrapArray] and [stateSummary] applies [safeArray] so the cached payload is already
 * a guaranteed array — exactly the web `select` derivations, performed before the cache write.
 *
 * Per-feed staleTime intent from the web hooks (e.g. `STALE_TIMES.STATIC` on
 * [weeklyDigest]/[yearReview], `STALE_TIMES.SLOW` on [lifetimeStats]) maps onto the domain's
 * 10-minute freshness window; finer-grained "never auto-refetch" cadence is a UI concern (the
 * S8/platform layer chooses when to re-collect), mirroring how the web `staleTime` only gates
 * the freshness flag, not whether the cache-then-network refresh runs.
 */
public class HttpAnalyticsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    AnalyticsRepository {
    override val domain: CacheDomain = CacheDomain.Analytics

    override fun analyticsSummary(days: Int): Flow<Resource<JsonElement>> =
        observe("$KEY_SUMMARY:$days") {
            api.request<JsonElement>(path = "/analytics/fleet", query = mapOf("days" to days.toString()))
        }

    override fun fleetAnalytics(
        days: Int?,
        start: String?,
        end: String?,
    ): Flow<Resource<JsonElement>> =
        observe("$KEY_FLEET:$days:$start:$end") {
            api.request<JsonElement>(path = "/analytics/fleet", query = fleetQuery(days, start, end))
        }

    override fun mileageStats(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_MILEAGE:$vehicleId") {
            api.request<JsonElement>(path = "/mileage/stats", query = mapOf("vehicle_id" to vehicleId))
        }

    override fun monthlyMileage(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_MONTHLY:$vehicleId") {
            unwrapArray(
                api.request<JsonElement>(path = "/mileage/monthly", query = mapOf("vehicle_id" to vehicleId)),
                "months",
            )
        }

    override fun dailyMileage(
        vehicleId: String,
        days: Int,
    ): Flow<Resource<JsonElement>> =
        observe("$KEY_DAILY:$vehicleId:$days") {
            unwrapArray(
                api.request<JsonElement>(
                    path = "/mileage/daily",
                    query = mapOf("vehicle_id" to vehicleId, "days" to days.toString()),
                ),
                "days",
            )
        }

    override fun costBreakdown(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_COST:$vehicleId") {
            api.request<JsonElement>(path = "/analytics/tco", query = mapOf("vehicle_id" to vehicleId))
        }

    override fun timeline(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_TIMELINE:$vehicleId") {
            unwrapArray(
                api.request<JsonElement>(path = "/vehicle-states/timeline", query = mapOf("vehicle_id" to vehicleId)),
                "transitions",
            )
        }

    override fun stateSummary(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_STATE_SUMMARY:$vehicleId") {
            safeArray(api.request<JsonElement>(path = "/vehicle-states/summary", query = mapOf("vehicle_id" to vehicleId)))
        }

    override fun weeklyDigest(vehicleId: String): Flow<Resource<JsonElement>> =
        observe("$KEY_WEEKLY_DIGEST:$vehicleId") {
            api.request<JsonElement>(path = "/vehicles/$vehicleId/weekly-digest")
        }

    override fun lifetimeStats(vehicleId: String?): Flow<Resource<JsonElement>> =
        observe("$KEY_LIFETIME:$vehicleId") {
            // Web omits `?vehicle_id=` for a falsy id (`vehicleId ? … : ''`); an empty string
            // is treated as absent, not sent as `vehicle_id=`.
            val id = vehicleId?.takeIf { it.isNotEmpty() }
            api.request<JsonElement>(
                path = "/analytics/lifetime",
                query = if (id != null) mapOf("vehicle_id" to id) else emptyMap(),
            )
        }

    override fun yearReview(
        year: Int,
        vehicleId: String?,
    ): Flow<Resource<JsonElement>> =
        observe("$KEY_YEAR_REVIEW:$year:$vehicleId") {
            val query = linkedMapOf<String, String>("year" to year.toString())
            // Mirrors `${vehicleId ? `&vehicle_id=…` : ''}` — a falsy/empty id is omitted.
            vehicleId?.takeIf { it.isNotEmpty() }?.let { query["vehicle_id"] = it }
            api.request<JsonElement>(path = "/analytics/year-review", query = query)
        }

    private companion object {
        const val KEY_SUMMARY = "summary"
        const val KEY_FLEET = "fleet"
        const val KEY_MILEAGE = "mileage"
        const val KEY_MONTHLY = "monthly-mileage"
        const val KEY_DAILY = "daily-mileage"
        const val KEY_COST = "cost"
        const val KEY_TIMELINE = "timeline"
        const val KEY_STATE_SUMMARY = "state-summary"
        const val KEY_WEEKLY_DIGEST = "weekly-digest"
        const val KEY_LIFETIME = "lifetime"
        const val KEY_YEAR_REVIEW = "year-review"
    }
}
