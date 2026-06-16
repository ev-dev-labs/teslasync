// The data seam the RbacMatrixPage admin surface binds to, plus its production binding over the shared S8
// RbacMatrixStore. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's two TanStack-Query surfaces (`useRbacMatrix`,
// `useUpsertRbacCells`) plus the pure `diffMatrices` helper.
//
// The read is the typed, cache-then-network [Resource] StateFlow the shared S8 RbacMatrixStore already
// exposes (`GET /admin/rbac/matrix` ▸ a Open | Session union); the save is the store's own non-throwing
// suspend mutation, which refreshes the matrix feed on success (the web
// `invalidateQueries(rbacMatrixKeys.matrix())`). A narrow seam so the view-model depends on an abstraction
// (real adapter ↔ test fake), never on a concrete store or the network. The member names mirror the web
// hooks verbatim (`useRbacMatrix` / `useUpsertRbacCells` / `diffMatrices`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.rbac

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixResponse
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixStore
import io.teslasync.shared.core.presentation.rbacmatrix.RbacUpsertCell
import kotlinx.coroutines.flow.StateFlow

/**
 * The single seam the [RbacMatrixPageViewModel] depends on so it binds to an abstraction (the shared RBAC
 * holder in production, a fake in tests), never to a concrete store or the network.
 *
 *  - [useRbacMatrix] is the cache-then-network typed `Resource` feed (web `useRbacMatrix`).
 *  - [useUpsertRbacCells] is the non-throwing save that refreshes the feed on success (web
 *    `useUpsertRbacCells`); an empty batch is a backend no-op that still succeeds.
 *  - [refresh] re-fetches the observed feed (the web query `refetch` / the error-state retry).
 *  - [diffMatrices] is the pure snapshot diff (web `diffMatrices`) — the minimal upsert batch from the
 *    loaded baseline to the operator's draft.
 *
 * No HTTP touches the view.
 */
interface RbacMatrixSource {
    /** The typed `GET /admin/rbac/matrix` document feed (web `useRbacMatrix`). */
    fun useRbacMatrix(): StateFlow<Resource<RbacMatrixResponse>>

    /** Persists the changed `(role, permission, allowed)` cells (web `useUpsertRbacCells`). */
    suspend fun useUpsertRbacCells(cells: List<RbacUpsertCell>): Result<Unit>

    /** Re-fetches the observed matrix feed (web query `refetch` / the error-state retry). */
    fun refresh()

    /** The minimal upsert batch from [base] to [draft] (web `diffMatrices`). Pure: no network, no state. */
    fun diffMatrices(
        base: Map<String, Map<String, Boolean>>,
        draft: Map<String, Map<String, Boolean>>,
    ): List<RbacUpsertCell>
}

/**
 * Binds the surface to the shared **S8** [RbacMatrixStore] — the memoized, multi-observer RBAC feed the app
 * shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / open-mode / empty / error / content). The store already refreshes the matrix feed after a
 * successful save (web `invalidateQueries(rbacMatrixKeys.matrix())`), so the grid self-updates. No HTTP
 * touches the view.
 */
fun RbacMatrixStore.asRbacMatrixSource(): RbacMatrixSource {
    val store = this
    return object : RbacMatrixSource {
        override fun useRbacMatrix(): StateFlow<Resource<RbacMatrixResponse>> = store.matrix

        override suspend fun useUpsertRbacCells(cells: List<RbacUpsertCell>): Result<Unit> = store.upsertCells(cells)

        override fun refresh() = store.refresh()

        override fun diffMatrices(
            base: Map<String, Map<String, Boolean>>,
            draft: Map<String, Map<String, Boolean>>,
        ): List<RbacUpsertCell> = store.diffMatrices(base, draft)
    }
}
