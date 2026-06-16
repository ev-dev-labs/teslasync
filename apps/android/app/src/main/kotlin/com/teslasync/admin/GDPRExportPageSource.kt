// The data seam the GDPRExportPage admin surface binds to, plus its production binding over the shared S8
// OperatorConfidenceStore. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's single TanStack-Query read (`useGDPRExport`).
//
// The read is the typed, cache-then-network [Resource] stream the shared S8 OperatorConfidenceStore already
// exposes (`GET /admin/gdpr/exports/{id}` ▸ gdprExport(id)); [refresh] is the store's own per-feed re-fetch
// (the web `refetchInterval` poll + the error-state retry). A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete store or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is
// suppressed for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.gdpr

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.operatorconfidence.GDPRExportArtifact
import io.teslasync.shared.core.presentation.operatorconfidence.OperatorConfidenceStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [GDPRExportPageViewModel] depends on so it binds to an abstraction (the shared
 * Operator-Confidence holder in production, a fake in tests), never to a concrete store or the network. The
 * read is a cache-then-network typed `Resource` flow (web `useGDPRExport`); [refresh] re-fetches the feed for
 * [id] (the web query `refetch` / the FAST poll). No HTTP touches the view.
 */
interface GdprExportSource {
    /** The typed `GET /admin/gdpr/exports/{id}` feed for [id] (web `useGDPRExport`). */
    fun gdprExport(id: String): Flow<Resource<GDPRExportArtifact>>

    /** Re-fetches the [id] feed if it is being observed (web `refetch` + the FAST poll). */
    fun refresh(id: String)
}

/**
 * Binds the surface to the shared **S8** [OperatorConfidenceStore] — the memoized, multi-observer
 * operator-confidence feeds the app shares. The live values flow through unchanged so the view-model renders
 * the full state matrix (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun OperatorConfidenceStore.asGdprExportSource(): GdprExportSource {
    val store = this
    return object : GdprExportSource {
        override fun gdprExport(id: String): Flow<Resource<GDPRExportArtifact>> = store.gdprExport(id)

        override fun refresh(id: String) = store.refreshGdprExport(id)
    }
}
