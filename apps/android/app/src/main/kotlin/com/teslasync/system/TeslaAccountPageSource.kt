// The data port the TeslaAccountPage surface binds to (P1/S8), plus its production binding over the shared-core
// User/Account state holder. The view (composable) performs NO HTTP — it only collects state from the
// view-model, reproducing the web page's reads (web/src/features/system/pages/TeslaAccountPage.tsx):
// `useTeslaUserProfile()` (the cache-then-network `GET /tesla/user/profile` feed) and `useRefreshTeslaProfile()`
// (the `POST /tesla/user/profile/refresh` mutation).
//
// The profile feed is the shared-core cache-then-network `Resource` stream the S8 [UserStore] already exposes
// (one shared upstream every Account surface folds into); the refresh is the store's non-throwing suspend
// `Result` mutation, which re-collects the profile feed on success (the web hook's
// `invalidateQueries(teslaProfile)`). Narrow the seam so the view-model + page depend on an abstraction (the
// real store adapter ↔ a test fake), never on the concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.teslaaccount

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.user.TeslaProfileEnvelope
import io.teslasync.shared.core.presentation.user.UserStore
import kotlinx.coroutines.flow.Flow

/**
 * The seam the TeslaAccountPage surface depends on so it binds to an abstraction (the shared User/Account holder
 * in production, a fake in tests), never to a concrete store or the network. The profile feed is the page's one
 * cache-then-network read; [refreshTeslaProfile] is the page's one mutation. No HTTP touches the view.
 */
interface TeslaAccountPageSource {
    /** The cache-then-network `GET /tesla/user/profile` feed (web `useTeslaUserProfile`). */
    fun teslaUserProfile(): Flow<Resource<TeslaProfileEnvelope>>

    /**
     * Forces a re-sync from Tesla — `POST /tesla/user/profile/refresh` (web `useRefreshTeslaProfile`). A
     * non-throwing [Result]; on success the shared holder re-collects the profile feed (the web hook's
     * `invalidateQueries(teslaProfile)`), so the bound [TeslaUserProfile] view updates in place.
     */
    suspend fun refreshTeslaProfile(): Result<TeslaProfileEnvelope>
}

/**
 * Binds the surface to the shared **S8** [UserStore] — the memoized cache-then-network profile feed every
 * Account surface shares, plus its refresh mutation. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun teslaAccountPageSourceOf(store: UserStore): TeslaAccountPageSource =
    object : TeslaAccountPageSource {
        override fun teslaUserProfile(): Flow<Resource<TeslaProfileEnvelope>> = store.teslaUserProfile()

        override suspend fun refreshTeslaProfile(): Result<TeslaProfileEnvelope> = store.refreshTeslaProfile()
    }
