package io.teslasync.shared.core.data.repo

import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * The S7 data port for the Analytics read-model surface — the cross-platform analogue of the
 * web `useAnalytics` hook domain (web/src/api/hooks/useAnalytics.ts). Every native Analytics
 * screen (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively
 * through this interface, so a single fake stands in for the whole domain in the S8
 * state-holder tests.
 *
 * Reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. The domain is read-only — the web hook file
 * declares zero mutations — so there is no invalidation surface here.
 *
 * Payloads are carried as raw SI [JsonElement] (the same verbatim-SI strategy as
 * [NotificationRepository]/[AdminRepository]): analytics values are SI on the wire and stay
 * SI through the cache; display conversion is the render-boundary's job (S5), never this
 * layer's. The only client-side derivations ported from the web are the array guards —
 * [safeArray] (web `select: safeArray`) and the envelope unwrap [unwrapArray]
 * (web `select: (resp) => safeArray(resp?.months|days)` and
 * `select: (data) => safeArray(data?.transitions)`).
 */
public interface AnalyticsRepository {
    /**
     * `GET /analytics/fleet?days={days}` — the trailing-window fleet summary used by the
     * dashboard widget (web `useAnalyticsSummary`, default 30 days). Distinct cache key from
     * [fleetAnalytics] even though both hit `/analytics/fleet`, mirroring the separate web
     * query keys `['analytics','summary',days]` vs `['analytics','fleet',…]`.
     */
    public fun analyticsSummary(days: Int = 30): Flow<Resource<JsonElement>>

    /**
     * `GET /analytics/fleet` — the full fleet deep-analytics feed (web `useFleetAnalytics`).
     * Parameter precedence mirrors the web hook exactly via [fleetQuery]: an explicit
     * `start`/`end` range wins over `days`; with no bound supplied the request carries no
     * query and the backend returns full history.
     */
    public fun fleetAnalytics(
        days: Int? = null,
        start: String? = null,
        end: String? = null,
    ): Flow<Resource<JsonElement>>

    /** `GET /mileage/stats?vehicle_id={vehicleId}` — lifetime + window mileage rollup (web `useMileageStats`). */
    public fun mileageStats(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /mileage/monthly?vehicle_id={vehicleId}` — the `{vehicle_id, months}` envelope
     * unwrapped to a guaranteed `months` array (web `useMonthlyMileage`,
     * `select: (resp) => safeArray(resp?.months)`).
     */
    public fun monthlyMileage(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /mileage/daily?vehicle_id={vehicleId}&days={days}` — the `{vehicle_id, days}`
     * envelope unwrapped to a guaranteed `days` array (web `useDailyMileage`, default 90,
     * `select: (resp) => safeArray(resp?.days)`).
     */
    public fun dailyMileage(
        vehicleId: String,
        days: Int = 90,
    ): Flow<Resource<JsonElement>>

    /** `GET /analytics/tco?vehicle_id={vehicleId}` — total-cost-of-ownership breakdown (web `useCostBreakdown`). */
    public fun costBreakdown(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /vehicle-states/timeline?vehicle_id={vehicleId}` — the `{transitions}` envelope
     * unwrapped to a guaranteed `transitions` array (web `useTimeline`,
     * `select: (data) => safeArray(data?.transitions)`).
     *
     * Ported verbatim from the web hook, which is `@deprecated`: Phase-42/Prompt-0077 removed
     * the `vehicle_states` table, so the route now 404s. The error surfaces gracefully through
     * [Resource.Error] exactly as the web `useQuery` surfaces it via its `error` channel.
     */
    public fun timeline(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /vehicle-states/summary?vehicle_id={vehicleId}` — array-guarded state summary
     * (web `useStateSummary`, `select: safeArray`). Also `@deprecated`/404 post Phase-42; the
     * error surfaces through [Resource.Error].
     */
    public fun stateSummary(vehicleId: String): Flow<Resource<JsonElement>>

    /** `GET /vehicles/{vehicleId}/weekly-digest` — the weekly digest read-model (web `useWeeklyDigest`). */
    public fun weeklyDigest(vehicleId: String): Flow<Resource<JsonElement>>

    /**
     * `GET /analytics/lifetime` (optionally `?vehicle_id={vehicleId}`) — lifetime stats,
     * achievements, and personal records (web `useLifetimeStats`). When [vehicleId] is null
     * the query param is omitted entirely, matching the web `vehicleId ? '?vehicle_id=…' : ''`.
     */
    public fun lifetimeStats(vehicleId: String? = null): Flow<Resource<JsonElement>>

    /**
     * `GET /analytics/year-review?year={year}` (optionally `&vehicle_id={vehicleId}`) — the
     * annual recap (web `useYearReview`). The `vehicle_id` param is omitted when [vehicleId]
     * is null, mirroring the web template literal.
     */
    public fun yearReview(
        year: Int,
        vehicleId: String? = null,
    ): Flow<Resource<JsonElement>>
}

/**
 * Builds the `/analytics/fleet` query map with the web hook's exact precedence
 * (web `useFleetAnalytics`): an explicit `start`/`end` range wins over `days`, and `days`
 * is only sent when neither bound is present. Blank/absent strings are treated as "no bound"
 * to mirror JavaScript's falsy `if (opts.start)` guard, so an empty `start`/`end` never
 * suppresses the `days` fallback. Locked by golden vectors shared with the C# port.
 */
public fun fleetQuery(
    days: Int?,
    start: String?,
    end: String?,
): Map<String, String> {
    val params = linkedMapOf<String, String>()
    if (!start.isNullOrEmpty()) params["start"] = start
    if (!end.isNullOrEmpty()) params["end"] = end
    if (start.isNullOrEmpty() && end.isNullOrEmpty() && days != null) params["days"] = days.toString()
    return params
}

/**
 * The envelope-unwrap derivation ported from the web `select: (resp) => safeArray(resp?.field)`
 * pattern: reads [field] off a JSON object then applies the [safeArray] guard. A non-object
 * input, a missing field, or a JSON-null field all collapse to an empty array — reproducing
 * JavaScript optional chaining (`resp?.field` → `undefined` → `[]`). Locked by golden vectors
 * shared with the C# port so the three platforms cannot drift (ADR-004).
 */
public fun unwrapArray(
    value: JsonElement,
    field: String,
): JsonArray {
    val inner = (value as? JsonObject)?.get(field)
    if (inner == null || inner is JsonNull) return JsonArray(emptyList())
    return safeArray(inner)
}
