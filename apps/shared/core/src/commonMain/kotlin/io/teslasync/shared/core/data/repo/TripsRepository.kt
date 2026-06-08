package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.presentation.trips.TripsParams
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the trip-log domain — the cross-platform analogue of the web `useTrips` hook
 * domain (web/src/api/hooks/useTrips.ts). Every native Trips surface (Android/Apple via KMP, Windows
 * via the C# port) reaches the backend exclusively through this interface, so a single fake stands in
 * for the whole domain in the S8 state-holder tests.
 *
 * Both reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an instant
 * cold start, then the refreshed value. [trips] decodes the list to the SI DTO [Trip] (the web
 * `select: safeArray` array-guard is applied once at the data layer); [trip] decodes the single
 * detail to [Trip]. The list is cached under [tripsListKey] (the web `['trips', params]` tuple) and
 * the detail under [tripDetailKey] (the web `['trips', id]` tuple).
 *
 * The domain has no mutations — the web hook file is read-only — so there is no eviction surface
 * here; the S8 store's targeted re-collection of the `['trips']` family (the web `invalidateQueries`
 * analogue) drives any refresh. The web `useTrip` 404 (the backend registers only `GET /trips`, not
 * `GET /trips/{id}`) is a render-layer error-path concern and surfaces through [Resource.Error]
 * unchanged. Distances/energy/duration stay SI (metres, Wh, seconds) through the cache; conversion is
 * the render boundary's job (S5), never this layer's.
 */
public interface TripsRepository {
    /**
     * `GET /trips[?vehicle_id&limit&offset&start&end]` — the trip-log list (web `useTrips`,
     * `safeArray`-guarded). The query is built by [tripsQuery] (the web per-field truthy guards) and
     * cached under [tripsListKey] (the web `['trips', params]` tuple). Always resolves to a list
     * (never null).
     */
    public fun trips(params: TripsParams): Flow<Resource<List<Trip>>>

    /**
     * `GET /trips/{id}` — one trip's detail (web `useTrip`). Cached under [tripDetailKey] (the web
     * `['trips', id]` tuple). The backend registers no such route, so in practice this surfaces a 404
     * through [Resource.Error] — the same channel the web `TripDetailPage` renders gracefully.
     */
    public fun trip(id: String): Flow<Resource<Trip>>
}

// ---- Query builder (web param semantics, snake_case) -------------------------------

/**
 * Builds the `/trips` query map with the web hook's per-field semantics (web/src/api/hooks/
 * useTrips.ts): `vehicle_id` and `limit` are sent only when truthy (non-`null` AND non-`0`, the port
 * of JavaScript's `if (params.vehicle_id)` / `if (params.limit)` guards); `offset` only when
 * `!= null && > 0`; `start`/`end` only when non-`null` AND non-blank (the port of `if (params.start)`).
 * Keys are emitted in the web's `URLSearchParams` insertion order (vehicle_id, limit, offset, start,
 * end), all snake_case, matching the Go handler. Locked by golden vectors shared with the C# port.
 */
public fun tripsQuery(params: TripsParams): Map<String, String> {
    val query = linkedMapOf<String, String>()
    params.vehicleId?.takeIf { it != 0L }?.let { query["vehicle_id"] = it.toString() }
    params.limit?.takeIf { it != 0 }?.let { query["limit"] = it.toString() }
    params.offset?.takeIf { it > 0 }?.let { query["offset"] = it.toString() }
    params.start?.takeIf { it.isNotEmpty() }?.let { query["start"] = it }
    params.end?.takeIf { it.isNotEmpty() }?.let { query["end"] = it }
    return query
}

// ---- Cache/feed keys (mirror the web TanStack query keys) --------------------------

/** The tuple separator used by every Trips cache key, so family invalidation is boundary-safe. */
internal const val TRIPS_KEY_SEP: String = "|"

/** The `tripKeys.all` family (`['trips']`) — the prefix shared by both the list and the detail. */
public const val TRIPS_FAMILY: String = "trips"

/**
 * Cache/feed key for [TripsRepository.trips] — the web `['trips', params]` tuple. Mirrors TanStack's
 * `hashKey`, which `JSON.stringify`s the params object with sorted keys and DROPS `undefined`
 * (here: `null`) fields while KEEPING value-carrying ones (including `0` / `""`). The present fields
 * are appended in sorted-key order (end, limit, offset, start, vehicle_id) so two list reads collide
 * in the cache exactly when their web query keys do; an all-`null` params (the web `useTrips()` /
 * `params ?? {}`) yields the bare family key. Locked by golden vectors shared with the C# port.
 */
public fun tripsListKey(params: TripsParams): String {
    val parts =
        buildList {
            params.end?.let { add("end=$it") }
            params.limit?.let { add("limit=$it") }
            params.offset?.let { add("offset=$it") }
            params.start?.let { add("start=$it") }
            params.vehicleId?.let { add("vehicle_id=$it") }
        }
    return (listOf(TRIPS_FAMILY) + parts).joinToString(TRIPS_KEY_SEP)
}

/**
 * Cache/feed key for [TripsRepository.trip] — the web `tripKeys.detail(id)` (`['trips', id]`). Built
 * under the [TRIPS_FAMILY] head so the `['trips']` family refresh matches it under [tripsKeyInFamily];
 * the `id` segment never carries a `=`, so it can never collide with a list key's `field=value`
 * segment. Locked by golden vectors shared with the C# port.
 */
public fun tripDetailKey(id: String): String = "$TRIPS_FAMILY$TRIPS_KEY_SEP$id"

/**
 * `true` when [key] belongs to the [family] under TanStack prefix-invalidation semantics: the key
 * either equals the family head exactly OR descends from it (`family` + separator + …). Mirrors
 * `invalidateQueries({ queryKey: [family] })`; with [TRIPS_FAMILY] this matches BOTH the list and the
 * detail, exactly as the web `tripKeys.all` prefix does. Locked by golden vectors shared with the C#
 * port.
 */
public fun tripsKeyInFamily(
    key: String,
    family: String,
): Boolean = key == family || key.startsWith("$family$TRIPS_KEY_SEP")
