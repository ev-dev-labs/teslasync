package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.user.MyActivityParams
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import io.teslasync.shared.core.presentation.user.TeslaOrdersEnvelope
import io.teslasync.shared.core.presentation.user.TeslaProfileEnvelope
import io.teslasync.shared.core.presentation.user.TeslaRegionData
import io.teslasync.shared.core.presentation.user.User
import io.teslasync.shared.core.presentation.user.UserActivityEntry
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * The S7 data port for the User / Account domain — the cross-platform analogue of the web `useUser`
 * hook domain (web/src/api/hooks/useUser.ts). Every native Account / Profile surface (Android/Apple
 * via KMP, Windows via the C# port) reaches the backend exclusively through this interface, so a
 * single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The six reads each stream a cache-then-network [Resource] (ADR-013): the cached value first for an
 * instant cold start, then the refreshed value, cached under a per-feed key that mirrors the web
 * TanStack query key (`userKeys`). They share the single
 * [io.teslasync.shared.core.cache.CacheDomain.User] partition (so logout clears all of them in one
 * call) but each flags staleness on its OWN web-faithful threshold via the per-read TTL — the web
 * hooks declare a spread of `staleTime`s (`useCurrentUser` default-0, `useMyRecentActivity`
 * `STANDARD`, `useTeslaFeatureConfig` `EXTENDED`, `useTeslaUserRegion` `STATIC`,
 * `useTeslaUserOrders`/`useTeslaUserProfile` `SLOW`), and a single domain window cannot honour them
 * all.
 *
 * The five mutations are non-throwing suspend [Result]s; they call the API directly and DO NOT touch
 * the durable cache (the cache-then-network operator re-fetches when the S8 store bumps the affected
 * feed's trigger — the `invalidateQueries`/`setQueryData` analogue — so prior rows stay visible
 * during the reload, exactly the web behaviour of keeping previous data while a refetch is in
 * flight, and no stale value is ever served as fresh). Which feeds each mutation refreshes is an S8
 * concern that mirrors the web hook's invalidation calls.
 *
 * Values are account identity / order / region strings and ISO stamps — not unit-bearing telemetry —
 * so they round-trip verbatim with no SI conversion; display formatting is the render boundary's job
 * (S5). The current-user document is the one camelCase contract (the web `User` type and the
 * `{ displayName }` body), reproduced verbatim.
 */
public interface UserRepository {
    // ---- Reads --------------------------------------------------------------------

    /** `GET /users/me` → [User] (web `useCurrentUser`). */
    public fun currentUser(): Flow<Resource<User>>

    /**
     * `GET /users/me/activity` → [UserActivityEntry] list, `safeArray`-guarded (web
     * `useMyRecentActivity`). The query is built by [myActivityQuery] from [params].
     */
    public fun myRecentActivity(params: MyActivityParams = MyActivityParams()): Flow<Resource<List<UserActivityEntry>>>

    /**
     * `GET /tesla/user/feature-config` → [TeslaConfigEnvelope] of a raw JSON `data` blob (web
     * `useTeslaFeatureConfig`, whose `data` is `Record<string, unknown>`).
     */
    public fun teslaFeatureConfig(): Flow<Resource<TeslaConfigEnvelope<JsonElement>>>

    /** `GET /tesla/user/region` → [TeslaConfigEnvelope] of [TeslaRegionData] (web `useTeslaUserRegion`). */
    public fun teslaUserRegion(): Flow<Resource<TeslaConfigEnvelope<TeslaRegionData>>>

    /** `GET /tesla/user/orders` → [TeslaOrdersEnvelope] (web `useTeslaUserOrders`). */
    public fun teslaUserOrders(): Flow<Resource<TeslaOrdersEnvelope>>

    /** `GET /tesla/user/profile` → [TeslaProfileEnvelope] (web `useTeslaUserProfile`). */
    public fun teslaUserProfile(): Flow<Resource<TeslaProfileEnvelope>>

    // ---- Mutations ----------------------------------------------------------------

    /**
     * `PUT /users/me` with `{ displayName }` → [User] (web `useUpdateUser`). The body is camelCase,
     * verbatim with the web `JSON.stringify({ displayName })`. The S8 store refreshes the `me` feed
     * on success (the web `queryClient.setQueryData(userKeys.me, data)`).
     */
    public suspend fun updateUser(displayName: String): Result<User>

    /**
     * `POST /tesla/user/feature-config/refresh` → [TeslaConfigEnvelope] (web
     * `useRefreshTeslaFeatureConfig`). The S8 store refreshes `tesla-feature-config` on success (the
     * web `invalidateQueries({ queryKey: userKeys.teslaFeatureConfig })`).
     */
    public suspend fun refreshTeslaFeatureConfig(): Result<TeslaConfigEnvelope<JsonElement>>

    /**
     * `POST /tesla/user/region/refresh` → [TeslaConfigEnvelope] of [TeslaRegionData] (web
     * `useRefreshTeslaRegion`). The S8 store refreshes `tesla-user-region` on success.
     */
    public suspend fun refreshTeslaRegion(): Result<TeslaConfigEnvelope<TeslaRegionData>>

    /**
     * `POST /tesla/user/orders/refresh` → [TeslaOrdersEnvelope] (web `useRefreshTeslaOrders`). The S8
     * store refreshes `tesla-user-orders` on success.
     */
    public suspend fun refreshTeslaOrders(): Result<TeslaOrdersEnvelope>

    /**
     * `POST /tesla/user/profile/refresh` → [TeslaProfileEnvelope] (web `useRefreshTeslaProfile`). The
     * S8 store refreshes `tesla-user-profile` on success.
     */
    public suspend fun refreshTeslaProfile(): Result<TeslaProfileEnvelope>
}

// ---- Cache/feed keys (mirror the web TanStack query keys `userKeys`) ----------------

/** Cache/feed key for `GET /users/me` — web `userKeys.me` (`['users','me']`). */
public const val USER_ME_KEY: String = "me"

/** Cache/feed key prefix for `GET /users/me/activity` — web `userKeys.myActivity` (`['users','me','activity', params]`). */
public const val USER_ACTIVITY_KEY_PREFIX: String = "me:activity"

/** Cache/feed key for `GET /tesla/user/feature-config` — web `userKeys.teslaFeatureConfig`. */
public const val USER_TESLA_FEATURE_CONFIG_KEY: String = "tesla-feature-config"

/** Cache/feed key for `GET /tesla/user/region` — web `userKeys.teslaRegion`. */
public const val USER_TESLA_REGION_KEY: String = "tesla-user-region"

/** Cache/feed key for `GET /tesla/user/orders` — web `userKeys.teslaOrders`. */
public const val USER_TESLA_ORDERS_KEY: String = "tesla-user-orders"

/** Cache/feed key for `GET /tesla/user/profile` — web `userKeys.teslaProfile`. */
public const val USER_TESLA_PROFILE_KEY: String = "tesla-user-profile"

// ---- Request builders (web param/body semantics; golden-pinned) --------------------

/**
 * The `/users/me/activity` query — the port of the web `buildActivityQuery` (useUser.ts). Mirrors
 * the web truthiness rules EXACTLY: `start`/`end` are included only when present AND non-empty (the
 * web `if (params.start)` truthy guard drops `''`), while `limit`/`offset` are included whenever
 * non-null (the web `!= null` guard, so an explicit `0` is sent). snake_case wire keys. A pure
 * function of its input, locked by golden vectors so the C# and KMP ports cannot drift (ADR-004).
 */
public fun myActivityQuery(params: MyActivityParams): Map<String, String> {
    val query = linkedMapOf<String, String>()
    params.start?.takeIf { it.isNotEmpty() }?.let { query["start"] = it }
    params.end?.takeIf { it.isNotEmpty() }?.let { query["end"] = it }
    params.limit?.let { query["limit"] = it.toString() }
    params.offset?.let { query["offset"] = it.toString() }
    return query
}

/**
 * Builds the stable cache/feed key for [params], mirroring the web `userKeys.myActivity(params)`
 * tuple `['users','me','activity', params]`. The whole params object participates in the web query
 * key, so all four fields participate here; absent fields collapse to `''` so two param sets collide
 * in the cache exactly when their web query keys do. Locked by golden vectors shared with the C#
 * port (ADR-004).
 */
public fun userActivityCacheKey(params: MyActivityParams): String =
    listOf(
        USER_ACTIVITY_KEY_PREFIX,
        params.start ?: "",
        params.end ?: "",
        params.limit?.toString() ?: "",
        params.offset?.toString() ?: "",
    ).joinToString(":")

/**
 * The `PUT /users/me` body — the port of the web `JSON.stringify({ displayName })`. The one camelCase
 * body in the API surface, reproduced verbatim. A pure function of its input, locked by golden
 * vectors (ADR-004).
 */
public fun updateUserBody(displayName: String): JsonObject = JsonObject(mapOf("displayName" to JsonPrimitive(displayName)))
