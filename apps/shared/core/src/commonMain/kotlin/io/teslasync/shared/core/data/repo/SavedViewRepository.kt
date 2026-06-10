package io.teslasync.shared.core.data.repo

import io.teslasync.shared.core.presentation.savedviews.SavedView
import io.teslasync.shared.core.presentation.savedviews.SavedViewCreateInput
import io.teslasync.shared.core.presentation.savedviews.SavedViewUpdateInput
import kotlinx.coroutines.flow.Flow

/**
 * The S7 data port for the per-list-page saved-views library — the cross-platform analogue of the
 * web `useSavedViews` hook domain (web/src/api/hooks/useSavedViews.ts). Every native SavedViewMenu
 * surface (Android/Apple via KMP, Windows via the C# port) reaches the backend exclusively through
 * this interface, so a single fake stands in for the whole domain in the S8 state-holder tests.
 *
 * The single read ([savedViews]) streams a cache-then-network [Resource] (ADR-013): the cached rows
 * first for an instant cold start, then the refreshed rows — always an array, never null, exactly as
 * the web hook guarantees. The four mutations are non-throwing suspend [Result]s; on success each
 * invalidates ONLY the affected route's cache key ([savedViewCacheKey]) — the data-layer analogue of
 * the web hooks invalidating `savedViewsKeys.list(route)` (never the whole `all` prefix), because a
 * write only ever affects the single list page it belongs to.
 *
 * The `query` payload is an opaque list-page querystring snapshot round-tripped verbatim — not
 * display-unit-bearing — so there is no SI conversion at this layer; display formatting is the render
 * boundary's job (S5).
 */
public interface SavedViewRepository {
    /**
     * `GET /saved-views?route=` — the saved-views list for [route] (web `useSavedViews`). The query
     * is built by [savedViewListQuery] (the web `?route=` param) and the cache key by
     * [savedViewCacheKey] (the web `savedViewsKeys.list(route)` tuple). Always resolves to an array.
     */
    public fun savedViews(route: String): Flow<Resource<List<SavedView>>>

    /**
     * `POST /saved-views` — saves a new view (web `useCreateSavedView`). On success the created row's
     * route key is evicted so the next list read for that route re-fetches.
     */
    public suspend fun createSavedView(input: SavedViewCreateInput): Result<SavedView>

    /**
     * `PUT /saved-views/{id}` — patches an existing view (web `useUpdateSavedView`). The [route] is
     * supplied by the caller so the right route key is evicted on success without a round-trip.
     */
    public suspend fun updateSavedView(
        id: Long,
        route: String,
        patch: SavedViewUpdateInput,
    ): Result<SavedView>

    /**
     * `DELETE /saved-views/{id}` — removes a view (web `useDeleteSavedView`). The [route] is supplied
     * by the caller so the right route key is evicted on success.
     */
    public suspend fun deleteSavedView(
        id: Long,
        route: String,
    ): Result<Unit>

    /**
     * `PUT /saved-views/{id}` with `{is_default}` — toggles the default flag (web
     * `useSetDefaultSavedView`). Backed by the same endpoint as [updateSavedView]; the [route] is
     * supplied by the caller so the right route key is evicted on success.
     */
    public suspend fun setDefaultSavedView(
        id: Long,
        route: String,
        isDefault: Boolean,
    ): Result<SavedView>
}

/**
 * Builds the `/saved-views` query map with the web hook's semantics
 * (web/src/api/hooks/useSavedViews.ts `buildQuery`): the `route` param is always sent. The key is
 * snake_case-free `route`, matching the Go handler. Locked by the repository contract test shared
 * with the C# port.
 */
public fun savedViewListQuery(route: String): Map<String, String> = linkedMapOf("route" to route)

/**
 * Builds the stable cache/feed key for [route], mirroring the web `savedViewsKeys.list(route)` tuple
 * `['saved-views', route]`: the route string is the key verbatim, so two reads collide in the cache
 * exactly when their web query keys do. Locked by the repository contract test shared with the C#
 * port.
 */
public fun savedViewCacheKey(route: String): String = route
