// The data port the BackupActionsCard feature view binds to (P1/S8 state-holder seam) — the native analogue of
// the three hooks the web component composes: `useMutation(triggerQuickBackup)`, `useQueryClient`, and the
// backup feed its parent passes as `children` (web/src/features/system/components/status/BackupActionsCard.tsx
// + web/src/features/system/pages/SystemStatusPage.tsx + web/src/api/devtools.ts). The view never performs HTTP
// (ADR-002); a concrete adapter over the shared S8 [AdminStore] (or S7 [AdminRepository], or a test fake) drives
// this seam.
//
// [status] folds the parent's `getBackupConfigs` (`GET /backup/configs`) + `getBackupRuns` (`GET /backup/runs`)
// cache-then-network feeds into one [Resource] of the projected [BackupStatus] — the DefList rows the web parent
// computes. [runQuickBackup] is the lone mutation the web component itself owns (`POST /backup/quick`); since the
// shared layer exposes no quick-backup store method, the host injects it (the data-layer analogue of the web's
// `triggerQuickBackup` api function), keeping every network call out of the view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BackupActionsCard) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed: the mandated `BackupActionsCard*`
// filename cannot match the seam's `BackupActionsCardSource` name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.featureviews.backupactionscard

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [BackupActionsCardViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store/repository or the network. [status] is the cache-then-network backup-status
 * feed (web parent's `getBackupConfigs` + `getBackupRuns`); [runQuickBackup] is the lone mutation the web
 * component owns (web `triggerQuickBackup`). No HTTP touches the view.
 */
interface BackupActionsCardSource {
    /** Stream the combined backup status (configured schedules + runs) as a cache-then-network [Resource]. */
    fun status(): Flow<Resource<BackupStatus>>

    /** Run a quick backup now (web `triggerQuickBackup` → `POST /backup/quick`); a non-throwing [Result]. */
    suspend fun runQuickBackup(): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** [AdminStore] — the memoized, multi-observer holder every Admin surface
 * shares app-wide (its `backupConfigs()` / `backupRuns()` feeds fold into the same upstream collection as the
 * rest of the app). The quick-backup mutation has no shared store method, so the host supplies [runQuickBackup]
 * (wired to the shared client); the view stays HTTP-free. Re-collecting the feeds performs a genuine
 * cache-then-network re-fetch, backing the surface's refresh/retry affordance.
 */
fun AdminStore.asBackupActionsCardSource(runQuickBackup: suspend () -> Result<Unit>): BackupActionsCardSource {
    val store = this
    return object : BackupActionsCardSource {
        override fun status(): Flow<Resource<BackupStatus>> = backupStatusFeed(store.backupConfigs(), store.backupRuns())

        override suspend fun runQuickBackup(): Result<Unit> = runQuickBackup.invoke()
    }
}

/**
 * Binds the surface to the shared **S7** [AdminRepository] — the cold cache-then-network feeds the S8
 * [AdminStore] also wraps. Use this when a host wants the card to drive its own collection rather than fold into
 * the shared holders. The quick-backup mutation is host-supplied, exactly as in the S8 adapter.
 */
fun AdminRepository.asBackupActionsCardSource(runQuickBackup: suspend () -> Result<Unit>): BackupActionsCardSource {
    val repo = this
    return object : BackupActionsCardSource {
        override fun status(): Flow<Resource<BackupStatus>> = backupStatusFeed(repo.backupConfigs(), repo.backupRuns())

        override suspend fun runQuickBackup(): Result<Unit> = runQuickBackup.invoke()
    }
}

/**
 * Composes the configs + runs cache-then-network feeds into one [Resource] of the projected [BackupStatus] —
 * the native port of the web parent computing the DefList rows from both queries. Honours the ADR-013 contract:
 * any error wins (carrying the last-known projection so "offline / last known" works), then any in-flight load
 * (with the combined cache), else a fresh [Resource.Success]. The combined freshness stamp is the older of the
 * two so the surface never claims to be fresher than its stalest input.
 */
internal fun backupStatusFeed(
    configs: Flow<Resource<JsonElement>>,
    runs: Flow<Resource<JsonElement>>,
): Flow<Resource<BackupStatus>> = configs.combine(runs) { configRes, runRes -> mergeBackupResources(configRes, runRes) }

/** Merges one configs + one runs [Resource] emission into a single [Resource] of the projected [BackupStatus]. */
internal fun mergeBackupResources(
    configs: Resource<JsonElement>,
    runs: Resource<JsonElement>,
): Resource<BackupStatus> {
    val cachedStatus =
        if (configs.cached != null || runs.cached != null) {
            BackupActionsCardProjection.parse(configs.cached, runs.cached)
        } else {
            null
        }
    val stale = configs.stale || runs.stale
    val fetchedAt = listOfNotNull(configs.fetchedAtOrNull(), runs.fetchedAtOrNull()).minOrNull()
    val error = (configs as? Resource.Error)?.error ?: (runs as? Resource.Error)?.error
    return when {
        error != null ->
            Resource.Error(cached = cachedStatus, fetchedAt = fetchedAt, stale = stale || cachedStatus != null, error = error)

        configs is Resource.Loading || runs is Resource.Loading ->
            Resource.Loading(cached = cachedStatus, fetchedAt = fetchedAt, stale = stale)

        else ->
            Resource.Success(
                data = BackupActionsCardProjection.parse(configs.cached, runs.cached),
                fetchedAt = fetchedAt ?: 0L,
                stale = stale,
            )
    }
}

/** The emission's freshness stamp, regardless of [Resource] variant. */
private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

/**
 * An in-memory [BackupActionsCardSource] for previews and tests — it replays the configured [statusFlow] and
 * returns the configured [outcome] for the mutation, recording the call count. Not thread-safe by design
 * (single-writer, like the web component itself). The defaults are a small healthy status + a successful run so
 * a preview resolves to content.
 *
 * @property statusFlow the backup-status feed the surface collects.
 * @property outcome the result returned for each [runQuickBackup] call.
 */
class InMemoryBackupActionsCardSource(
    private val statusFlow: Flow<Resource<BackupStatus>> = flowOf(Resource.Success(SAMPLE_STATUS, fetchedAt = 0L, stale = false)),
    private val outcome: () -> Result<Unit> = { Result.success(Unit) },
) : BackupActionsCardSource {
    private var recordedRunCalls = 0

    /** The number of [runQuickBackup] calls received (test assertion seam). */
    val runCalls: Int get() = recordedRunCalls

    override fun status(): Flow<Resource<BackupStatus>> = statusFlow

    override suspend fun runQuickBackup(): Result<Unit> {
        recordedRunCalls += 1
        return outcome()
    }

    companion object {
        /** A healthy sample status used by previews and the default fake feed. */
        val SAMPLE_STATUS: BackupStatus =
            BackupStatus(
                configuredSchedules = 2,
                totalRuns = 14,
                lastSuccessfulAtMillis = SAMPLE_LAST_SUCCESS_MILLIS,
                lastSuccessfulSizeBytes = SAMPLE_LAST_SIZE_BYTES,
                recentFailures = 1,
            )
    }
}

/** A fixed instant (2024-05-01T08:30:00Z) so previews/tests render a stable "last successful" value. */
private const val SAMPLE_LAST_SUCCESS_MILLIS = 1_714_552_200_000L

/** ~48.5 MB so the preview's "Last successful size" row renders a representative human size. */
private const val SAMPLE_LAST_SIZE_BYTES = 50_855_936L
