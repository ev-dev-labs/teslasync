// The data seam the DataExportPage system surface binds to, plus its production binding over the shared S8
// ExportsStore + VehiclesStore. The view (composable) performs NO HTTP — it only collects state from the
// view-model, which drives this seam, reproducing the web page's TanStack-Query reads (`useExportJobs`,
// `useVehicles`, `useExportColumns`) and its two create mutations (`useCreateExport`, `useCreateAccountExport`).
//
// A narrow seam so the view-model depends on an abstraction (real adapter ↔ test fake), never on a concrete
// store or the network. Each read is a shared cache-then-network [Resource] flow; each mutation is a
// non-throwing suspend [Result] that the store also uses to refresh the affected job feeds (the
// `invalidateQueries` analogue).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges
// from the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed
// for the co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.dataexport

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.exports.CreateAccountExportPayload
import io.teslasync.shared.core.presentation.exports.CreateExportPayload
import io.teslasync.shared.core.presentation.exports.ExportColumnsResponse
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import io.teslasync.shared.core.presentation.exports.ExportsStore
import io.teslasync.shared.core.presentation.vehicles.VehiclesStore
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [DataExportPageViewModel] depends on so it binds to an abstraction (the shared Exports +
 * Vehicles holders in production, a fake in tests), never to a concrete store or the network. The three reads
 * are cache-then-network `Resource` flows (the web read hooks); the two mutations are non-throwing suspend
 * `Result`s (the web create hooks). No HTTP touches the view.
 */
interface DataExportSource {
    /** The `GET /export/jobs` job-summary feed (web `useExportJobs`). */
    fun exportJobs(): Flow<Resource<List<ExportJobSummary>>>

    /** The `GET /vehicles` enrolled-vehicle feed (web `useVehicles`). */
    fun vehicles(): Flow<Resource<List<Vehicle>>>

    /**
     * The `GET /exports/columns?type=` catalog feed (web `useExportColumns`). A null/blank [type] returns a
     * stable non-fetching feed (the web `enabled: !!type` gate).
     */
    fun exportColumns(type: String?): Flow<Resource<ExportColumnsResponse>>

    /** Queues a wizard export, refreshing the job feeds on success (web `useCreateExport`). */
    suspend fun createExport(payload: CreateExportPayload): Result<ExportJobSummary>

    /** Queues a full account export, refreshing the job feeds on success (web `useCreateAccountExport`). */
    suspend fun createAccountExport(payload: CreateAccountExportPayload): Result<ExportJobSummary>
}

/**
 * Binds the surface to the shared **S8** [ExportsStore] + [VehiclesStore] — the memoized, multi-observer feeds
 * every Exports/Vehicles surface shares app-wide. The live values flow through unchanged so the view-model
 * renders the full state matrix (loading / content / empty / stale / offline / error). No HTTP touches the view.
 */
fun bindDataExportSource(
    exports: ExportsStore,
    vehicles: VehiclesStore,
): DataExportSource =
    object : DataExportSource {
        override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> = exports.exportJobs()

        override fun vehicles(): Flow<Resource<List<Vehicle>>> = vehicles.vehicles()

        override fun exportColumns(type: String?): Flow<Resource<ExportColumnsResponse>> = exports.exportColumns(type)

        override suspend fun createExport(payload: CreateExportPayload): Result<ExportJobSummary> = exports.createExport(payload)

        override suspend fun createAccountExport(payload: CreateAccountExportPayload): Result<ExportJobSummary> =
            exports.createAccountExport(payload)
    }
