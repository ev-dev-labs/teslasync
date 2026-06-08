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
import io.teslasync.shared.core.presentation.exports.CreateAccountExportPayload
import io.teslasync.shared.core.presentation.exports.CreateExportPayload
import io.teslasync.shared.core.presentation.exports.ExportBulkResult
import io.teslasync.shared.core.presentation.exports.ExportColumnsResponse
import io.teslasync.shared.core.presentation.exports.ExportJob
import io.teslasync.shared.core.presentation.exports.ExportJobSummary
import io.teslasync.shared.core.presentation.exports.ScheduledExport
import io.teslasync.shared.core.presentation.exports.ScheduledExportInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [ExportsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every read shares the single [CacheDomain.Exports] partition, keyed by a stable
 * per-feed string ([exportsAllKey] etc.) that mirrors the web TanStack query keys.
 *
 * Because the domain has SIX distinct read shapes, the cache layer stores each feed's raw
 * [JsonElement] (the same verbatim strategy as the Admin/Automations ports) via
 * [CachingRepository] of [JsonElement], and each read decodes that element to its typed model on
 * every emission through [decode]. A typed decode failure on the fresh value surfaces as
 * [Resource.Error] (never a thrown exception that would cancel the flow before the next refresh);
 * a failure decoding a cached value degrades that slot to `null` so a schema-drifted cache can
 * never brick the network reload.
 *
 * The two list reads ([exports], [exportJobs], [scheduledExports]) wrap the raw element in
 * [safeArray] before decoding, reproducing the web `select: safeArray` contract so a non-array
 * payload collapses to an empty list instead of crashing the UI.
 *
 * The seven mutations call the API directly and return a non-throwing [Result]. They do NOT
 * evict the durable cache: the cache-then-network operator always re-fetches when the S8 store
 * bumps the affected feed's trigger (the `invalidateQueries` analogue), so the previous rows stay
 * visible during the reload — exactly the web behaviour of keeping prior data while a refetch is
 * in flight — and no stale value is ever served as fresh. Bodies are serialized through the
 * id-free input types, so the strict `DisallowUnknownFields` backend can never reject them.
 */
public class HttpExportsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    ExportsRepository {
    override val domain: CacheDomain = CacheDomain.Exports

    // ---- Reads --------------------------------------------------------------------

    override fun exports(): Flow<Resource<List<ExportJob>>> =
        observe(exportsAllKey()) { safeArray(api.request<JsonElement>(path = "/export/jobs")) }
            .decode(ListSerializer(ExportJob.serializer()))

    override fun exportJobs(): Flow<Resource<List<ExportJobSummary>>> =
        observe(exportJobsKey()) { safeArray(api.request<JsonElement>(path = "/export/jobs")) }
            .decode(ListSerializer(ExportJobSummary.serializer()))

    override fun exportJob(id: String): Flow<Resource<ExportJobSummary>> =
        observe(exportJobKey(id)) { api.request<JsonElement>(path = "/export/jobs/$id") }
            .decode(ExportJobSummary.serializer())

    override fun export(id: String): Flow<Resource<ExportJob>> =
        observe(exportDetailKey(id)) { api.request<JsonElement>(path = "/exports/$id") }
            .decode(ExportJob.serializer())

    override fun exportColumns(type: String): Flow<Resource<ExportColumnsResponse>> =
        observe(exportColumnsKey(type)) {
            api.request<JsonElement>(path = "/exports/columns", query = exportColumnsQuery(type))
        }.decode(ExportColumnsResponse.serializer())

    override fun scheduledExports(): Flow<Resource<List<ScheduledExport>>> =
        observe(scheduledExportsKey()) { safeArray(api.request<JsonElement>(path = "/scheduled-exports")) }
            .decode(ListSerializer(ScheduledExport.serializer()))

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun createExport(payload: CreateExportPayload): Result<ExportJobSummary> =
        api.safeRequest<ExportJobSummary>(
            method = HttpMethodKind.POST,
            path = "/export/jobs",
            body = bodyOf(CreateExportPayload.serializer(), payload),
        )

    override suspend fun createAccountExport(payload: CreateAccountExportPayload): Result<ExportJobSummary> =
        api.safeRequest<ExportJobSummary>(
            method = HttpMethodKind.POST,
            path = "/export/jobs/account",
            body = bodyOf(CreateAccountExportPayload.serializer(), payload),
        )

    override suspend fun bulkExportsDelete(ids: List<String>): Result<ExportBulkResult> {
        val body =
            buildJsonObject {
                put("ids", JsonArray(ids.map { JsonPrimitive(it) }))
                put("op", "delete")
            }
        return api.safeRequest<ExportBulkResult>(
            method = HttpMethodKind.POST,
            path = "/export/jobs/bulk",
            body = jsonBody(body),
        )
    }

    override suspend fun createScheduledExport(input: ScheduledExportInput): Result<ScheduledExport> =
        api.safeRequest<ScheduledExport>(
            method = HttpMethodKind.POST,
            path = "/scheduled-exports",
            body = bodyOf(ScheduledExportInput.serializer(), input),
        )

    override suspend fun updateScheduledExport(
        id: Long,
        input: ScheduledExportInput,
    ): Result<ScheduledExport> =
        api.safeRequest<ScheduledExport>(
            method = HttpMethodKind.PUT,
            path = "/scheduled-exports/$id",
            body = bodyOf(ScheduledExportInput.serializer(), input),
        )

    override suspend fun deleteScheduledExport(id: Long): Result<Unit> =
        // The server answers 2xx with an empty/irrelevant body; read it as raw text and discard
        // so an empty payload never triggers a spurious decode failure.
        api.safeRequest<String>(method = HttpMethodKind.DELETE, path = "/scheduled-exports/$id").map { }

    override suspend fun runScheduledExportNow(id: Long): Result<ScheduledExport> =
        api.safeRequest<ScheduledExport>(method = HttpMethodKind.POST, path = "/scheduled-exports/$id/run")

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
                    // A 2xx body that no longer matches the DTO is a contract error, not a
                    // transport one — surface it without throwing across the flow boundary.
                    onFailure = { Resource.Error(cached = null, fetchedAt = fetchedAt, stale = false, error = it) },
                )
        }

    /** A schema-drifted cached slot degrades to `null` rather than bricking the refresh. */
    private fun <T> tryDecode(
        serializer: KSerializer<T>,
        element: JsonElement,
    ): T? = runCatching { json.decodeFromJsonElement(serializer, element) }.getOrNull()

    /**
     * Serializes a typed input into the exact create/update body bytes — byte-for-byte parity
     * with the web `JSON.stringify(payload)` (nulls dropped via `explicitNulls = false`).
     */
    private fun <T> bodyOf(
        serializer: KSerializer<T>,
        value: T,
    ): TextContent = TextContent(json.encodeToString(serializer, value), ContentType.Application.Json)

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
