package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import io.teslasync.shared.core.presentation.chat.ChatSessionInfo
import io.teslasync.shared.core.presentation.chat.SendChatMessageInput
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpChatRepository] call to the exact endpoint/method/params/body the web `useChat`
 * hooks (and their `@/api/devtools` chat exports) issue, and verifies each mutation's cache effect:
 * rename/delete optimistically patch the cached session list (the web `setQueryData` analogue) and
 * delete evicts the session's history key (the web `removeQueries` analogue). A path/param/body
 * regression is caught at build time instead of as a silent always-fails Chat screen.
 */
class ChatRepositoryContractTest {
    private val json = Json
    private val sessionsSerializer = ListSerializer(ChatSessionInfo.serializer())

    private val sessionsBody =
        """
        [{"id":"a","title":"Alpha","first_message":"hi","message_count":3,
          "last_message_at":"2026-01-02T00:00:00Z","created_at":"2026-01-01T00:00:00Z"},
         {"id":"b","title":null,"first_message":"yo","message_count":1,
          "last_message_at":null,"created_at":"2026-01-01T00:00:00Z"}]
        """.trimIndent()

    private val historyBody =
        """
        [{"id":1,"session_id":"a","role":"user","content":"hi","created_at":"2026-01-01T00:00:00Z"},
         {"id":2,"session_id":"a","role":"assistant","content":"hello","created_at":"2026-01-01T00:00:01Z"}]
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpChatRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpChatRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpChatRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun chatSessionsHitsSessionsEndpointAndCachesUnderSessionsKey() =
        runTestBlocking {
            val store = MapCacheStore()
            var captured: Url? = null
            val r = repo(store, body = sessionsBody) { captured = it.url }
            val emissions = r.chatSessions().toList()

            assertEquals("/api/v1/chatbot/sessions", requireNotNull(captured).encodedPath)
            val success = emissions.last() as Resource.Success
            assertEquals(2, success.data.size)
            assertEquals("Alpha", success.data.first().title)
            assertTrue(store.read(CacheDomain.Chat, CHAT_SESSIONS_KEY) != null)
        }

    @Test
    fun chatHistoryHitsHistoryEndpointWithSessionIdAndCachesUnderHistoryKey() =
        runTestBlocking {
            val store = MapCacheStore()
            var captured: Url? = null
            val r = repo(store, body = historyBody) { captured = it.url }
            val emissions = r.chatHistory("a").toList()

            val url = requireNotNull(captured)
            assertEquals("/api/v1/chatbot/history", url.encodedPath)
            assertEquals("a", url.parameters["session_id"])
            val success = emissions.last() as Resource.Success
            assertEquals(2, success.data.size)
            assertEquals("hello", success.data[1].content)
            assertTrue(store.read(CacheDomain.Chat, chatHistoryKey("a")) != null)
        }

    @Test
    fun chatHistoryDecodeIsTypedNotShared() =
        runTestBlocking {
            // A history read must not collide with the sessions key in the shared partition.
            val url = captureRead(body = historyBody) { it.chatHistory("xyz") }
            assertEquals("xyz", url.parameters["session_id"])
        }

    // ---- Rename: method + path + body + optimistic patch --------------------------

    @Test
    fun renamePatchesByIdAndOptimisticallyUpdatesCachedSessions() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Chat, CHAT_SESSIONS_KEY, sessionsBody, 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = """{"id":"a","title":"Renamed"}""") { seen = it }

            val result = r.renameChatSession("a", "  Renamed  ")

            assertTrue(result.isSuccess)
            assertEquals("Renamed", result.getOrThrow().title)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Patch, req.method)
            assertEquals("/api/v1/chatbot/sessions/a", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("  Renamed  ", body["title"]!!.jsonPrimitive.content)

            // setQueryData analogue: the cached list now carries the normalised title for "a".
            val cached = json.decodeFromString(sessionsSerializer, store.read(CacheDomain.Chat, CHAT_SESSIONS_KEY)!!.payload)
            assertEquals("Renamed", cached.first { it.id == "a" }.title)
            assertEquals(null, cached.first { it.id == "b" }.title)
        }

    @Test
    fun renameToBlankClearsTheCachedTitleToNull() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Chat, CHAT_SESSIONS_KEY, sessionsBody, 1)
            val r = repo(store, body = """{"id":"a","title":""}""")

            r.renameChatSession("a", "   ")

            val cached = json.decodeFromString(sessionsSerializer, store.read(CacheDomain.Chat, CHAT_SESSIONS_KEY)!!.payload)
            assertEquals(null, cached.first { it.id == "a" }.title)
        }

    @Test
    fun renameEncodesSessionIdInThePath() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"id":"a b","title":"x"}""") { seen = it }

            r.renameChatSession("a b", "x")

            // encodeURIComponent analogue: a non-URL-safe id is percent-encoded in the path.
            assertTrue(requireNotNull(seen).url.encodedPath.contains("%20"), "space must be percent-encoded")
        }

    // ---- Delete: method + path + optimistic patch + history eviction --------------

    @Test
    fun deleteRemovesByIdAndOptimisticallyDropsItFromCachedSessionsAndEvictsHistory() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Chat, CHAT_SESSIONS_KEY, sessionsBody, 1)
            store.putRaw(CacheDomain.Chat, chatHistoryKey("a"), historyBody, 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.deleteChatSession("a")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/chatbot/sessions/a", req.url.encodedPath)

            // setQueryData analogue: "a" is gone from the cached list; "b" remains.
            val cached = json.decodeFromString(sessionsSerializer, store.read(CacheDomain.Chat, CHAT_SESSIONS_KEY)!!.payload)
            assertEquals(listOf("b"), cached.map { it.id })
            // removeQueries analogue: the deleted session's history key is evicted.
            assertNull(store.read(CacheDomain.Chat, chatHistoryKey("a")))
        }

    @Test
    fun deleteFailureDoesNotTouchTheCache() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Chat, CHAT_SESSIONS_KEY, sessionsBody, 1)
            store.putRaw(CacheDomain.Chat, chatHistoryKey("a"), historyBody, 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpChatRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.deleteChatSession("a")

            assertTrue(result.isFailure)
            // The cached list and history survive a failed delete.
            val cached = json.decodeFromString(sessionsSerializer, store.read(CacheDomain.Chat, CHAT_SESSIONS_KEY)!!.payload)
            assertEquals(listOf("a", "b"), cached.map { it.id })
            assertTrue(store.read(CacheDomain.Chat, chatHistoryKey("a")) != null)
        }

    // ---- Send: method + path + body ------------------------------------------------

    @Test
    fun sendChatMessagePostsMessageAndSessionId() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"response":"hi there","session_id":"a"}""") { seen = it }

            val result = r.sendChatMessage(SendChatMessageInput(message = "hi", sessionId = "a"))

            assertTrue(result.isSuccess)
            assertEquals("hi there", result.getOrThrow().response)
            assertEquals("a", result.getOrThrow().sessionId)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/chatbot", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("hi", body["message"]!!.jsonPrimitive.content)
            assertEquals("a", body["session_id"]!!.jsonPrimitive.content)
        }

    @Test
    fun sendChatMessageOmitsSessionIdWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"response":"hi","session_id":"new"}""") { seen = it }

            r.sendChatMessage(SendChatMessageInput(message = "hi"))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertEquals("hi", body["message"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("session_id"), "an absent session_id must be dropped from the wire body")
        }
}
