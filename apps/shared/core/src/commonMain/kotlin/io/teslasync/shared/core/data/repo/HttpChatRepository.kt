package io.teslasync.shared.core.data.repo

import io.ktor.http.ContentType
import io.ktor.http.content.TextContent
import io.ktor.http.encodeURLPathPart
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.CacheStore
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.cache.SystemClock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import io.teslasync.shared.core.presentation.chat.ChatMessage
import io.teslasync.shared.core.presentation.chat.ChatResponse
import io.teslasync.shared.core.presentation.chat.ChatSessionInfo
import io.teslasync.shared.core.presentation.chat.RenameSessionResult
import io.teslasync.shared.core.presentation.chat.SendChatMessageInput
import io.teslasync.shared.core.presentation.chat.applyDeleteToSessions
import io.teslasync.shared.core.presentation.chat.applyRenameToSessions
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * HTTP-backed [ChatRepository] over the resilient [ApiHttpClient] and the offline cache
 * (ADR-013). The two reads share the single [CacheDomain.Chat] partition: the session list under
 * the fixed [CHAT_SESSIONS_KEY] and each session's history under [chatHistoryKey], mirroring the
 * web `chatKeys.sessions()` / `chatKeys.history(sessionId)` query keys.
 *
 * Because the domain has two distinct read shapes, the cache layer stores each feed's raw
 * [JsonElement] (the same verbatim-SI strategy as the Admin/Automations ports) via
 * [CachingRepository] of [JsonElement], and each read decodes that element to its typed model on
 * every emission through [decode]. A typed decode failure on the fresh value surfaces as
 * [Resource.Error] (never a thrown exception that would cancel the flow before the next refresh);
 * a failure decoding a cached value degrades that slot to `null` so a schema-drifted cache can
 * never brick the network reload.
 *
 * The mutations return a non-throwing [Result]. [renameChatSession] / [deleteChatSession]
 * optimistically patch the cached session list on success — the data-layer analogue of the web
 * hooks' `setQueryData` — so the next refresh (the S8 store's `invalidateQueries` analogue) shows
 * the corrected list immediately while the network reload runs; [deleteChatSession] additionally
 * evicts the deleted session's history key (the web `removeQueries(history)` analogue). They do
 * NOT clear the whole partition: the cache-then-network operator always re-fetches on refresh, so
 * the patched rows stay visible during the reload and no stale value is ever served as fresh.
 * [sendChatMessage] calls the API directly with no cache interaction.
 *
 * Session ids reach the path through [io.ktor.http.encodeURLPathPart] so a non-URL-safe id is
 * percent-encoded exactly as the web `encodeURIComponent(sessionId)` does.
 */
public class HttpChatRepository(
    private val api: ApiHttpClient,
    store: CacheStore,
    clock: Clock = SystemClock,
    private val json: Json = cacheJson,
) : CachingRepository<JsonElement>(store, clock, json, JsonElement.serializer()),
    ChatRepository {
    override val domain: CacheDomain = CacheDomain.Chat

    // ---- Reads --------------------------------------------------------------------

    override fun chatSessions(): Flow<Resource<List<ChatSessionInfo>>> =
        observe(CHAT_SESSIONS_KEY) { api.request<JsonElement>(path = "/chatbot/sessions") }
            .decode(SESSIONS_SERIALIZER)

    override fun chatHistory(sessionId: String): Flow<Resource<List<ChatMessage>>> =
        observe(chatHistoryKey(sessionId)) {
            api.request<JsonElement>(path = "/chatbot/history", query = chatHistoryQuery(sessionId))
        }.decode(HISTORY_SERIALIZER)

    // ---- Mutations ----------------------------------------------------------------

    override suspend fun renameChatSession(
        sessionId: String,
        title: String,
    ): Result<RenameSessionResult> {
        val body = buildJsonObject { put("title", title) }
        return api
            .safeRequest<RenameSessionResult>(
                method = HttpMethodKind.PATCH,
                path = "/chatbot/sessions/${sessionId.encodeURLPathPart()}",
                body = jsonBody(body),
            ).onSuccess { patchCachedSessions { applyRenameToSessions(it, sessionId, title) } }
    }

    override suspend fun deleteChatSession(sessionId: String): Result<Unit> =
        // The server answers 204 No Content; read the (empty) body as raw text and discard so an
        // empty payload never triggers a spurious decode failure.
        api
            .safeRequest<String>(
                method = HttpMethodKind.DELETE,
                path = "/chatbot/sessions/${sessionId.encodeURLPathPart()}",
            ).map { }
            .onSuccess {
                patchCachedSessions { applyDeleteToSessions(it, sessionId) }
                evict(chatHistoryKey(sessionId))
            }

    override suspend fun sendChatMessage(input: SendChatMessageInput): Result<ChatResponse> {
        val body =
            buildJsonObject {
                put("message", input.message)
                // `JSON.stringify` drops an undefined `session_id`; only carry it when present.
                input.sessionId?.let { put("session_id", it) }
            }
        return api.safeRequest<ChatResponse>(method = HttpMethodKind.POST, path = "/chatbot", body = jsonBody(body))
    }

    // ---- Internals ----------------------------------------------------------------

    /**
     * Optimistically rewrites the cached session list through [transform] — the `setQueryData`
     * analogue. A miss (no list cached yet) or a schema-drifted cached payload is a no-op,
     * mirroring the web callback returning `undefined` when `prev` is absent.
     */
    private suspend fun patchCachedSessions(transform: (List<ChatSessionInfo>) -> List<ChatSessionInfo>) {
        val cached = peek(CHAT_SESSIONS_KEY) ?: return
        val sessions = runCatching { json.decodeFromJsonElement(SESSIONS_SERIALIZER, cached.data) }.getOrNull() ?: return
        put(CHAT_SESSIONS_KEY, json.encodeToJsonElement(SESSIONS_SERIALIZER, transform(sessions)))
    }

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
     * Wraps an already-built [JsonObject] as [TextContent] so its exact, compact JSON bytes reach
     * the wire unchanged — byte-for-byte parity with the web `JSON.stringify` bodies.
     */
    private fun jsonBody(obj: JsonObject): TextContent = TextContent(obj.toString(), ContentType.Application.Json)

    private companion object {
        val SESSIONS_SERIALIZER: KSerializer<List<ChatSessionInfo>> = ListSerializer(ChatSessionInfo.serializer())
        val HISTORY_SERIALIZER: KSerializer<List<ChatMessage>> = ListSerializer(ChatMessage.serializer())
    }
}
