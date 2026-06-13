// The single data port the SavedViewMenu shared surface binds to — the native analogue of the five data hooks
// the web component composes (web/src/components/data-display/SavedViewMenu.tsx → useSavedViews,
// useCreateSavedView, useUpdateSavedView, useDeleteSavedView, useSetDefaultSavedView). The view-model depends
// on this abstraction (a real adapter over the shared saved-views layer in production, a fake in tests), never
// on a concrete store or the network, so the view performs NO HTTP (P1/S8 boundary, ADR-002).
//
// A concrete adapter over the shared core backs it in production — the S8 [SavedViewsStore] for the shared,
// multi-observer, refresh-on-mutation feed, or the S7 [SavedViewRepository] for the cold cache-then-network
// flow a manual retry re-collects — and a test fake backs it in unit tests. Mirrors the dual-adapter shape of
// the sibling Range surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SavedViewMenu) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed: the mandated `SavedViewMenu*` filename cannot match the `SavedViewMenuSource` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.sharedsurfaces.savedviewmenu

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SavedViewRepository
import io.teslasync.shared.core.presentation.savedviews.DeleteSavedViewArgs
import io.teslasync.shared.core.presentation.savedviews.SavedView
import io.teslasync.shared.core.presentation.savedviews.SavedViewCreateInput
import io.teslasync.shared.core.presentation.savedviews.SavedViewsStore
import io.teslasync.shared.core.presentation.savedviews.SetDefaultSavedViewArgs
import io.teslasync.shared.core.presentation.savedviews.UpdateSavedViewArgs
import kotlinx.coroutines.flow.Flow

/**
 * The seam the [SavedViewMenuViewModel] binds to so it depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store/repository or the network. [savedViews] is the cache-then-network list read (web
 * `useSavedViews`); [refresh] re-runs it (web query invalidation); the four suspend mutations are the
 * non-throwing [Result]s of the web create / update / delete / set-default hooks. No HTTP touches the view.
 */
interface SavedViewMenuSource {
    /** Cache-then-network `GET /saved-views?route=` feed for [route] (web `useSavedViews`). */
    fun savedViews(route: String): Flow<Resource<List<SavedView>>>

    /** Re-runs the [route] feed — the seam analogue of invalidating `savedViewsKeys.list(route)`. */
    fun refresh(route: String)

    /** `POST /saved-views` — saves a new view (web `useCreateSavedView`). */
    suspend fun create(input: SavedViewCreateInput): Result<SavedView>

    /** `PUT /saved-views/{id}` — patches a view (web `useUpdateSavedView`; also backs pin toggles). */
    suspend fun update(args: UpdateSavedViewArgs): Result<SavedView>

    /** `DELETE /saved-views/{id}` — removes a view (web `useDeleteSavedView`). */
    suspend fun delete(args: DeleteSavedViewArgs): Result<Unit>

    /** `PUT /saved-views/{id}` with `{is_default}` — toggles the default flag (web `useSetDefaultSavedView`). */
    suspend fun setDefault(args: SetDefaultSavedViewArgs): Result<SavedView>
}

/**
 * Binds the surface to the shared **S8** [SavedViewsStore] — the memoized, multi-observer, refresh-on-mutation
 * saved-views feed every native SavedViewMenu shares. This is the production seam: each mutation routes
 * through the store (which evicts + refreshes only the affected route's feed on success), and [refresh] bumps
 * the store's per-route trigger. No HTTP touches the view.
 */
fun SavedViewsStore.asSavedViewMenuSource(): SavedViewMenuSource {
    val store = this
    return object : SavedViewMenuSource {
        override fun savedViews(route: String): Flow<Resource<List<SavedView>>> = store.savedViews(route)

        override fun refresh(route: String) = store.refresh(route)

        override suspend fun create(input: SavedViewCreateInput): Result<SavedView> = store.createSavedView(input)

        override suspend fun update(args: UpdateSavedViewArgs): Result<SavedView> = store.updateSavedView(args)

        override suspend fun delete(args: DeleteSavedViewArgs): Result<Unit> = store.deleteSavedView(args)

        override suspend fun setDefault(args: SetDefaultSavedViewArgs): Result<SavedView> = store.setDefaultSavedView(args)
    }
}

/**
 * Binds the surface to the shared **S7** [SavedViewRepository] — the cold cache-then-network `Flow`.
 * Re-collecting [savedViews] performs a genuine cache-then-network re-fetch, which is why [refresh] is a no-op
 * here: the view-model's retry re-subscribes the cold flow to refetch. The repository evicts the affected
 * route key on each mutation success, so the next collection re-fetches. No HTTP touches the view.
 */
fun SavedViewRepository.asSavedViewMenuSource(): SavedViewMenuSource {
    val repo = this
    return object : SavedViewMenuSource {
        override fun savedViews(route: String): Flow<Resource<List<SavedView>>> = repo.savedViews(route)

        override fun refresh(route: String) = Unit

        override suspend fun create(input: SavedViewCreateInput): Result<SavedView> = repo.createSavedView(input)

        override suspend fun update(args: UpdateSavedViewArgs): Result<SavedView> = repo.updateSavedView(args.id, args.route, args.patch)

        override suspend fun delete(args: DeleteSavedViewArgs): Result<Unit> = repo.deleteSavedView(args.id, args.route)

        override suspend fun setDefault(args: SetDefaultSavedViewArgs): Result<SavedView> =
            repo.setDefaultSavedView(args.id, args.route, args.isDefault)
    }
}
