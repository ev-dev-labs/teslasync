// The data seam the DataPipelineSection feature view binds to (P1/S8 state-holder layer) — the native
// analogue of the web component's two-`useQuery` composition (`getCompressionStats` + `getExportJobs`,
// web/src/features/system/components/status/DataPipelineSection.tsx). The view never performs HTTP itself: a
// concrete adapter over the shared S8 state holders (or a test fake) drives this seam, so the cross-platform
// caching/freshness contract (ADR-013) is honoured in one place and a fake stands in off-device.
//
// Both feeds are cache-then-network [Resource] streams. The compression feed is the shared
// [AdminStore.compressionStats] raw-JSON read (`/system/compression-stats`), parsed here into the typed
// [CompressionStats] so the compression-specific shape stays local to this surface — exactly the pattern the
// sibling ExportStatusWidget uses to parse the [AdminStore] export-jobs JSON in its own projection. The
// export-jobs feed is the already-typed [ExportsStore.exportJobs] read, used verbatim.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DataPipelineSection) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.datapipelinesection

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import io.teslasync.shared.core.presentation.exports.ExportsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Streams the two cache-then-network feeds the surface composes: the parsed compression statistics
 * ([compressionStats], web `getCompressionStats`) and the export-job summaries ([exportJobs], web
 * `getExportJobs`). A two-method seam so the view-model depends on an abstraction (real adapter ↔ test fake),
 * never on a concrete store or the network. The compression feed is already parsed into a typed
 * [CompressionStats] (`null` when the query has not resolved to an object), so the view-model only has to
 * project + combine.
 */
interface DataPipelineSource {
    /** The cache-then-network compression-stats feed (web `getCompressionStats`), parsed off the admin JSON. */
    fun compressionStats(): Flow<Resource<CompressionStats?>>

    /** The cache-then-network export-job-summaries feed (web `getExportJobs`). */
    fun exportJobs(): Flow<Resource<List<ExportJobSummary>>>
}

/**
 * Apply [transform] to the value carried by a [Resource], preserving the freshness flags
 * (cached / refreshing / stale / offline + error) exactly. A non-present cached value stays absent so a
 * first-load Loading slot is never fabricated into content.
 */
internal fun <T, R> Resource<T>.mapResource(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * The shared-state-holder-backed [DataPipelineSource]. It maps the shared [AdminStore.compressionStats] raw
 * JSON feed into a typed [CompressionStats] via [DataPipelineProjection.parseCompression], and forwards the
 * shared [ExportsStore.exportJobs] typed feed verbatim. No HTTP touches the view — the S7/S8 stores own it.
 */
class StoreDataPipelineSource(
    private val adminStore: AdminStore,
    private val exportsStore: ExportsStore,
) : DataPipelineSource {
    override fun compressionStats(): Flow<Resource<CompressionStats?>> =
        adminStore.compressionStats().map { resource ->
            resource.mapResource(DataPipelineProjection::parseCompression)
        }

    override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> = exportsStore.exportJobs()
}
