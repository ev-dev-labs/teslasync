package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixDerivations
import io.teslasync.shared.core.presentation.rbacmatrix.RbacMatrixResponse
import io.teslasync.shared.core.presentation.rbacmatrix.RbacUpsertCell
import io.teslasync.shared.core.presentation.rbacmatrix.RbacUpsertRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [RbacRepository] over the resilient [ApiHttpClient] and the offline cache (ADR-013).
 * The single matrix read uses the [CacheDomain.Rbac] partition, whose 30-second default TTL mirrors
 * the web hook's `staleTime: 30_000` (web/src/api/hooks/useRbacMatrix.ts) — long enough that
 * consumer mount/unmount churn does not thrash a refetch, short enough that a concurrent edit by
 * another admin is picked up promptly.
 *
 * Because the read has a discriminated open/session shape, the cache layer stores the raw
 * [JsonElement] (the same verbatim strategy as the Impersonation/Admin ports) via
 * [CachingRepository] of [JsonElement]; the read decodes that element to its typed union on every
 * emission through the total [RbacMatrixDerivations.matrix] parser (never throwing, so a malformed
 * slot degrades to the safe empty session rather than cancelling the flow). The open-mode
 * `501 AUTH_MODE_OPEN` is caught INSIDE the fetch and mapped to the [OPEN_SENTINEL] element, so it is
 * written through as a successful no-op — the exact behaviour of the web `queryFn` normalising the
 * 501 into `{ mode: 'open' }`.
 *
 * The mutation calls the API directly and DOES NOT touch the cache — invalidation is the S8 store's
 * targeted refresh (the web `invalidateQueries(rbacMatrixKeys.matrix())` analogue), and
 * `cacheThenNetwork` always hits the network on refresh so no stale value is ever served as fresh
 * while the last-known matrix stays visible during the reload. The endpoint is the
 * version-namespaced `/admin/rbac/matrix`; the resilient client adds the `/api/v1` prefix exactly
 * once, matching the web `request('/admin/rbac/matrix')` calls verbatim.
 */
public class HttpRbacRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    RbacRepository {
    override val domain: CacheDomain = CacheDomain.Rbac

    // ---- Reads --------------------------------------------------------------------

    override fun matrix(): Flow<Resource<RbacMatrixResponse>> =
        observe(KEY) { openSentinelOnAuthModeOpen { api.request<JsonElement>(path = MATRIX_PATH) } }
            .map { resource -> resource.mapData(RbacMatrixDerivations::matrix) }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun upsertCells(cells: List<RbacUpsertCell>): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure. No cache interaction here —
        // invalidation is the S8 store's targeted refresh (web `invalidateQueries`).
        api
            .safeRequest<String>(method = HttpMethodKind.PUT, path = MATRIX_PATH, body = upsertBody(cells))
            .map { }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Runs [fetch], mapping an open-mode `501 AUTH_MODE_OPEN` to the [OPEN_SENTINEL] element so the
     * cache-then-network operator treats it as a successful no-op (web's 501 → `{ mode: 'open' }`).
     * Every other [ApiError] propagates so it surfaces as [Resource.Error].
     */
    private inline fun openSentinelOnAuthModeOpen(fetch: () -> JsonElement): JsonElement =
        try {
            fetch()
        } catch (e: ApiError.Http) {
            if (e.code == RbacMatrixDerivations.AUTH_MODE_OPEN_CODE) OPEN_SENTINEL else throw e
        }

    /** Transforms a [Resource]'s payload (cached + data) through [transform], preserving its state. */
    private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
            is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
        }

    /**
     * Serializes the upsert batch to its exact `{"cells":[…]}` bytes — byte-for-byte parity with the
     * web `JSON.stringify({ cells })` body, each cell as `{"role_id":…,"permission_id":…,"allowed":…}`.
     */
    private fun upsertBody(cells: List<RbacUpsertCell>): TextContent =
        TextContent(
            json.encodeToString(RbacUpsertRequest.serializer(), RbacUpsertRequest(cells)),
            ContentType.Application.Json,
        )

    private companion object {
        const val KEY = "matrix"
        const val MATRIX_PATH = "/admin/rbac/matrix"

        /** The `{ mode: 'open' }` value the web hook synthesises from a 501 AUTH_MODE_OPEN. */
        val OPEN_SENTINEL: JsonElement = buildJsonObject { put("mode", RbacMatrixResponse.OPEN) }
    }
}
