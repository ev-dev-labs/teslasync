// The data seam the ExportsPage surface binds to, plus its production binding over the shared-core Exports
// repository. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's read (`useExportJobs` → `GET /export/jobs`) and its single mutation
// (`useBulkExportsDelete` → `POST /export/jobs/bulk`).
//
// The jobs feed is the shared-core cache-then-network `Resource` stream the S7 [ExportsRepository] already
// exposes (`exportJobs()`). The Android DI graph ([io.teslasync.android.data.DataContainer]) wires no
// ExportsStore (S8), and the shared [io.teslasync.shared.core.presentation.exports.ExportsStore] exposes no
// public on-demand refresh for the page's error-retry affordance (it only re-fetches via mutation
// invalidation), so the host constructs the shared [io.teslasync.shared.core.data.repo.HttpExportsRepository]
// over the SAME resilient client + offline cache the other repositories use (so the ADR-013 freshness contract
// + raw caching are identical) and the view-model owns the refresh trigger — exactly as the sibling
// DrivesListPage surface binds the shared DrivingRepository. A narrow seam so the view-model depends on an
// abstraction (real adapter ↔ test fake), never on a concrete repository or the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/exports) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located production-binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.exports.exports

import io.teslasync.shared.core.data.repo.ExportsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.exports.ExportBulkResult
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [ExportsPageViewModel] depends on so it binds to an abstraction (the shared exports
 * repository in production, a fake in tests), never to a concrete repository or the network. The jobs feed is a
 * cache-then-network `Resource` flow (the web `useExportJobs` read); the bulk delete is the page's one mutation
 * (web `useBulkExportsDelete`). No HTTP touches the view.
 */
interface ExportsPageSource {
    /** The cache-then-network `GET /export/jobs` job-summary feed (web `useExportJobs`). */
    fun exportJobs(): Flow<Resource<List<ExportJobSummary>>>

    /** Bulk-deletes [ids] then resolves the API result (web `useBulkExportsDelete` → `POST /export/jobs/bulk`). */
    suspend fun bulkExportsDelete(ids: List<String>): Result<ExportBulkResult>
}

/**
 * Binds the surface to the shared **S7** [ExportsRepository] — the memoized cache-then-network jobs feed every
 * exports surface shares. The live values flow through unchanged so the view-model renders the full state matrix
 * (loading / content / empty / error / stale / offline). No HTTP touches the view.
 */
fun exportsPageSourceOf(exportsRepository: ExportsRepository): ExportsPageSource =
    object : ExportsPageSource {
        override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> = exportsRepository.exportJobs()

        override suspend fun bulkExportsDelete(ids: List<String>): Result<ExportBulkResult> =
            exportsRepository.bulkExportsDelete(ids)
    }
