package io.teslasync.shared.core.presentation.user

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.USER_ME_KEY
import io.teslasync.shared.core.data.repo.USER_TESLA_FEATURE_CONFIG_KEY
import io.teslasync.shared.core.data.repo.USER_TESLA_ORDERS_KEY
import io.teslasync.shared.core.data.repo.USER_TESLA_PROFILE_KEY
import io.teslasync.shared.core.data.repo.USER_TESLA_REGION_KEY
import io.teslasync.shared.core.data.repo.UserRepository
import io.teslasync.shared.core.data.repo.userActivityCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.serialization.json.JsonElement

/**
 * UI-free shared state holder for the User / Account domain — the cross-platform port of the web
 * `useUser` hook domain (web/src/api/hooks/useUser.ts). Every native Account / Profile screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, or invalidation rules.
 *
 * The six reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013): each is
 * lazily created on first access, shared so every observer of the same `(feed[, params])` folds into
 * one upstream collection, and refreshable. The five mutations are non-throwing suspend [Result]s; on
 * success each refreshes EXACTLY the feed the matching web hook invalidates:
 *  - updateUser                 → the `me` feed (web `queryClient.setQueryData(userKeys.me, …)`);
 *  - refreshTeslaFeatureConfig  → the `tesla-feature-config` feed;
 *  - refreshTeslaRegion         → the `tesla-user-region` feed;
 *  - refreshTeslaOrders         → the `tesla-user-orders` feed;
 *  - refreshTeslaProfile        → the `tesla-user-profile` feed.
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached value first (the web behaviour of keeping prior data during a refetch). A feed nobody
 * is observing is a no-op to refresh. The holder makes no network calls itself — it delegates
 * entirely to the injected [UserRepository] (S7).
 *
 * Optimistic UI, the web `staleTime` cadence, `retry` counts, and toasts are render-layer concerns
 * and are intentionally NOT reproduced here. This holder mirrors the web hook's single-threaded usage
 * and is not internally synchronised; create and drive it from one confinement (the platform main
 * scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class UserStore(
    private val repo: UserRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<*>>>()

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable `GET /users/me` feed (web `useCurrentUser`). */
    public fun currentUser(): StateFlow<Resource<User>> = feed(USER_ME_KEY) { repo.currentUser() }

    /**
     * Shared, refreshable `GET /users/me/activity` feed for [params] (web `useMyRecentActivity`). Each
     * distinct params set caches independently under its own [userActivityCacheKey].
     */
    public fun myRecentActivity(params: MyActivityParams = MyActivityParams()): StateFlow<Resource<List<UserActivityEntry>>> =
        feed(userActivityCacheKey(params)) { repo.myRecentActivity(params) }

    /** Shared, refreshable `GET /tesla/user/feature-config` feed (web `useTeslaFeatureConfig`). */
    public fun teslaFeatureConfig(): StateFlow<Resource<TeslaConfigEnvelope<JsonElement>>> =
        feed(USER_TESLA_FEATURE_CONFIG_KEY) { repo.teslaFeatureConfig() }

    /** Shared, refreshable `GET /tesla/user/region` feed (web `useTeslaUserRegion`). */
    public fun teslaUserRegion(): StateFlow<Resource<TeslaConfigEnvelope<TeslaRegionData>>> =
        feed(USER_TESLA_REGION_KEY) { repo.teslaUserRegion() }

    /** Shared, refreshable `GET /tesla/user/orders` feed (web `useTeslaUserOrders`). */
    public fun teslaUserOrders(): StateFlow<Resource<TeslaOrdersEnvelope>> = feed(USER_TESLA_ORDERS_KEY) { repo.teslaUserOrders() }

    /** Shared, refreshable `GET /tesla/user/profile` feed (web `useTeslaUserProfile`). */
    public fun teslaUserProfile(): StateFlow<Resource<TeslaProfileEnvelope>> = feed(USER_TESLA_PROFILE_KEY) { repo.teslaUserProfile() }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Updates the current user's display name, then refreshes the `me` feed (web `useUpdateUser`,
     * whose `onSuccess` writes the response into `userKeys.me`).
     */
    public suspend fun updateUser(displayName: String): Result<User> = repo.updateUser(displayName).onSuccess { refresh(USER_ME_KEY) }

    /**
     * Refreshes the Tesla feature config, then re-collects the `tesla-feature-config` feed (web
     * `useRefreshTeslaFeatureConfig`).
     */
    public suspend fun refreshTeslaFeatureConfig(): Result<TeslaConfigEnvelope<JsonElement>> =
        repo.refreshTeslaFeatureConfig().onSuccess { refresh(USER_TESLA_FEATURE_CONFIG_KEY) }

    /** Refreshes the Tesla region, then re-collects the `tesla-user-region` feed (web `useRefreshTeslaRegion`). */
    public suspend fun refreshTeslaRegion(): Result<TeslaConfigEnvelope<TeslaRegionData>> =
        repo.refreshTeslaRegion().onSuccess { refresh(USER_TESLA_REGION_KEY) }

    /** Refreshes the Tesla orders, then re-collects the `tesla-user-orders` feed (web `useRefreshTeslaOrders`). */
    public suspend fun refreshTeslaOrders(): Result<TeslaOrdersEnvelope> =
        repo.refreshTeslaOrders().onSuccess { refresh(USER_TESLA_ORDERS_KEY) }

    /** Refreshes the Tesla profile, then re-collects the `tesla-user-profile` feed (web `useRefreshTeslaProfile`). */
    public suspend fun refreshTeslaProfile(): Result<TeslaProfileEnvelope> =
        repo.refreshTeslaProfile().onSuccess { refresh(USER_TESLA_PROFILE_KEY) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refresh]), and [SharingStarted.WhileSubscribed] keeps
     * a single upstream shared across observers while at least one is active. The per-key value type is
     * invariant for a given [key] (each key has exactly one source shape), so the unchecked cast on
     * return is safe.
     */
    @Suppress("UNCHECKED_CAST")
    private fun <T> feed(
        key: String,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                )
        } as StateFlow<Resource<T>>

    /** Re-fetches [key]'s feed if it is being observed; a no-op for a feed nobody has opened. */
    private fun refresh(key: String) {
        triggers[key]?.update { it + 1 }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
    }
}
