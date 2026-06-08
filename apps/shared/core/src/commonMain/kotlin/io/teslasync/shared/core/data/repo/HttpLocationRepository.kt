package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.locations.GeofenceBulkResult
import io.teslasync.shared.core.presentation.locations.VisitedLocation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [LocationRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The two reads share the single [CacheDomain.Locations] partition under distinct
 * prefixed keys — [visitedLocationsKey] / [geofencesKey], mirroring the web `locationKeys.all` /
 * `locationKeys.geofences` query keys — so each vehicle's visited-location list and the geofence
 * list cache independently while logout still clears the whole domain in one call.
 *
 * Because the domain has two distinct read shapes ([VisitedLocation] and [Geofence] lists), the
 * cache layer stores each feed's raw [JsonElement] (the same verbatim-SI strategy as the Guard/Admin
 * ports) via [CachingRepository] of [JsonElement]; each read applies the web `select: safeArray`
 * guard via [safeArray] BEFORE the cache write (so a non-array payload collapses to `[]` instead of
 * crashing the decode) and then decodes the cached array to its typed list on every emission through
 * [decode]. A typed decode failure on the fresh value surfaces as [Resource.Error] (never a thrown
 * exception that would cancel the flow before the next refresh); a failure decoding a cached value
 * degrades that slot to `null` so a schema-drifted cache can never brick the network reload.
 *
 * The bulk-delete mutation calls the API directly and does NOT touch the cache: invalidation is the
 * S8 store's targeted refresh of the geofences feed (the web `invalidateQueries(locationKeys.geofences)`
 * analogue), and the cache-then-network operator always re-fetches on refresh, so the last-known
 * list stays visible during the reload and no stale value is ever served as fresh.
 */
public class HttpLocationRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    LocationRepository {
    override val domain: CacheDomain = CacheDomain.Locations

    // ---- Reads --------------------------------------------------------------------

    override fun visitedLocations(vehicleId: String): Flow<Resource<List<VisitedLocation>>> =
        observe(visitedLocationsKey(vehicleId)) {
            safeArray(api.request<JsonElement>(path = "/locations", query = mapOf("vehicle_id" to vehicleId)))
        }.decode(ListSerializer(VisitedLocation.serializer()))

    override fun geofences(): Flow<Resource<List<Geofence>>> =
        observe(geofencesKey()) {
            safeArray(api.request<JsonElement>(path = "/geofences"))
        }.decode(ListSerializer(Geofence.serializer()))

    // ---- Mutation -----------------------------------------------------------------

    override suspend fun bulkDeleteGeofences(ids: List<Long>): Result<GeofenceBulkResult> =
        api.safeRequest<GeofenceBulkResult>(
            method = HttpMethodKind.POST,
            path = "/geofences/bulk",
            body = jsonBody(geofenceBulkDeleteBody(ids)),
        )

    // ---- Internals ----------------------------------------------------------------

    /** Maps a raw-JSON cache-then-network feed onto its typed model, guarding every decode. */
    private fun <T> Flow<Resource<JsonElement>>.decode(serializer: KSerializer<T>): Flow<Resource<T>> =
        map { resource -> resource.decodeTo(serializer) }

    private fun <T> Resource<JsonElement>.decodeTo(serializer: KSerializer<T>): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { json.decodeFromJsonElement(serializer, data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    // A 2xx body that no longer matches the DTO is a contract error, not a
                    // transport one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
