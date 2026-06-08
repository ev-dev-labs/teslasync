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
import io.teslasync.shared.core.presentation.impersonation.ImpersonationCandidatesResponse
import io.teslasync.shared.core.presentation.impersonation.ImpersonationDerivations
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStartRequest
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.coroutines.cancellation.CancellationException

/**
 * HTTP-backed [ImpersonationRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The two reads share the single [CacheDomain.Impersonation] partition under distinct
 * keys ([STATUS_KEY] / [CANDIDATES_KEY]) so each caches independently while a start/end mutation can
 * wipe everything in one call.
 *
 * Because the domain has two distinct read shapes, the cache layer stores each feed's raw
 * [JsonElement] (the same verbatim strategy as the Exports/Admin ports) via [CachingRepository] of
 * [JsonElement]; each read decodes that element to its typed union on every emission through the
 * total [ImpersonationDerivations] parsers (never throwing, so a malformed slot degrades to the safe
 * value rather than cancelling the flow). The open-mode `501 AUTH_MODE_OPEN` is caught INSIDE the
 * fetch and mapped to an open sentinel element, so it is written through as a successful no-op — the
 * exact behaviour of the web `queryFn`s normalising the 501 into `{ mode: 'open' }`.
 *
 * The two mutations call the API directly and return a non-throwing [Result]. On success each
 * invalidates the WHOLE cache ([CacheStore.clearAll]) — a start/end changes the answering principal,
 * so every other cached query now belongs to the wrong subject, exactly as the web hooks call the
 * argument-less `queryClient.invalidateQueries()`. Immediately afterwards the [STATUS_KEY] partition
 * is primed with the new state (the web `setQueryData(impersonationKeys.status, …)`) so the next
 * status read serves the new value from cache without an intermediate flash.
 *
 * The endpoints are the version-namespaced `/admin/impersonate*` paths; the resilient client adds
 * the `/api/v1` prefix exactly once, matching the web `request('/admin/impersonate')` calls verbatim.
 */
public class HttpImpersonationRepository(
    private val api: ApiHttpClient,
    private val store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    ImpersonationRepository {
    override val domain: CacheDomain = CacheDomain.Impersonation

    // ---- Reads --------------------------------------------------------------------

    override fun impersonationStatus(): Flow<Resource<ImpersonationStatus>> =
        observe(STATUS_KEY) { openSentinelOnAuthModeOpen { api.request<JsonElement>(path = STATUS_PATH) } }
            .map { resource -> resource.mapData(ImpersonationDerivations::status) }

    override fun impersonationCandidates(): Flow<Resource<ImpersonationCandidatesResponse>> =
        observe(CANDIDATES_KEY) { openSentinelOnAuthModeOpen { api.request<JsonElement>(path = CANDIDATES_PATH) } }
            .map { resource -> resource.mapData(ImpersonationDerivations::candidates) }

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun startImpersonation(request: ImpersonationStartRequest): Result<ImpersonationStatus> {
        val raw =
            api.safeRequest<JsonElement>(
                method = HttpMethodKind.POST,
                path = STATUS_PATH,
                body = startBody(request),
            )
        raw.getOrNull()?.let { element ->
            // Principal changed: drop every cached query, then prime the new active state so the
            // banner flips without an intermediate inactive flash (web setQueryData + invalidate-all).
            invalidateAllAndPrimeStatus(element)
        }
        return raw.map(ImpersonationDerivations::status)
    }

    override suspend fun endImpersonation(): Result<Unit> {
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure.
        val raw = api.safeRequest<String>(method = HttpMethodKind.POST, path = END_PATH)
        if (raw.isSuccess) {
            invalidateAllAndPrimeStatus(INACTIVE_SENTINEL)
        }
        return raw.map { }
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Drops every cached query ([CacheStore.clearAll]) — the data-layer analogue of the web
     * mutations' argument-less `invalidateQueries()` — and primes the [STATUS_KEY] partition with
     * [statusElement] (web `setQueryData`) so the banner flips without an intermediate flash.
     *
     * The cache work is best-effort: the server mutation has already succeeded, so a cache failure
     * must NOT turn the non-throwing mutation [Result] into a thrown exception. A coroutine
     * cancellation still propagates. Any stale cross-principal cache left behind is corrected on the
     * next read, because the cache-then-network operator always re-fetches from the network.
     */
    private suspend fun invalidateAllAndPrimeStatus(statusElement: JsonElement) {
        try {
            store.clearAll()
            put(STATUS_KEY, statusElement)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            // Best-effort invalidation; the holder's refresh re-fetches from the network regardless.
        }
    }

    /**
     * Runs [fetch], mapping an open-mode `501 AUTH_MODE_OPEN` to the [OPEN_SENTINEL] element so the
     * cache-then-network operator treats it as a successful no-op (web's 501 → `{ mode: 'open' }`).
     * Every other [ApiError] propagates so it surfaces as [Resource.Error].
     */
    private inline fun openSentinelOnAuthModeOpen(fetch: () -> JsonElement): JsonElement =
        try {
            fetch()
        } catch (e: ApiError.Http) {
            if (e.code == ImpersonationDerivations.AUTH_MODE_OPEN_CODE) OPEN_SENTINEL else throw e
        }

    /** Transforms a [Resource]'s payload (cached + data) through [transform], preserving its state. */
    private fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
            is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
        }

    /**
     * Serializes the start body to its exact `{"subject":"…"}` bytes — byte-for-byte parity with the
     * web `JSON.stringify(body)`.
     */
    private fun startBody(request: ImpersonationStartRequest): TextContent =
        TextContent(
            json.encodeToString(ImpersonationStartRequest.serializer(), request),
            ContentType.Application.Json,
        )

    private companion object {
        const val STATUS_KEY = "status"
        const val CANDIDATES_KEY = "candidates"
        const val STATUS_PATH = "/admin/impersonate"
        const val CANDIDATES_PATH = "/admin/impersonate/candidates"
        const val END_PATH = "/admin/impersonate/end"

        /** The `{ mode: 'open' }` value the web hooks synthesise from a 501 AUTH_MODE_OPEN. */
        val OPEN_SENTINEL: JsonElement = buildJsonObject { put("mode", ImpersonationStatus.OPEN) }

        /** The `{ mode: 'inactive' }` value primed after a successful end (web setQueryData). */
        val INACTIVE_SENTINEL: JsonElement = buildJsonObject { put("mode", ImpersonationStatus.INACTIVE) }
    }
}
