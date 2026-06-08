package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.incidents.AppendIncidentUpdateInput
import io.teslasync.shared.core.presentation.incidents.CreateIncidentInput
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentListResponse
import io.teslasync.shared.core.presentation.incidents.ListIncidentsParams
import io.teslasync.shared.core.presentation.incidents.PatchIncidentInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [IncidentRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The two reads share the single [CacheDomain.Incidents] partition under distinct
 * prefixed keys — [incidentListCacheKey] / [incidentDetailCacheKey], mirroring the web `KEY_LIST` /
 * `KEY_DETAIL` query keys — so each list filter and each detail id cache independently while a
 * mutation can drop the whole partition in one call and logout still clears everything.
 *
 * Because the domain has two distinct read shapes ([IncidentListResponse] and [Incident]), the
 * cache layer stores each feed's raw [JsonElement] (the same verbatim-SI strategy as the
 * Guard/Chat/Admin ports) via [CachingRepository] of [JsonElement], and each read decodes that
 * element to its typed model on every emission through [decode]. A typed decode failure on the
 * fresh value surfaces as [Resource.Error] (never a thrown exception that would cancel the flow
 * before the next refresh); a failure decoding a cached value degrades that slot to `null` so a
 * schema-drifted cache can never brick the network reload.
 *
 * The four mutations call the API directly and, on success, evict the ENTIRE partition ([clear]) —
 * the data-layer analogue of the web hooks invalidating `['status-incidents']` (every list AND
 * detail query at once). The S8 store re-fetches the observed feeds on the same success, so a
 * refresh re-fetches rather than replaying a stale entry.
 */
public class HttpIncidentRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    IncidentRepository {
    override val domain: CacheDomain = CacheDomain.Incidents

    // ---- Reads --------------------------------------------------------------------

    override fun incidents(params: ListIncidentsParams): Flow<Resource<IncidentListResponse>> =
        observe(incidentListCacheKey(params)) {
            api.request<JsonElement>(path = INCIDENTS_BASE, query = incidentListQuery(params))
        }.decode(IncidentListResponse.serializer())

    override fun incident(id: Long): Flow<Resource<Incident>> =
        observe(incidentDetailCacheKey(id)) {
            api.request<JsonElement>(path = "$INCIDENTS_BASE/$id")
        }.decode(Incident.serializer())

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun createIncident(input: CreateIncidentInput): Result<Incident> {
        val body =
            buildJsonObject {
                put("title", input.title)
                input.description?.let { put("description", it) }
                input.severity?.let { put("severity", it) }
                input.status?.let { put("status", it) }
                input.affectedComponents?.let { put("affected_components", stringArray(it)) }
                input.initialMessage?.let { put("initial_message", it) }
            }
        return api
            .safeRequest<Incident>(method = HttpMethodKind.POST, path = INCIDENTS_BASE, body = jsonBody(body))
            .onSuccess { clear() }
    }

    override suspend fun patchIncident(input: PatchIncidentInput): Result<Incident> {
        val body =
            buildJsonObject {
                input.title?.let { put("title", it) }
                input.description?.let { put("description", it) }
                input.severity?.let { put("severity", it) }
                input.status?.let { put("status", it) }
                input.affectedComponents?.let { put("affected_components", stringArray(it)) }
                input.resolved?.let { put("resolved", it) }
            }
        return api
            .safeRequest<Incident>(method = HttpMethodKind.PATCH, path = "$INCIDENTS_BASE/${input.id}", body = jsonBody(body))
            .onSuccess { clear() }
    }

    override suspend fun appendIncidentUpdate(input: AppendIncidentUpdateInput): Result<Incident> {
        val body =
            buildJsonObject {
                put("message", input.message)
                input.status?.let { put("status", it) }
            }
        return api
            .safeRequest<Incident>(
                method = HttpMethodKind.POST,
                path = "$INCIDENTS_BASE/${input.id}/updates",
                body = jsonBody(body),
            ).onSuccess { clear() }
    }

    override suspend fun deleteIncident(id: Long): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure.
        api
            .safeRequest<String>(method = HttpMethodKind.DELETE, path = "$INCIDENTS_BASE/$id")
            .map { }
            .onSuccess { clear() }

    // ---- Internals ----------------------------------------------------------------

    /** Maps a raw-JSON cache-then-network feed onto its typed model, guarding every decode. */
    private fun <T> Flow<Resource<JsonElement>>.decode(serializer: KSerializer<T>): Flow<Resource<T>> =
        map { resource -> resource.decodeTo(serializer) }

    private fun <T> Resource<JsonElement>.decodeTo(serializer: KSerializer<T>): Resource<T> =
        when (this) {
            is Resource.Loading -> Resource.Loading(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale)
            is Resource.Error -> Resource.Error(cached?.let { tryDecode(serializer, it) }, fetchedAt, stale, error)
            is Resource.Success ->
                runCatching { json.decodeFromJsonElement(serializer, data) }.fold(
                    onSuccess = { Resource.Success(it, fetchedAt, stale) },
                    // A 2xx body that no longer matches the DTO is a contract error, not a transport
                    // one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private fun stringArray(values: List<String>): JsonArray = JsonArray(values.map { JsonPrimitive(it) })

    private companion object {
        // Web `INCIDENTS_BASE` (web/src/api/hooks/useIncidents.ts) — no trailing slash.
        const val INCIDENTS_BASE = "/status/incidents"
    }
}
