package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.presentation.trips.Trip
import io.teslasync.shared.core.presentation.trips.TripsParams
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * HTTP-backed [TripsRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013).
 * Both reads share the single [CacheDomain.Trips] partition, keyed by a stable per-feed string
 * ([tripsListKey] / [tripDetailKey]) that mirrors the web TanStack query keys, so a feed is cached
 * independently while logout still clears the whole domain in one call.
 *
 * Because the two reads have distinct shapes (a list vs a single detail), the cache stores each feed's
 * raw [JsonElement] (the verbatim-SI strategy of the Driving/Analytics ports) via
 * [CachingRepository] of [JsonElement], and each read decodes that element to [Trip] on every emission
 * through [decode]. The list read applies [safeArray] before the cache write — exactly the web
 * `select: safeArray` derivation, performed once at the data layer. A typed decode failure on the
 * fresh value surfaces as [Resource.Error] (never a thrown exception that would cancel the flow before
 * the next refresh); a failure decoding a cached value degrades that slot to `null` so a schema-drifted
 * cache can never brick the network reload.
 *
 * The web `useTrips`/`useTrip` hooks declare no `staleTime`, so they inherit the QueryClient default
 * (60s); [CacheDomain.Trips] carries the same 60-second window, so a cached value flags stale on the
 * same threshold the web flips its freshness on. The domain has no mutations (the web hook is
 * read-only), so there is no eviction surface here. The endpoints are the version-namespaced `/trips`
 * and `/trips/{id}`; the resilient client adds the `/api/v1` prefix exactly once, matching the web
 * `request('/trips')` / `request('/trips/{id}')` calls verbatim. Distances/energy/duration stay SI
 * (metres, Wh, seconds) through the cache; conversion is the render boundary's job (S5).
 */
public class HttpTripsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    TripsRepository {
    override val domain: CacheDomain = CacheDomain.Trips

    // ---- Reads --------------------------------------------------------------------

    override fun trips(params: TripsParams): Flow<Resource<List<Trip>>> =
        observe(tripsListKey(params)) {
            safeArray(api.request<JsonElement>(path = TRIPS_PATH, query = tripsQuery(params)))
        }.decode(ListSerializer(Trip.serializer()))

    override fun trip(id: String): Flow<Resource<Trip>> =
        observe(tripDetailKey(id)) {
            api.request<JsonElement>(path = "$TRIPS_PATH/$id")
        }.decode(Trip.serializer())

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

    private companion object {
        const val TRIPS_PATH = "/trips"
    }
}
