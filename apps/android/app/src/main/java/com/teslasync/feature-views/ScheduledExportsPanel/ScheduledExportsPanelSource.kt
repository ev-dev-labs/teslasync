// The data port the ScheduledExportsPanel feature view binds to (P1/S8 state-holder seam) — the native analogue of
// the web component's hook composition
// (web/src/api/hooks/useExports.ts -> web/src/features/system/pages/ScheduledExportsPanel.tsx). The view never
// performs HTTP itself; a shared adapter (the S8 ExportsStore or the S7 ExportsRepository) or a test fake drives
// this. Cache-then-network freshness is preserved end to end (ADR-013): every read emission's cached/stale/error
// flags flow through unchanged so the view-model can render the full state matrix.
//
// The five operations map one-to-one onto the hooks the panel uses: the read is `useScheduledExports`;
// [createScheduledExport]/[updateScheduledExport]/[deleteScheduledExport]/[runScheduledExportNow] are
// `useCreateScheduledExport` / `useUpdateScheduledExport` / `useDeleteScheduledExport` / `useRunScheduledExportNow`,
// each of which invalidates the `['scheduled-exports']` query key on success — reproduced here by the view-model's
// post-mutation refresh.
//
// `InvalidPackageDeclaration`/`filename`/`MatchingDeclarationName` are suppressed: the mandated surface directory
// (com/teslasync/feature-views/ScheduledExportsPanel) cannot form a valid Kotlin package and the file hosts the
// seam plus its bindings, mirroring the sibling surfaces.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.scheduledexportspanel

import io.teslasync.shared.core.data.repo.ExportsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.exports.ExportsStore
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import io.teslasync.shared.core.presentation.exports.ScheduledExportInput
import kotlinx.coroutines.flow.Flow

/**
 * The single seam the [ScheduledExportsPanelViewModel] depends on so it binds to an abstraction (real adapter ↔
 * test fake), never to a concrete store or the network. [scheduledExports] is the cache-then-network feed the web
 * `useScheduledExports` serves; [invalidate] is the re-fetch trigger; the four mutations mirror the web
 * `useCreateScheduledExport` / `useUpdateScheduledExport` / `useDeleteScheduledExport` / `useRunScheduledExportNow`
 * non-throwing results. No HTTP touches the view.
 */
interface ScheduledExportsPanelSource {
    /** Stream the cache-then-network schedules list (web `useScheduledExports`, `safeArray`-guarded). */
    fun scheduledExports(): Flow<Resource<List<ScheduledExport>>>

    /** Re-fetch the schedules feed; a no-op for a binding whose read re-collection already re-fetches. */
    fun invalidate()

    /** Create a schedule (web `useCreateScheduledExport`); refreshes the schedules feed on success. */
    suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport>

    /** Update a schedule (web `useUpdateScheduledExport`); refreshes the schedules feed on success. */
    suspend fun updateScheduledExport(
        id: Long,
        input: ScheduledExportInput,
    ): Result<ScheduledExport>

    /** Delete a schedule (web `useDeleteScheduledExport`); refreshes the schedules feed on success. */
    suspend fun deleteScheduledExport(id: Long): Result<Unit>

    /** Trigger a manual "Run now" (web `useRunScheduledExportNow`); refreshes the schedules feed on success. */
    suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport>
}

/**
 * Binds the surface to the shared **S8** [ExportsStore] (web `useExports.ts`). The store owns the shared
 * `['scheduled-exports']` feed and the four mutations, each of which already refreshes that prefix on success — so
 * the view-model's post-mutation refresh re-collects an already-up-to-date shared feed. [invalidate] is a no-op:
 * the store exposes no standalone scheduled-feed invalidate (only its mutations refresh the prefix), so manual
 * retry replays the shared state rather than forcing a cold re-fetch. Use the S7 binding below when a host needs
 * retry to force a genuine re-fetch. No HTTP touches the view — the store (S7/S8) owns it.
 */
fun scheduledExportsPanelSource(store: ExportsStore): ScheduledExportsPanelSource =
    object : ScheduledExportsPanelSource {
        override fun scheduledExports(): Flow<Resource<List<ScheduledExport>>> = store.scheduledExports()

        override fun invalidate() = Unit

        override suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport> =
            store.createScheduledExport(input)

        override suspend fun updateScheduledExport(
            id: Long,
            input: ScheduledExportInput,
        ): Result<ScheduledExport> = store.updateScheduledExport(id, input)

        override suspend fun deleteScheduledExport(id: Long): Result<Unit> = store.deleteScheduledExport(id)

        override suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport> = store.runScheduledExportNow(id)
    }

/**
 * Binds the surface directly to the shared **S7** [ExportsRepository]. Each [scheduledExports] call starts a NEW
 * cache-then-network collection, so the view-model's refresh/retry trigger a genuine re-fetch (the web `refetch()`
 * behaviour) and [invalidate] is a no-op. The repository mutations do not touch the durable cache (ADR-013), so
 * the view-model re-collects the read after each mutation to reflect the write — the binding to use when a host
 * does not share app-wide stores.
 */
fun scheduledExportsPanelSource(repository: ExportsRepository): ScheduledExportsPanelSource =
    object : ScheduledExportsPanelSource {
        override fun scheduledExports(): Flow<Resource<List<ScheduledExport>>> = repository.scheduledExports()

        override fun invalidate() = Unit

        override suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport> =
            repository.createScheduledExport(input)

        override suspend fun updateScheduledExport(
            id: Long,
            input: ScheduledExportInput,
        ): Result<ScheduledExport> = repository.updateScheduledExport(id, input)

        override suspend fun deleteScheduledExport(id: Long): Result<Unit> = repository.deleteScheduledExport(id)

        override suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport> = repository.runScheduledExportNow(id)
    }
