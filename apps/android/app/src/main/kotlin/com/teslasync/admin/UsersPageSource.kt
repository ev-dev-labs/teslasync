// The data seam the UsersPage admin surface binds to, plus its production binding over the shared S8
// ImpersonationStore. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's two TanStack-Query reads (`useImpersonationStatus` +
// `useImpersonationCandidates`) and the start mutation (`useStartImpersonation`).
//
// The reads are the shared-core cache-then-network feeds the S8 ImpersonationStore already exposes: the
// candidates list (`GET /admin/impersonate/candidates` ▸ candidates) plus the two derived predicate flows
// ([isOpenMode] = web `isImpersonationOpenMode`, [isActive] = web `isImpersonationActive`) folded from the
// status feed (`GET /admin/impersonate`). [startImpersonation] is the store's non-throwing start mutation (web
// `useStartImpersonation`, which wipes the cache + primes the new active state + refreshes both feeds);
// [refresh] re-fetches both feeds (the web candidates `refetch` / error retry + the status poll). A narrow seam
// so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the
// network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located store-binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.users

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.impersonation.ImpersonationCandidatesResponse
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStartRequest
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStore
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [UsersPageViewModel] depends on so it binds to an abstraction (the shared Impersonation
 * holder in production, a fake in tests), never to a concrete store or the network — the Android counterpart of
 * the web `useImpersonation` read + start. No HTTP touches the view.
 *
 * @property candidates the cache-then-network impersonatable-subjects feed (web `useImpersonationCandidates`).
 * @property isOpenMode `true` once the deployment resolves to open mode (web `isImpersonationOpenMode`).
 * @property isActive `true` while a session is active, so the per-row buttons disable (web `isImpersonationActive`).
 */
interface UsersPageSource {
    /** The typed `GET /admin/impersonate/candidates` feed (web `useImpersonationCandidates`). */
    val candidates: StateFlow<Resource<ImpersonationCandidatesResponse>>

    /** `true` once the state resolves to open mode (web `isImpersonationOpenMode`); `false` while loading. */
    val isOpenMode: StateFlow<Boolean>

    /** `true` while an impersonation session is active (web `isImpersonationActive`). */
    val isActive: StateFlow<Boolean>

    /** Starts impersonating [subject] (web `useStartImpersonation`); non-throwing [Result]. */
    suspend fun startImpersonation(subject: String): Result<ImpersonationStatus>

    /** Re-fetches the observed feeds (web candidates `refetch` / error retry + the status poll). */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [ImpersonationStore] — the single memoized impersonation feed every
 * Impersonation surface shares, so a start here (or an end from the global banner) refreshes this list too. The
 * store owns the endpoints, query keys, open-mode normalisation, and the invalidate-all rule; this adapter only
 * forwards the candidates feed, the two derived predicates, and the start/refresh actions. No HTTP touches the
 * view.
 */
fun ImpersonationStore.asUsersPageSource(): UsersPageSource {
    val store = this
    return object : UsersPageSource {
        override val candidates: StateFlow<Resource<ImpersonationCandidatesResponse>> get() = store.candidates

        override val isOpenMode: StateFlow<Boolean> get() = store.isOpenMode

        override val isActive: StateFlow<Boolean> get() = store.isActive

        override suspend fun startImpersonation(subject: String): Result<ImpersonationStatus> =
            store.startImpersonation(ImpersonationStartRequest(subject))

        override fun refresh() = store.refreshAll()
    }
}
