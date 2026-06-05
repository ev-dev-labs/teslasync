package io.teslasync.shared.core.presentation.exports

import io.teslasync.shared.core.data.repo.EXPORTS_PREFIX
import io.teslasync.shared.core.data.repo.EXPORT_JOBS_PREFIX
import io.teslasync.shared.core.data.repo.ExportsRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.SCHEDULED_PREFIX
import io.teslasync.shared.core.data.repo.exportColumnsKey
import io.teslasync.shared.core.data.repo.exportDetailKey
import io.teslasync.shared.core.data.repo.exportJobKey
import io.teslasync.shared.core.data.repo.exportJobsKey
import io.teslasync.shared.core.data.repo.exportsAllKey
import io.teslasync.shared.core.data.repo.scheduledExportsKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the Exports control plane — the cross-platform port of the web
 * `useExports` hook domain (web/src/api/hooks/useExports.ts). Every native Exports screen
 * (Android/Apple via KMP, Windows via the C# port) binds to this single holder rather than
 * re-implementing endpoints, query keys, the `enabled` gates, or the invalidation prefixes.
 *
 * The six reads are exposed as hot [StateFlow]s of a cache-then-network [Resource] (ADR-013):
 * each is lazily created on first access, shared so every observer of the same `(feed, params)`
 * folds into one upstream collection, and refreshable. The seven mutations are non-throwing
 * suspend [Result]s; on success each refreshes EXACTLY the feeds the matching web hook
 * invalidates via `invalidateQueries`:
 *  - createExport / createAccountExport / bulkExportsDelete → the `['export-jobs']` prefix
 *    (list + every single-job feed) AND the `['exports']` prefix (legacy list + every detail feed);
 *  - createScheduledExport / updateScheduledExport / deleteScheduledExport /
 *    runScheduledExportNow → the `['scheduled-exports']` prefix.
 *
 * TanStack `invalidateQueries({ queryKey })` matches by prefix (non-exact), so invalidating
 * `['exports']` also catches `['exports', id]` and `['export-jobs']` also catches
 * `['export-jobs', id]`. [refreshPrefix] reproduces that: it bumps the exact-base feed plus every
 * feed keyed `"$base:…"`, and never a sibling prefix (the `:` delimiter keeps `exports` from
 * matching `export-jobs`/`export-columns`).
 *
 * The web `useExportJob(id)` / `useExport(id)` are `enabled: !!id` and `useExportColumns(type)` is
 * `enabled: !!type`. The holder reproduces those gates: a null/blank id or type returns a stable
 * non-fetching feed that stays at the initial Loading slot (the analogue of a TanStack query with
 * `enabled: false`), so a wizard/drawer can bind before a selection exists. Values stay SI/raw;
 * conversion is display-only (S5).
 *
 * Refreshing re-collects the cache-then-network feed, which always re-fetches while replaying the
 * last cached rows first (the web behaviour of keeping prior data during a refetch). The holder
 * makes no network calls itself — it delegates entirely to the injected [ExportsRepository] (S7).
 * A feed nobody is observing is a no-op to refresh.
 *
 * Optimistic UI, polling cadence (the web `refetchInterval`), and toasts are render-layer
 * concerns and are intentionally NOT reproduced here. This holder mirrors the web hook's
 * single-threaded usage and is not internally synchronised; create and drive it from one
 * confinement (the platform main scope).
 *
 * @property repo the S7 data port every feed and mutation is routed through.
 * @property scope the coroutine scope the shared feeds run in; cancelling it stops them.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class ExportsStore(
    private val repo: ExportsRepository,
    private val scope: CoroutineScope,
) {
    private val triggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val exportsFeeds = mutableMapOf<String, StateFlow<Resource<List<ExportJob>>>>()
    private val jobsFeeds = mutableMapOf<String, StateFlow<Resource<List<ExportJobSummary>>>>()
    private val jobFeeds = mutableMapOf<String, StateFlow<Resource<ExportJobSummary>>>()
    private val detailFeeds = mutableMapOf<String, StateFlow<Resource<ExportJob>>>()
    private val columnsFeeds = mutableMapOf<String, StateFlow<Resource<ExportColumnsResponse>>>()
    private val scheduledFeeds = mutableMapOf<String, StateFlow<Resource<List<ScheduledExport>>>>()

    private val disabledJob: StateFlow<Resource<ExportJobSummary>> = MutableStateFlow(initial())
    private val disabledDetail: StateFlow<Resource<ExportJob>> = MutableStateFlow(initial())
    private val disabledColumns: StateFlow<Resource<ExportColumnsResponse>> = MutableStateFlow(initial())

    // ---- Reads --------------------------------------------------------------------

    /** Shared, refreshable legacy `GET /export/jobs` feed (web `useExports`). */
    public fun exports(): StateFlow<Resource<List<ExportJob>>> = feed(exportsAllKey(), exportsFeeds) { repo.exports() }

    /** Shared, refreshable `GET /export/jobs` job-summary feed (web `useExportJobs`). */
    public fun exportJobs(): StateFlow<Resource<List<ExportJobSummary>>> = feed(exportJobsKey(), jobsFeeds) { repo.exportJobs() }

    /**
     * Shared, refreshable `GET /export/jobs/{id}` feed (web `useExportJob`). A null/blank [id]
     * returns a stable non-fetching feed (the web `enabled: !!id` gate).
     */
    public fun exportJob(id: String?): StateFlow<Resource<ExportJobSummary>> {
        if (id.isNullOrEmpty()) return disabledJob
        return feed(exportJobKey(id), jobFeeds) { repo.exportJob(id) }
    }

    /**
     * Shared, refreshable `GET /exports/{id}` feed (web `useExport`). A null/blank [id] returns a
     * stable non-fetching feed (the web `enabled: !!id` gate).
     */
    public fun export(id: String?): StateFlow<Resource<ExportJob>> {
        if (id.isNullOrEmpty()) return disabledDetail
        return feed(exportDetailKey(id), detailFeeds) { repo.export(id) }
    }

    /**
     * Shared, refreshable `GET /exports/columns?type=` feed (web `useExportColumns`). A null/blank
     * [type] returns a stable non-fetching feed (the web `enabled: !!type` gate).
     */
    public fun exportColumns(type: String?): StateFlow<Resource<ExportColumnsResponse>> {
        if (type.isNullOrEmpty()) return disabledColumns
        return feed(exportColumnsKey(type), columnsFeeds) { repo.exportColumns(type) }
    }

    /** Shared, refreshable `GET /scheduled-exports` feed (web `useScheduledExports`). */
    public fun scheduledExports(): StateFlow<Resource<List<ScheduledExport>>> =
        feed(scheduledExportsKey(), scheduledFeeds) { repo.scheduledExports() }

    // ---- Mutations ----------------------------------------------------------------

    /** Submits an export, then refreshes the job + legacy-export prefixes (web `useCreateExport`). */
    public suspend fun createExport(payload: CreateExportPayload): Result<ExportJobSummary> =
        repo.createExport(payload).onSuccess { refreshJobLists() }

    /** Queues an account export, then refreshes the job + legacy-export prefixes (web `useCreateAccountExport`). */
    public suspend fun createAccountExport(payload: CreateAccountExportPayload = CreateAccountExportPayload()): Result<ExportJobSummary> =
        repo.createAccountExport(payload).onSuccess { refreshJobLists() }

    /** Deletes a batch of jobs, then refreshes the job + legacy-export prefixes (web `useBulkExportsDelete`). */
    public suspend fun bulkExportsDelete(ids: List<String>): Result<ExportBulkResult> =
        repo.bulkExportsDelete(ids).onSuccess { refreshJobLists() }

    /** Creates a schedule, then refreshes the schedules prefix (web `useCreateScheduledExport`). */
    public suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport> =
        repo.createScheduledExport(input).onSuccess { refreshPrefix(SCHEDULED_PREFIX) }

    /** Updates a schedule, then refreshes the schedules prefix (web `useUpdateScheduledExport`). */
    public suspend fun updateScheduledExport(
        id: Long,
        input: ScheduledExportInput,
    ): Result<ScheduledExport> = repo.updateScheduledExport(id, input).onSuccess { refreshPrefix(SCHEDULED_PREFIX) }

    /** Deletes a schedule, then refreshes the schedules prefix (web `useDeleteScheduledExport`). */
    public suspend fun deleteScheduledExport(id: Long): Result<Unit> =
        repo.deleteScheduledExport(id).onSuccess { refreshPrefix(SCHEDULED_PREFIX) }

    /** Triggers "Run now", then refreshes the schedules prefix (web `useRunScheduledExportNow`). */
    public suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport> =
        repo.runScheduledExportNow(id).onSuccess { refreshPrefix(SCHEDULED_PREFIX) }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Returns the shared [StateFlow] for [key], creating it on first access. The feed is a
     * `trigger ▸ flatMapLatest(source) ▸ stateIn` pipeline: bumping the trigger restarts the
     * underlying cache-then-network collection ([refreshPrefix]), and
     * [SharingStarted.WhileSubscribed] keeps a single upstream shared across observers while at
     * least one is active.
     */
    private fun <T> feed(
        key: String,
        feeds: MutableMap<String, StateFlow<Resource<T>>>,
        source: () -> Flow<Resource<T>>,
    ): StateFlow<Resource<T>> =
        feeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { source() }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = initial(),
                )
        }

    /**
     * Re-fetches the `['export-jobs']` and `['exports']` prefixes — the web create/account/bulk
     * hooks invalidate both `exportKeys.jobs` and `exportKeys.all`.
     */
    private fun refreshJobLists() {
        refreshPrefix(EXPORT_JOBS_PREFIX)
        refreshPrefix(EXPORTS_PREFIX)
    }

    /**
     * Re-fetches every observed feed whose key is [base] or starts with `"$base:"` — the
     * prefix-match analogue of TanStack's `invalidateQueries({ queryKey: [base, …] })`. Keys are
     * snapshotted before iterating so a concurrent feed creation cannot disturb the walk.
     */
    private fun refreshPrefix(base: String) {
        val childPrefix = "$base:"
        triggers.keys
            .filter { it == base || it.startsWith(childPrefix) }
            .toList()
            .forEach { triggers[it]?.update { n -> n + 1 } }
    }

    private fun trigger(key: String): MutableStateFlow<Int> = triggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L

        fun <T> initial(): Resource<T> = Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
