package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.locations.GeofenceBulkResult
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * The S7 data port for the Locations store — the cross-platform analogue of the web `useLocations`
 * hook domain (web/src/api/hooks/useLocations.ts). Every native Locations screen (Android/Apple via
 * KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a single
 * fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The two reads stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value. Both apply the web `select: safeArray` array guard
 * before the cache write, so a non-array payload collapses to an empty list rather than a decode
 * crash. [visitedLocations] mirrors the web `useLocations` (`GET /locations?vehicle_id=`);
 * [geofences] mirrors the web `useGeofences` (`GET /geofences`).
 *
 * The single mutation [bulkDeleteGeofences] mirrors the web `useBulkGeofencesDelete`
 * (`POST /geofences/bulk` with `{ ids, op: "delete" }`). Like the Guard port, it has NO cache
 * interaction here: invalidation is expressed as a targeted refresh in the S8 store (the web
 * `invalidateQueries(locationKeys.geofences)` analogue — note it invalidates ONLY the geofences feed,
 * never the visited-location list), and the durable cache is left intact so a refresh shows the
 * last-known list while the network reload runs.
 *
 * The web `useLocations` hook gates its read with `enabled: !!vehicleId`; that gate is a presentation
 * concern (the S8 store's [io.teslasync.shared.core.presentation.locations.locationsEnabled]), so this
 * port takes a non-null [vehicleId] and is only ever called for an enabled vehicle. Location and
 * geofence fields are SI on the wire (`total_duration_s` seconds, geofence `radius` meters) and not
 * unit-bearing for display, so they round-trip verbatim with no SI conversion; display formatting is
 * the render boundary's job (S5).
 */
public interface LocationRepository {
    /**
     * `GET /locations?vehicle_id={vehicleId}` — the visited-location list for one vehicle (web
     * `useLocations`, `safeArray`-guarded). Cached under [visitedLocationsKey], mirroring the web
     * `locationKeys.all(vehicleId)` query key.
     */
    public fun visitedLocations(vehicleId: String): Flow<Resource<List<VisitedLocation>>>

    /**
     * `GET /geofences` — the geofence list (web `useGeofences`, `safeArray`-guarded). Cached under
     * [geofencesKey], mirroring the web `locationKeys.geofences` query key.
     */
    public fun geofences(): Flow<Resource<List<Geofence>>>

    /**
     * `POST /geofences/bulk` with `{ ids, op: "delete" }` — bulk-deletes geofences (web
     * `useBulkGeofencesDelete`). No cache interaction; the S8 store refreshes the geofences feed on
     * success (the web `invalidateQueries(locationKeys.geofences)`).
     */
    public suspend fun bulkDeleteGeofences(ids: List<Long>): Result<GeofenceBulkResult>
}

/**
 * Builds the stable cache/feed key for [vehicleId]'s visited-location list, mirroring the web
 * `locationKeys.all(vehicleId)` tuple `['locations', vehicleId ?? 'all']` — a null id coalesces to
 * `all` exactly as the web key does. Prefixed so it can never collide with [geofencesKey] in the
 * shared [io.teslasync.shared.core.cache.CacheDomain.Locations] partition. Locked by golden vectors
 * shared with the C# port.
 */
public fun visitedLocationsKey(vehicleId: String?): String = "locations:${vehicleId ?: "all"}"

/**
 * Builds the stable cache/feed key for the geofence list, mirroring the web
 * `locationKeys.geofences` tuple `['geofences']`. A constant — the geofence list is not
 * vehicle-scoped. Prefixed so it can never collide with [visitedLocationsKey] in the shared
 * partition. Locked by golden vectors shared with the C# port.
 */
public fun geofencesKey(): String = "geofences"

/**
 * Builds the `POST /geofences/bulk` request body, mirroring the web
 * `JSON.stringify({ ids, op: 'delete' })` exactly: the [ids] array followed by the constant
 * `op: "delete"` (the only allowlisted op today). Keys are snake-case-agnostic plain JSON, matching
 * the Go `apibulk.DecodeOpBody`. Locked by golden vectors shared with the C# port.
 */
public fun geofenceBulkDeleteBody(ids: List<Long>): JsonObject =
    buildJsonObject {
        put("ids", JsonArray(ids.map { JsonPrimitive(it) }))
        put("op", JsonPrimitive("delete"))
    }
