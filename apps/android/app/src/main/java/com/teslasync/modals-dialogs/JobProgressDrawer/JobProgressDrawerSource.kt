// The data port the JobProgressDrawer overlay binds to (P1/S8 state-holder seam) — the native
// analogue of the web component's single hook composition
// (web/src/api/hooks/useExports.ts `useExportJobs` -> web/src/components/feedback/JobProgressDrawer.tsx).
// The view never performs HTTP itself; a shared adapter (the S8 ExportsStore or the S7
// ExportsRepository) or a test fake drives this. Cache-then-network freshness is preserved end to end
// (ADR-013): every read emission's cached/stale/error flags flow through unchanged so the view-model
// can render the full state matrix.
//
// The web drawer reads exactly one feed (`useExportJobs`) and performs no mutations, so this seam is
// a single read plus the re-fetch trigger — far narrower than the sibling ScheduledExportsPanel seam.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated
// surface directory (com/teslasync/modals-dialogs/JobProgressDrawer) cannot form a valid Kotlin
// package and the file hosts the seam plus its bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.modalsdialogs.jobprogressdrawer

import io.teslasync.shared.core.data.repo.ExportsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import io.teslasync.shared.core.presentation.exports.ExportsStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [JobProgressDrawerViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete store or the network. [exportJobs] is the
 * cache-then-network job-summary feed the web `useExportJobs` serves; [invalidate] is the re-fetch
 * trigger. No HTTP touches the view.
 */
interface JobProgressDrawerSource {
    /** Stream the cache-then-network export-job summaries (web `useExportJobs`, `safeArray`-guarded). */
    fun exportJobs(): Flow<Resource<List<ExportJobSummary>>>

    /** Re-fetch the jobs feed; a no-op for a binding whose read re-collection already re-fetches. */
    fun invalidate()
}

/**
 * Binds the surface to the shared **S8** [ExportsStore] (web `useExports.ts`). The store owns the
 * shared `['export-jobs']` feed; re-collecting it replays the already-shared current state, so
 * [invalidate] is a no-op (the store exposes no standalone job-feed invalidate — only its export
 * mutations refresh that prefix). Use the S7 binding below when a host needs retry to force a genuine
 * cold re-fetch. No HTTP touches the view — the store (S7/S8) owns it.
 */
fun jobProgressDrawerSource(store: ExportsStore): JobProgressDrawerSource =
    object : JobProgressDrawerSource {
        override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> = store.exportJobs()

        override fun invalidate() = Unit
    }

/**
 * Binds the surface directly to the shared **S7** [ExportsRepository]. Each [exportJobs] call starts a
 * NEW cache-then-network collection, so the view-model's refresh/retry trigger a genuine re-fetch (the
 * web `refetch()` behaviour while replaying the last cached rows first) and [invalidate] is a no-op —
 * the binding to use when a host does not share app-wide stores.
 */
fun jobProgressDrawerSource(repository: ExportsRepository): JobProgressDrawerSource =
    object : JobProgressDrawerSource {
        override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> = repository.exportJobs()

        override fun invalidate() = Unit
    }
