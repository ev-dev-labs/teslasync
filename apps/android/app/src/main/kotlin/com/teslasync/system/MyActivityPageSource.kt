// The data port the MyActivityPage surface binds to (P1/S8), plus its production binding over the shared-core
// User/Account state holder. The view (composable) performs NO HTTP — it only collects state from the
// view-model, reproducing the web page's single read (web/src/features/system/pages/MyActivityPage.tsx):
// `useMyRecentActivity({ start, end, limit })` (the cache-then-network `GET /users/me/activity` feed).
//
// The activity feed is the shared-core cache-then-network `Resource` stream the S8 [UserStore] already exposes
// (one shared upstream per params set every Account surface folds into). Narrow the seam so the view-model + page
// depend on an abstraction (the real store adapter ↔ a test fake), never on the concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.myactivity

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.user.MyActivityParams
import io.teslasync.shared.core.presentation.user.UserActivityEntry
import io.teslasync.shared.core.presentation.user.UserStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [MyActivityPageViewModel] depends on so it binds to an abstraction (the shared User/Account
 * holder in production, a fake in tests), never to a concrete store or the network. The activity feed is the
 * page's one cache-then-network read; each distinct [MyActivityParams] (the committed date range) caches
 * independently. No HTTP touches the view.
 */
interface MyActivityPageSource {
    /**
     * The cache-then-network `GET /users/me/activity` feed for [params] (web `useMyRecentActivity`). A 503
     * (ForwardAuth disabled) or 401 (no identity header) surfaces as a `Resource.Error` carrying an
     * `ApiError.Http`, which the view-model projects to the explanatory empty states.
     */
    fun myRecentActivity(params: MyActivityParams): Flow<Resource<List<UserActivityEntry>>>
}

/**
 * Binds the surface to the shared **S8** [UserStore] — the memoized cache-then-network activity feed every
 * Account surface shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun myActivityPageSourceOf(store: UserStore): MyActivityPageSource =
    object : MyActivityPageSource {
        override fun myRecentActivity(params: MyActivityParams): Flow<Resource<List<UserActivityEntry>>> =
            store.myRecentActivity(params)
    }
