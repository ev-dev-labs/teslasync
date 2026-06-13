// The data seam the UserCell surface binds to for the current-user document it reads — the native analogue
// of the web `useCurrentUser` hook (web/src/api/hooks/useUser.ts, `GET /users/me`). The view (composable)
// performs NO HTTP — it only collects state from the [UserCellViewModel], which drives this seam (ADR-002),
// satisfying the "no direct HTTP from the view" contract. A concrete adapter over the shared User layer —
// the S8 [UserStore] for the shared, multi-observer, refresh-on-mutation feed, or the S7 [UserRepository]
// for the cold cache-then-network flow a manual retry re-collects — backs it in production; a test fake
// backs it in unit tests. Mirrors the dual-adapter shape of the sibling Range surface.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UserCell) cannot form a valid Kotlin package. `MatchingDeclarationName`
// and the ktlint filename rule are suppressed: the mandated `UserCell*` filename cannot match the
// `UserCellSource` seam plus its co-located extension adapters.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.usercell

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.UserRepository
import io.teslasync.shared.core.presentation.user.User
import io.teslasync.shared.core.presentation.user.UserStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [UserCellViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never a concrete client — the Android counterpart of the web `useCurrentUser` read. The
 * `GET /users/me` document is carried as the shared-core [User] the backend serves so the cell's identity
 * fields are read verbatim. No HTTP touches the view.
 */
fun interface UserCellSource {
    /** Cache-then-network `GET /users/me` feed (web `useCurrentUser`). */
    fun currentUser(): Flow<Resource<User>>
}

/**
 * Binds the surface to the shared **S8** [UserStore] — the memoized, multi-observer current-user feed every
 * Account-derived surface shares (so a profile update elsewhere refreshes this cell too). No HTTP touches the
 * view.
 */
fun UserStore.asUserCellSource(): UserCellSource {
    val store = this
    return UserCellSource { store.currentUser() }
}

/**
 * Binds the surface to the shared **S7** [UserRepository] — the cold cache-then-network `Flow`. Re-collecting
 * it performs a genuine cache-then-network re-fetch, which backs the surface's manual refresh / error-retry
 * affordance when no shared [UserStore] is in scope. No HTTP touches the view.
 */
fun UserRepository.asUserCellSource(): UserCellSource {
    val repo = this
    return UserCellSource { repo.currentUser() }
}
