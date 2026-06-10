package io.teslasync.shared.core.presentation.savedviews

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SavedViewRepository
import io.teslasync.shared.core.data.repo.savedViewCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the per-list-page saved-views library — the cross-platform port of
 * the web `useSavedViews` hook domain (web/src/api/hooks/useSavedViews.ts). Every native
 * SavedViewMenu screen (Android/Apple via KMP, Windows via the C# port) binds to this single holder
 * rather than re-implementing endpoints, query keys, or the per-route invalidation rule.
 *
 * The read ([savedViews]) is exposed as a hot [StateFlow] of a cache-then-network [Resource]
 * (ADR-013): the cached rows first for an instant cold start, then the refreshed rows. Each `route`
 * is a distinct, lazily-created shared feed (mirroring the web's distinct TanStack query keys), so
 * every observer of the same route folds into one upstream collection. The web hook applies no
 * `select`/derivation, so neither does this holder; values stay verbatim (`query` is an opaque
 * querystring blob, not unit-bearing), conversion would be display-only (S5).
 *
 * Mutations are non-throwing suspend [Result]s; on success each refreshes ONLY the affected route's
 * feed ([refresh]), exactly as the web hooks invalidate `savedViewsKeys.list(route)` (never the whole
 * `all` prefix) — a write only ever affects the single list page it belongs to. A failed mutation
 * refreshes nothing (the web `onError` skips invalidation). The repository (S7) evicts that same
 * route key on the same success, so each refresh re-fetches rather than replaying a stale entry. The
 * create path refreshes the CREATED row's route (the web `created.route`); the others refresh the
 * caller-supplied route. The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised; create
 * and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class SavedViewsStore(
    private val repo: SavedViewRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val feeds = mutableMapOf<String, StateFlow<Resource<List<SavedView>>>>()

    // ---- Read ---------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /saved-views?route=` feed for [route] (web `useSavedViews`). The same
     * `route` always returns the same feed; bumping its trigger (via [refresh]) restarts its
     * cache-then-network collection.
     */
    public fun savedViews(route: String): StateFlow<Resource<List<SavedView>>> {
        val key = savedViewCacheKey(route)
        return feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.savedViews(route) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = INITIAL,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Creates a new saved view, then refreshes the created row's route feed (web
     * `useCreateSavedView`, which invalidates `savedViewsKeys.list(created.route)`). A failed create
     * refreshes nothing.
     */
    public suspend fun createSavedView(input: SavedViewCreateInput): Result<SavedView> =
        repo.createSavedView(input).onSuccess { refresh(it.route) }

    /**
     * Patches a saved view, then refreshes the supplied route feed (web `useUpdateSavedView`, which
     * invalidates `savedViewsKeys.list(vars.route)`). A failed update refreshes nothing.
     */
    public suspend fun updateSavedView(args: UpdateSavedViewArgs): Result<SavedView> =
        repo.updateSavedView(args.id, args.route, args.patch).onSuccess { refresh(args.route) }

    /**
     * Deletes a saved view, then refreshes the supplied route feed (web `useDeleteSavedView`, which
     * invalidates `savedViewsKeys.list(route)`). A failed delete refreshes nothing.
     */
    public suspend fun deleteSavedView(args: DeleteSavedViewArgs): Result<Unit> =
        repo.deleteSavedView(args.id, args.route).onSuccess { refresh(args.route) }

    /**
     * Toggles the default flag on a saved view, then refreshes the supplied route feed (web
     * `useSetDefaultSavedView`, which invalidates `savedViewsKeys.list(vars.route)`). A failed toggle
     * refreshes nothing.
     */
    public suspend fun setDefaultSavedView(args: SetDefaultSavedViewArgs): Result<SavedView> =
        repo.setDefaultSavedView(args.id, args.route, args.isDefault).onSuccess { refresh(args.route) }

    /**
     * Re-fetches the feed for [route] — the holder-side analogue of invalidating
     * `savedViewsKeys.list(route)`. Bumping the route's trigger restarts its cache-then-network
     * collection. A route nobody is observing is a no-op.
     */
    public fun refresh(route: String) {
        triggers[savedViewCacheKey(route)]?.update { n -> n + 1 }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val INITIAL: Resource<List<SavedView>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
