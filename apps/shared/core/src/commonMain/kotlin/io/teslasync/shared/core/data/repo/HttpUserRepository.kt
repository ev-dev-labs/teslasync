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
import io.teslasync.shared.core.presentation.user.MyActivityParams
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import io.teslasync.shared.core.presentation.user.TeslaOrdersEnvelope
import io.teslasync.shared.core.presentation.user.TeslaProfileEnvelope
import io.teslasync.shared.core.presentation.user.TeslaRegionData
import io.teslasync.shared.core.presentation.user.User
import io.teslasync.shared.core.presentation.user.UserActivityEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * HTTP-backed [UserRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013) —
 * the data-layer port of the web `useUser` hook domain. Every read shares the single
 * [CacheDomain.User] partition, keyed by a stable per-feed string ([USER_ME_KEY] etc.) that mirrors
 * the web TanStack `userKeys` query keys.
 *
 * Because the domain has six distinct read shapes with a SPREAD of web `staleTime`s, the cache layer
 * stores each feed's raw [JsonElement] (the same verbatim strategy as the Settings/Admin ports) via
 * [CachingRepository] of [JsonElement], and each read decodes that element to its typed model on
 * every emission through [decode]. Each read overrides the domain-default TTL with its own
 * web-faithful [observe] `entryTtlMillis` so a feed flags staleness exactly when the web hook would.
 * A typed decode failure on the fresh value surfaces as [Resource.Error] (never a thrown exception
 * that would cancel the flow before the next refresh); a failure decoding a cached value degrades
 * that slot to `null` so a schema-drifted cache can never brick the network reload.
 *
 * The five mutations call the API directly and return a non-throwing [Result]. They do NOT evict the
 * durable cache: the cache-then-network operator re-fetches when the S8 store bumps the affected
 * feed's trigger (the `invalidateQueries`/`setQueryData` analogue), so the previous rows stay visible
 * during the reload — exactly the web behaviour of keeping prior data while a refetch is in flight —
 * and no stale value is ever served as fresh. The `PUT /users/me` body is serialized to exact JSON
 * bytes via [TextContent] for byte-for-byte parity with the web `JSON.stringify({ displayName })`
 * payload (the one camelCase body in the API surface).
 */
public class HttpUserRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    UserRepository {
    override val domain: CacheDomain = CacheDomain.User

    // ---- Reads --------------------------------------------------------------------

    override fun currentUser(): Flow<Resource<User>> =
        observe(USER_ME_KEY, STALE_DEFAULT_MILLIS) { api.request<JsonElement>(path = "/users/me") }
            .decode(User.serializer())

    override fun myRecentActivity(params: MyActivityParams): Flow<Resource<List<UserActivityEntry>>> =
        observe(userActivityCacheKey(params), STALE_STANDARD_MILLIS) {
            safeArray(api.request<JsonElement>(path = "/users/me/activity", query = myActivityQuery(params)))
        }.decode(ListSerializer(UserActivityEntry.serializer()))

    override fun teslaFeatureConfig(): Flow<Resource<TeslaConfigEnvelope<JsonElement>>> =
        observe(USER_TESLA_FEATURE_CONFIG_KEY, STALE_EXTENDED_MILLIS) {
            api.request<JsonElement>(path = "/tesla/user/feature-config")
        }.decode(featureConfigSerializer)

    override fun teslaUserRegion(): Flow<Resource<TeslaConfigEnvelope<TeslaRegionData>>> =
        observe(USER_TESLA_REGION_KEY, STALE_STATIC_MILLIS) {
            api.request<JsonElement>(path = "/tesla/user/region")
        }.decode(regionSerializer)

    override fun teslaUserOrders(): Flow<Resource<TeslaOrdersEnvelope>> =
        observe(USER_TESLA_ORDERS_KEY, STALE_SLOW_MILLIS) {
            api.request<JsonElement>(path = "/tesla/user/orders")
        }.decode(TeslaOrdersEnvelope.serializer())

    override fun teslaUserProfile(): Flow<Resource<TeslaProfileEnvelope>> =
        observe(USER_TESLA_PROFILE_KEY, STALE_SLOW_MILLIS) {
            api.request<JsonElement>(path = "/tesla/user/profile")
        }.decode(TeslaProfileEnvelope.serializer())

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun updateUser(displayName: String): Result<User> =
        api.safeRequest<User>(
            method = HttpMethodKind.PUT,
            path = "/users/me",
            body = jsonBody(updateUserBody(displayName)),
        )

    override suspend fun refreshTeslaFeatureConfig(): Result<TeslaConfigEnvelope<JsonElement>> =
        api
            .safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/tesla/user/feature-config/refresh")
            .mapCatching { json.decodeFromJsonElement(featureConfigSerializer, it) }

    override suspend fun refreshTeslaRegion(): Result<TeslaConfigEnvelope<TeslaRegionData>> =
        api
            .safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "/tesla/user/region/refresh")
            .mapCatching { json.decodeFromJsonElement(regionSerializer, it) }

    override suspend fun refreshTeslaOrders(): Result<TeslaOrdersEnvelope> =
        api.safeRequest<TeslaOrdersEnvelope>(method = HttpMethodKind.POST, path = "/tesla/user/orders/refresh")

    override suspend fun refreshTeslaProfile(): Result<TeslaProfileEnvelope> =
        api.safeRequest<TeslaProfileEnvelope>(method = HttpMethodKind.POST, path = "/tesla/user/profile/refresh")

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
                    // A 2xx body that no longer matches the DTO is a contract error, not a transport
                    // one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach the
     * wire unchanged — byte-for-byte parity with the web `JSON.stringify` body.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private companion object {
        // The two generic-envelope serializers, built once: feature-config carries a raw JSON `data`
        // blob; region carries a typed TeslaRegionData.
        val featureConfigSerializer: KSerializer<TeslaConfigEnvelope<JsonElement>> =
            TeslaConfigEnvelope.serializer(JsonElement.serializer())
        val regionSerializer: KSerializer<TeslaConfigEnvelope<TeslaRegionData>> =
            TeslaConfigEnvelope.serializer(TeslaRegionData.serializer())

        // Web `staleTime` → per-read freshness threshold (web/src/lib/constants.ts STALE_TIMES).
        // useCurrentUser declares no staleTime (QueryClient default 0): the cached cold-start emission
        // flags stale immediately, exactly as the web treats a default query as stale on mount.
        const val STALE_DEFAULT_MILLIS = 0L

        // STALE_TIMES.STANDARD (60s) — useMyRecentActivity.
        const val STALE_STANDARD_MILLIS = 60_000L

        // STALE_TIMES.SLOW (5 min) — useTeslaUserOrders, useTeslaUserProfile.
        const val STALE_SLOW_MILLIS = 300_000L

        // STALE_TIMES.EXTENDED (10 min) — useTeslaFeatureConfig.
        const val STALE_EXTENDED_MILLIS = 600_000L

        // STALE_TIMES.STATIC (Infinity) — useTeslaUserRegion never becomes stale; the largest possible
        // window stands in for the unbounded web value so the freshness math never trips.
        const val STALE_STATIC_MILLIS = Long.MAX_VALUE
    }
}
