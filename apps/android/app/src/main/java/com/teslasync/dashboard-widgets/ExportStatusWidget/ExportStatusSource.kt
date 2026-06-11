// The data port the Export Status widget binds to — the native analogue of the web `useExports` +
// `useExportJobs` (admin) hook composition (web/src/features/dashboard/widgets/ExportStatusWidget.tsx,
// web/src/api/hooks/useExports.ts, web/src/api/hooks/useAdmin.ts). The view never performs HTTP; a
// concrete adapter over the shared S8 state holders (or a test fake) drives this seam. Cache-then-network
// freshness is preserved end to end (ADR-013): each parsed projection carries every cached/stale/error
// flag from its upstream feed so the view-model can render the full state matrix and merge the two
// sources exactly as the web `sortedJobs` memo does.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ExportStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.exportstatus

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.exports.ExportsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Streams the two cache-then-network job feeds the widget merges: the Fleet-export feed
 * ([exports], web `useExports`) and the admin export-jobs feed ([adminJobs], web `useExportJobs`).
 * A two-method seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on
 * a concrete store or the network. Both feeds are already parsed into [ExportStatusJob] rows with
 * their freshness flags intact, so the view-model only has to combine + project them.
 */
interface ExportStatusSource {
    /** The cache-then-network Fleet-export feed (web `useExports`), parsed into job rows. */
    fun exports(): Flow<Resource<List<ExportStatusJob>>>

    /** The cache-then-network admin export-jobs feed (web `useExportJobs`), parsed into job rows. */
    fun adminJobs(): Flow<Resource<List<ExportStatusJob>>>
}

/**
 * Apply [transform] to the value carried by a [Resource], preserving the freshness flags
 * (cached / refreshing / stale / offline + error) exactly. A non-present cached value stays absent
 * so a first-load Loading slot is never fabricated into empty content.
 */
internal fun <T, R> Resource<T>.mapResource(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * The shared-state-holder-backed [ExportStatusSource]. It maps the shared [ExportsStore.exports]
 * feed (web `useExports`) into [ExportStatusJob]s via [ExportStatusJob.fromExport], and the shared
 * [AdminStore.exportJobs] feed (web `useExportJobs`, raw JSON) via [ExportStatusJob.parseAdminList].
 * No HTTP touches the view — the S7/S8 stores own it.
 */
class StoreExportStatusSource(
    private val exportsStore: ExportsStore,
    private val adminStore: AdminStore,
) : ExportStatusSource {
    override fun exports(): Flow<Resource<List<ExportStatusJob>>> =
        exportsStore.exports().map { resource ->
            resource.mapResource { jobs -> jobs.map(ExportStatusJob::fromExport) }
        }

    override fun adminJobs(): Flow<Resource<List<ExportStatusJob>>> =
        adminStore.exportJobs().map { resource ->
            resource.mapResource(ExportStatusJob::parseAdminList)
        }
}
