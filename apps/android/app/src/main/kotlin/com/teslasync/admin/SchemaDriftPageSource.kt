// The data seam the SchemaDriftPage admin surface binds to, plus its production binding over the shared S8
// OperatorConfidenceStore. The view (composable) performs NO HTTP — it only collects state from the view-model,
// which drives this seam, reproducing the web page's single TanStack-Query read (`useSchemaDrift`).
//
// The read is the shared-core cache-then-network `Resource` stream the S8 OperatorConfidenceStore already
// exposes (`GET /admin/observability/schema-drift` ▸ schemaDrift()); [refresh] is the store's own
// per-feed re-fetch (the web `refetchInterval` / error-retry analogue). A narrow seam so the view-model
// depends on an abstraction (real adapter ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.schemadrift

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore
import io.teslasync.shared.core.presentation.operatorconfidence.SchemaDriftResponse
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [SchemaDriftPageViewModel] depends on so it binds to an abstraction (the shared
 * Operator-Confidence holder in production, a fake in tests), never to a concrete store or the network. The
 * read is a cache-then-network typed `Resource` flow (web `useSchemaDrift`); [refresh] re-fetches it (the web
 * query `refetch` / the error-state retry). No HTTP touches the view.
 */
interface SchemaDriftSource {
    /** The typed `GET /admin/observability/schema-drift` feed (web `useSchemaDrift`). */
    fun schemaDrift(): Flow<Resource<SchemaDriftResponse>>

    /** Re-fetches the schema-drift feed (web `refetch` / error retry). */
    fun refresh()
}

/**
 * Binds the surface to the shared **S8** [OperatorConfidenceStore] — the memoized, multi-observer admin feeds
 * the app shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun OperatorConfidenceStore.asSchemaDriftSource(): SchemaDriftSource {
    val store = this
    return object : SchemaDriftSource {
        override fun schemaDrift(): Flow<Resource<SchemaDriftResponse>> = store.schemaDrift()

        override fun refresh() = store.refreshSchemaDrift()
    }
}
