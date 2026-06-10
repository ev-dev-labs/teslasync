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
import io.teslasync.shared.core.presentation.automations.Automation
import io.teslasync.shared.core.presentation.automations.AutomationBulkOp
import io.teslasync.shared.core.presentation.automations.AutomationBulkResult
import io.teslasync.shared.core.presentation.automations.AutomationFull
import io.teslasync.shared.core.presentation.automations.AutomationFullInput
import io.teslasync.shared.core.presentation.automations.AutomationHistoryListResponse
import io.teslasync.shared.core.presentation.automations.AutomationPreset
import io.teslasync.shared.core.presentation.automations.AutomationPresetsResponse
import io.teslasync.shared.core.presentation.automations.ReEnableAutomationResult
import io.teslasync.shared.core.presentation.automations.ToggleAutomationResult
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
 * HTTP-backed [AutomationsRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). Every read shares the single [CacheDomain.Automations] partition, keyed by a
 * stable per-feed string ([automationListKey] etc.) that mirrors the web TanStack query keys.
 *
 * Because the domain has FIVE distinct read shapes, the cache layer stores each feed's raw
 * [JsonElement] (the same verbatim-SI strategy as the Admin port) via [CachingRepository] of
 * [JsonElement], and each read decodes that element to its typed model on every emission
 * through [decode]. A typed decode failure on the fresh value surfaces as [Resource.Error]
 * (never a thrown exception that would cancel the flow before the next refresh); a failure
 * decoding a cached value degrades that slot to `null` so a schema-drifted cache can never
 * brick the network reload.
 *
 * The seven mutations call the API directly and return a non-throwing [Result]. They do NOT
 * evict the durable cache: the cache-then-network operator always re-fetches when the S8 store
 * bumps the affected feed's trigger (the `invalidateQueries` analogue), so the previous rows
 * stay visible during the reload — exactly the web behaviour of keeping prior data while a
 * refetch is in flight — and no stale value is ever served as fresh. Create/update bodies are
 * serialized through the id-free [AutomationFullInput] hierarchy, so the strict
 * `DisallowUnknownFields` backend can never reject them.
 */
public class HttpAutomationsRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    AutomationsRepository {
    override val domain: CacheDomain = CacheDomain.Automations

    // ---- Reads --------------------------------------------------------------------

    override fun automations(): Flow<Resource<List<Automation>>> =
        observe(automationListKey()) { safeArray(api.request<JsonElement>(path = "/automations")) }
            .decode(ListSerializer(Automation.serializer()))

    override fun automationHistory(limit: Int): Flow<Resource<AutomationHistoryListResponse>> =
        observe(automationHistoryKey(limit)) {
            api.request<JsonElement>(path = "/automations/history", query = automationHistoryQuery(limit))
        }.decode(AutomationHistoryListResponse.serializer())

    override fun automation(id: Long): Flow<Resource<AutomationFull>> =
        observe(automationDetailKey(id)) { api.request<JsonElement>(path = "/automations/$id") }
            .decode(AutomationFull.serializer())

    override fun automationPresets(category: String?): Flow<Resource<AutomationPresetsResponse>> =
        observe(automationPresetsKey(category)) {
            api.request<JsonElement>(path = "/automations/presets", query = automationPresetsQuery(category))
        }.decode(AutomationPresetsResponse.serializer())

    override fun automationPreset(id: String): Flow<Resource<AutomationPreset>> =
        observe(automationPresetKey(id)) { api.request<JsonElement>(path = "/automations/presets/$id") }
            .decode(AutomationPreset.serializer())

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun toggleAutomation(
        id: Long,
        enabled: Boolean,
    ): Result<ToggleAutomationResult> {
        val body = buildJsonObject { put("enabled", enabled) }
        return api.safeRequest<ToggleAutomationResult>(
            method = HttpMethodKind.PATCH,
            path = "/automations/$id/toggle",
            body = jsonBody(body),
        )
    }

    override suspend fun reEnableAutomation(id: Long): Result<ReEnableAutomationResult> =
        api.safeRequest<ReEnableAutomationResult>(method = HttpMethodKind.PATCH, path = "/automations/$id/re-enable")

    override suspend fun deleteAutomation(id: Long): Result<Unit> =
        // The server answers 2xx with an empty/irrelevant body; read it as raw text and discard
        // so an empty payload never triggers a spurious decode failure.
        api.safeRequest<String>(method = HttpMethodKind.DELETE, path = "/automations/$id").map { }

    override suspend fun bulkAutomationsUpdate(
        ids: List<Long>,
        op: AutomationBulkOp,
    ): Result<AutomationBulkResult> {
        val body =
            buildJsonObject {
                put("ids", JsonArray(ids.map { JsonPrimitive(it) }))
                put("op", op.wire)
            }
        return api.safeRequest<AutomationBulkResult>(
            method = HttpMethodKind.POST,
            path = "/automations/bulk",
            body = jsonBody(body),
        )
    }

    override suspend fun testRunAutomation(id: Long): Result<Unit> =
        api.safeRequest<String>(method = HttpMethodKind.POST, path = "/automations/$id/test-run").map { }

    override suspend fun createAutomationFull(input: AutomationFullInput): Result<AutomationFull> =
        api.safeRequest<AutomationFull>(method = HttpMethodKind.POST, path = "/automations", body = inputBody(input))

    override suspend fun updateAutomationFull(
        id: Long,
        input: AutomationFullInput,
    ): Result<AutomationFull> =
        api.safeRequest<AutomationFull>(method = HttpMethodKind.PUT, path = "/automations/$id", body = inputBody(input))

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
     * Serializes the id-free [AutomationFullInput] into the exact create/update body bytes —
     * byte-for-byte parity with the web `JSON.stringify(input)` (nulls dropped via
     * `explicitNulls = false`; the required step arrays always present).
     */
    private fun inputBody(input: AutomationFullInput): TextContent =
        TextContent(json.encodeToString(AutomationFullInput.serializer(), input), ContentType.Application.Json)

    /**
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes
     * reach the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)
}
