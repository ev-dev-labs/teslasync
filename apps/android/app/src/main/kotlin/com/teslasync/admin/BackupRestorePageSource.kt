// The data seam the BackupRestorePage admin surface binds to, plus its production binding over the shared
// resilient HTTP client (P1/S2-S3). The view (composable) performs NO HTTP (ADR-002) — it only collects state
// from the view-model, which drives this seam, reproducing the web page's TanStack-Query reads
// (`useQuery('/backup/configs')`, `useQuery('/backup/runs')`) plus its seven mutations (create / update / delete
// config, trigger, quick backup, verify, restore preview).
//
// The two reads are cold cache-then-network `Resource` flows so the view-model's refresh trigger re-subscribing
// performs the web `queryClient.invalidateQueries` refetch — the same contract the shared `AdminStore` wraps for
// these exact endpoints (`backupConfigs()` / `backupRuns()`), but driven by an explicit refresh trigger here so
// the page's "Refresh" affordance + post-mutation invalidation re-fetch on demand (the shared store exposes no
// public refresh for these keys). Mutations route through the shared `ApiHttpClient` so every network call stays
// in the data layer, never the view. A narrow seam so the view-model depends on an abstraction (real adapter ↔
// in-memory fake), never on the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located client-binding helper + in-memory fake.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.backuprestore

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/** An empty JSON array sentinel used by the in-memory fake's default (empty) feeds. */
private val EMPTY_JSON_ARRAY: JsonElement = JsonArray(emptyList())

/**
 * The single seam the [BackupRestorePageViewModel] depends on so it binds to an abstraction (the resilient
 * shared client in production, an in-memory fake in tests/previews), never to the network directly. The two
 * reads are cache-then-network `Resource` flows (the web read hooks); the mutations are non-throwing [Result]s
 * (the web `useMutation`s). No HTTP touches the view.
 */
interface BackupRestorePageSource {
    /** The raw-JSON `GET /backup/configs` feed (web `useQuery(['backup-configs'])`). */
    fun configs(): Flow<Resource<JsonElement>>

    /** The raw-JSON `GET /backup/runs` feed (web `useQuery(['backup-runs'])`). */
    fun runs(): Flow<Resource<JsonElement>>

    /** Create a config (web `POST /backup/configs`); a non-throwing [Result]. */
    suspend fun createConfig(body: JsonObject): Result<Unit>

    /** Update a config (web `PUT /backup/configs/{id}`); a non-throwing [Result]. */
    suspend fun updateConfig(
        id: Long,
        body: JsonObject,
    ): Result<Unit>

    /** Delete a config (web `DELETE /backup/configs/{id}`); a non-throwing [Result]. */
    suspend fun deleteConfig(id: Long): Result<Unit>

    /** Trigger a config's backup now (web `POST /backup/configs/{id}/trigger`); a non-throwing [Result]. */
    suspend fun triggerConfig(id: Long): Result<Unit>

    /** Run a quick backup now (web `POST /backup/quick`); a non-throwing [Result]. */
    suspend fun runQuickBackup(): Result<Unit>

    /** Verify a run's checksum (web `POST /backup/runs/{id}/verify` ▸ `{ verified }`); a non-throwing [Result]. */
    suspend fun verifyRun(id: Long): Result<Boolean>

    /** Load a run's restore preview (web `GET /backup/runs/{id}/preview`); a non-throwing [Result]. */
    suspend fun previewRun(id: Long): Result<RestorePreview>
}

private const val PATH_CONFIGS = "/backup/configs"
private const val PATH_RUNS = "/backup/runs"
private const val FIELD_VERIFIED = "verified"

/**
 * Binds the surface to the shared resilient [ApiHttpClient] (P1/S2-S3) — the same client every native repository
 * builds on, so the backup endpoints inherit its `/api/v1` prefixing, retry/backoff, circuit-breaker, and 401
 * refresh-and-replay. The reads are cold `Resource` flows (Loading ▸ Success/Error); each (re)collection is a
 * fresh fetch, so the view-model's refresh trigger drives the web refetch. The mutations are non-throwing
 * fire-and-(typed-)forget calls. No HTTP touches the view.
 */
fun ApiHttpClient.asBackupRestorePageSource(): BackupRestorePageSource {
    val api = this
    return object : BackupRestorePageSource {
        override fun configs(): Flow<Resource<JsonElement>> = api.jsonFeed(PATH_CONFIGS)

        override fun runs(): Flow<Resource<JsonElement>> = api.jsonFeed(PATH_RUNS)

        override suspend fun createConfig(body: JsonObject): Result<Unit> =
            api.safeRequest<String>(method = HttpMethodKind.POST, path = PATH_CONFIGS, body = body).map { }

        override suspend fun updateConfig(
            id: Long,
            body: JsonObject,
        ): Result<Unit> = api.safeRequest<String>(method = HttpMethodKind.PUT, path = "$PATH_CONFIGS/$id", body = body).map { }

        override suspend fun deleteConfig(id: Long): Result<Unit> =
            api.safeRequest<String>(method = HttpMethodKind.DELETE, path = "$PATH_CONFIGS/$id").map { }

        override suspend fun triggerConfig(id: Long): Result<Unit> =
            api.safeRequest<String>(method = HttpMethodKind.POST, path = "$PATH_CONFIGS/$id/trigger").map { }

        override suspend fun runQuickBackup(): Result<Unit> =
            api.safeRequest<String>(method = HttpMethodKind.POST, path = "/backup/quick").map { }

        override suspend fun verifyRun(id: Long): Result<Boolean> =
            api.safeRequest<JsonElement>(method = HttpMethodKind.POST, path = "$PATH_RUNS/$id/verify").map { it.extractVerified() }

        override suspend fun previewRun(id: Long): Result<RestorePreview> =
            api.safeRequest<JsonElement>(path = "$PATH_RUNS/$id/preview").map { it.asRestorePreview() }
    }
}

/** Emits `Loading` then a `Success`/`Error` from one GET — the cold cache-then-network read the view-model drives. */
private fun ApiHttpClient.jsonFeed(path: String): Flow<Resource<JsonElement>> =
    flow {
        emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
        safeRequest<JsonElement>(path = path).fold(
            onSuccess = { emit(Resource.Success(data = it, fetchedAt = System.currentTimeMillis(), stale = false)) },
            onFailure = { emit(Resource.Error(cached = null, fetchedAt = null, stale = false, error = it)) },
        )
    }

/** Reads the `verified` boolean from the verify response, defaulting to `false` (web `data.verified`). */
private fun JsonElement.extractVerified(): Boolean =
    ((this as? JsonObject)?.get(FIELD_VERIFIED) as? JsonPrimitive)?.booleanOrNull ?: false

/**
 * An in-memory [BackupRestorePageSource] for previews and tests — it replays the configured read flows and
 * returns the configured outcomes for the mutations. The defaults are healthy success feeds so a preview
 * resolves to content; pass `flowOf(Resource.Loading(...))` / `Resource.Error(...)` to preview the other states.
 */
class InMemoryBackupRestorePageSource(
    private val configsFlow: Flow<Resource<JsonElement>> = flowOf(Resource.Success(EMPTY_JSON_ARRAY, fetchedAt = 0L, stale = false)),
    private val runsFlow: Flow<Resource<JsonElement>> = flowOf(Resource.Success(EMPTY_JSON_ARRAY, fetchedAt = 0L, stale = false)),
    private val mutationOutcome: () -> Result<Unit> = { Result.success(Unit) },
    private val verifyOutcome: () -> Result<Boolean> = { Result.success(true) },
    private val previewOutcome: () -> Result<RestorePreview> = { Result.success(RestorePreview(emptyList(), emptyList(), checksumVerified = true)) },
) : BackupRestorePageSource {
    override fun configs(): Flow<Resource<JsonElement>> = configsFlow

    override fun runs(): Flow<Resource<JsonElement>> = runsFlow

    override suspend fun createConfig(body: JsonObject): Result<Unit> = mutationOutcome()

    override suspend fun updateConfig(
        id: Long,
        body: JsonObject,
    ): Result<Unit> = mutationOutcome()

    override suspend fun deleteConfig(id: Long): Result<Unit> = mutationOutcome()

    override suspend fun triggerConfig(id: Long): Result<Unit> = mutationOutcome()

    override suspend fun runQuickBackup(): Result<Unit> = mutationOutcome()

    override suspend fun verifyRun(id: Long): Result<Boolean> = verifyOutcome()

    override suspend fun previewRun(id: Long): Result<RestorePreview> = previewOutcome()
}
