// The data port the APIKeysPage feature view binds to (P1/S8 state-holder seam) — the native analogue of the
// four web hooks the page composes: `useApiKeys` (`GET /api-keys`), `useCreateApiKey` (`POST /api-keys`),
// `useDeleteApiKey` (`DELETE /api-keys/{id}`), and `useRevokeApiKey` (`POST /api-keys/{id}/revoke`)
// (web/src/features/admin/pages/APIKeysPage.tsx + web/src/api/hooks/useAdmin.ts). The view never performs HTTP
// (ADR-002); a concrete adapter over the shared S8 [AdminStore] (or S7 [AdminRepository], or a test fake) drives
// this seam, so a single fake stands in for the whole domain in the S8 state-holder tests.
//
// The read feed projects the raw `/api-keys` JSON into the render-ready [ApiKey] list while preserving the
// cache-then-network freshness flags unchanged (ADR-013), so the view renders the full loading / content /
// empty / error / stale / offline matrix. The create mutation returns the freshly-minted secret (web
// `data.key`); delete + revoke return [Unit]. The shared [AdminStore] additionally refreshes the `api-keys`
// feed after every mutation (mirroring the web hooks' `invalidateQueries`), so the list re-fetches on success.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) cannot match
// the app's `io.teslasync.android.*` package root. `MatchingDeclarationName` is suppressed: the mandated
// `APIKeysPage*` filename cannot match the seam's `ApiKeysSource` name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.admin

import io.teslasync.shared.core.data.repo.AdminRepository
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map

/**
 * The single seam the [ApiKeysPageViewModel] depends on so it binds to an abstraction (real adapter ↔ test
 * fake), never to a concrete store/repository or the network. [apiKeys] is the cache-then-network key-list feed
 * (web `useApiKeys`); the suspend members are the three mutations the page owns. No HTTP touches the view.
 */
interface ApiKeysSource {
    /** Stream the issued API keys as a cache-then-network [Resource] of render-ready rows (web `useApiKeys`). */
    fun apiKeys(): Flow<Resource<List<ApiKey>>>

    /**
     * Mint a key (web `useCreateApiKey` → `POST /api-keys`). On success the [Result] carries the freshly-minted
     * raw secret (web `data.key`), shown exactly once; a missing key in the response is surfaced as a failure so
     * the create form stays open rather than revealing a blank secret.
     */
    suspend fun createApiKey(
        name: String,
        permission: PermissionLevel,
    ): Result<String>

    /** Permanently delete a key (web `useDeleteApiKey` → `DELETE /api-keys/{id}`); a non-throwing [Result]. */
    suspend fun deleteApiKey(id: Long): Result<Unit>

    /** Revoke a key — mark it expired (web `useRevokeApiKey` → `POST /api-keys/{id}/revoke`). */
    suspend fun revokeApiKey(id: Long): Result<Unit>
}

/**
 * Binds the surface to the shared **S8** [AdminStore] — the memoized, multi-observer holder every Admin surface
 * shares app-wide (its `apiKeys()` feed folds into the same upstream collection as the rest of the app). Each
 * mutation routes through the store, which refreshes the `api-keys` feed on success (the web hooks'
 * `invalidateQueries`). Re-collecting the feed performs a genuine cache-then-network re-fetch, backing the
 * surface's refresh/retry affordance. No HTTP touches the view.
 */
fun AdminStore.asApiKeysSource(): ApiKeysSource {
    val store = this
    return object : ApiKeysSource {
        override fun apiKeys(): Flow<Resource<List<ApiKey>>> = store.apiKeys().map { it.mapData(ApiKeysProjection::parseList) }

        override suspend fun createApiKey(
            name: String,
            permission: PermissionLevel,
        ): Result<String> = store.createApiKey(name, permission.wire).mapToCreatedKey()

        override suspend fun deleteApiKey(id: Long): Result<Unit> = store.deleteApiKey(id.toString())

        override suspend fun revokeApiKey(id: Long): Result<Unit> = store.revokeApiKey(id.toString())
    }
}

/**
 * Binds the surface to the shared **S7** [AdminRepository] — the cold cache-then-network feed the S8
 * [AdminStore] also wraps. Use this when a host wants the surface to drive its own collection rather than fold
 * into the shared holder. The repository evicts the affected cache keys after each mutation, exactly as in the
 * S8 adapter.
 */
fun AdminRepository.asApiKeysSource(): ApiKeysSource {
    val repo = this
    return object : ApiKeysSource {
        override fun apiKeys(): Flow<Resource<List<ApiKey>>> = repo.apiKeys().map { it.mapData(ApiKeysProjection::parseList) }

        override suspend fun createApiKey(
            name: String,
            permission: PermissionLevel,
        ): Result<String> = repo.createApiKey(name, permission.wire).mapToCreatedKey()

        override suspend fun deleteApiKey(id: Long): Result<Unit> = repo.deleteApiKey(id.toString())

        override suspend fun revokeApiKey(id: Long): Result<Unit> = repo.revokeApiKey(id.toString())
    }
}

/** Extracts the minted secret from a create response, failing when the key is absent (web `data.key`). */
private fun Result<kotlinx.serialization.json.JsonElement>.mapToCreatedKey(): Result<String> =
    mapCatching { payload ->
        ApiKeysProjection.parseCreatedKey(payload) ?: error("create response carried no key")
    }

/**
 * Apply [transform] to the value carried by a [Resource], preserving the freshness flags
 * (cached / refreshing / stale / offline + error) exactly. A non-present cached value stays absent so a
 * first-load Loading slot is never fabricated into empty content.
 */
private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * An in-memory [ApiKeysSource] for previews and tests — it replays the configured [feed] and returns the
 * configured outcomes for the mutations, recording the calls. Not thread-safe by design (single-writer, like
 * the web component itself). The defaults are a small healthy key list + successful mutations so a preview
 * resolves to content.
 *
 * @property feed the key-list feed the surface collects.
 * @property createOutcome the result returned for each [createApiKey] call (the minted secret on success).
 * @property mutationOutcome the result returned for each delete/revoke call.
 */
class InMemoryApiKeysSource(
    private val feed: Flow<Resource<List<ApiKey>>> = flowOf(Resource.Success(SAMPLE_KEYS, fetchedAt = 0L, stale = false)),
    private val createOutcome: () -> Result<String> = { Result.success(SAMPLE_NEW_KEY) },
    private val mutationOutcome: () -> Result<Unit> = { Result.success(Unit) },
) : ApiKeysSource {
    private val recordedCreate = mutableListOf<Pair<String, PermissionLevel>>()
    private val recordedDeletes = mutableListOf<Long>()
    private val recordedRevokes = mutableListOf<Long>()

    /** The (name, permission) pairs passed to [createApiKey] (test assertion seam). */
    val createCalls: List<Pair<String, PermissionLevel>> get() = recordedCreate

    /** The ids passed to [deleteApiKey] (test assertion seam). */
    val deleteCalls: List<Long> get() = recordedDeletes

    /** The ids passed to [revokeApiKey] (test assertion seam). */
    val revokeCalls: List<Long> get() = recordedRevokes

    override fun apiKeys(): Flow<Resource<List<ApiKey>>> = feed

    override suspend fun createApiKey(
        name: String,
        permission: PermissionLevel,
    ): Result<String> {
        recordedCreate += name to permission
        return createOutcome()
    }

    override suspend fun deleteApiKey(id: Long): Result<Unit> {
        recordedDeletes += id
        return mutationOutcome()
    }

    override suspend fun revokeApiKey(id: Long): Result<Unit> {
        recordedRevokes += id
        return mutationOutcome()
    }

    companion object {
        /** A representative minted secret used by previews and the default fake create outcome. */
        const val SAMPLE_NEW_KEY: String = "ts_2f9a1c7be4d05a6178c3092e4b1f8a6d2c5e7901b3a4f6d8e0c2a4b6d8f0a1c3"

        /** A healthy sample key list used by previews and the default fake feed. */
        val SAMPLE_KEYS: List<ApiKey> =
            listOf(
                ApiKey(
                    id = 1L,
                    name = "Grafana dashboard",
                    permission = PermissionLevel.Read,
                    keyPrefix = "ts_a1b2c3d4...",
                    createdAtMillis = 1_714_552_200_000L,
                    lastUsedAtMillis = 1_717_230_600_000L,
                    expiresAtMillis = null,
                ),
                ApiKey(
                    id = 2L,
                    name = "Home Assistant",
                    permission = PermissionLevel.ReadWrite,
                    keyPrefix = "ts_9f8e7d6c...",
                    createdAtMillis = 1_709_281_800_000L,
                    lastUsedAtMillis = null,
                    expiresAtMillis = null,
                ),
                ApiKey(
                    id = 3L,
                    name = "Legacy exporter",
                    permission = PermissionLevel.Admin,
                    keyPrefix = "ts_0a1b2c3d...",
                    createdAtMillis = 1_701_419_400_000L,
                    lastUsedAtMillis = 1_704_097_800_000L,
                    expiresAtMillis = 1_704_097_800_000L,
                ),
            )
    }
}
