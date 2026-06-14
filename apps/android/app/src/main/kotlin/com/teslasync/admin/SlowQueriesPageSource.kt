// The data seam the SlowQueriesPage admin surface binds to, plus its production binding over the shared S8
// OperatorConfidenceStore. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's single TanStack-Query read (`useSlowQueries`).
//
// The read is the shared-core cache-then-network `Resource` stream the S8 OperatorConfidenceStore already
// exposes (`GET /admin/observability/slow-queries?order_by&limit` ▸ slowQueries(orderBy, limit)); [refresh] is
// the store's own per-feed re-fetch for the active (order_by, limit) pair (the web `refetchInterval` /
// error-retry analogue). A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake),
// never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.slowqueries

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueriesResponse
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueryOrderBy
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [SlowQueriesPageViewModel] depends on so it binds to an abstraction (the shared
 * Operator-Confidence holder in production, a fake in tests), never to a concrete store or the network. The
 * read is a cache-then-network typed `Resource` flow per (order_by, limit) pair (web `useSlowQueries`);
 * [refresh] re-fetches the active pair (the web query `refetch` / the error-state retry). No HTTP touches the
 * view.
 */
interface SlowQueriesSource {
    /** The typed `GET /admin/observability/slow-queries` feed for [orderBy] + [limit] (web `useSlowQueries`). */
    fun slowQueries(
        orderBy: SlowQueryOrderBy,
        limit: Int,
    ): Flow<Resource<SlowQueriesResponse>>

    /** Re-fetches the slow-query feed for the active [orderBy] + [limit] pair (web `refetch` / error retry). */
    fun refresh(
        orderBy: SlowQueryOrderBy,
        limit: Int,
    )
}

/**
 * Binds the surface to the shared **S8** [OperatorConfidenceStore] — the memoized, multi-observer admin feeds
 * the app shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun OperatorConfidenceStore.asSlowQueriesSource(): SlowQueriesSource {
    val store = this
    return object : SlowQueriesSource {
        override fun slowQueries(
            orderBy: SlowQueryOrderBy,
            limit: Int,
        ): Flow<Resource<SlowQueriesResponse>> = store.slowQueries(orderBy, limit)

        override fun refresh(
            orderBy: SlowQueryOrderBy,
            limit: Int,
        ) = store.refreshSlowQueries(orderBy, limit)
    }
}
