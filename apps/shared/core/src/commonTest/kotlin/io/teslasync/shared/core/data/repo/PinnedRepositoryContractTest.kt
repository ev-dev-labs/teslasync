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
import io.teslasync.shared.core.presentation.pinned.PinnedItemType
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpPinnedRepository] call to the exact endpoint/method/params/body the web
 * `usePinned` hooks issue, and verifies the mutations leave the cache intact (the web hooks
 * INVALIDATE — refetch — rather than removeQueries, so the S8 store's targeted refresh owns
 * eviction). A path/param/body regression is caught at build time instead of as a silent
 * always-fails Pinned surface.
 */
class PinnedRepositoryContractTest {
    private val json = Json

    // A single pin row body the typed `List<PinnedItem>` read can decode.
    private val rowsBody =
        """
        [{"id":1,"item_type":"widget","item_id":"battery","position":0,
          "pinned_at":"2026-01-01T00:00:00Z"}]
        """.trimIndent()

    // A single-object body the POST/PATCH `PinnedItem` reads can decode.
    private val itemBody =
        """
        {"id":1,"item_type":"widget","item_id":"battery","position":0,
         "pinned_at":"2026-01-01T00:00:00Z","context":"glance"}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpPinnedRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpPinnedRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpPinnedRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Read: path + params ------------------------------------------------------

    @Test
    fun pinnedHitsRootWithTypeOnlyWhenNoContext() =
        runTestBlocking {
            val url = captureRead { it.pinned(PinnedItemType.Widget) }
            assertEquals("/api/v1/pinned", url.encodedPath)
            assertEquals("widget", url.parameters["type"])
            assertNull(url.parameters["context"])
        }

    @Test
    fun pinnedSendsContextWhenPresent() =
        runTestBlocking {
            val url = captureRead { it.pinned(PinnedItemType.Widget, "glance") }
            assertEquals("widget", url.parameters["type"])
            assertEquals("glance", url.parameters["context"])
        }

    @Test
    fun pinnedSendsExplicitEmptyContext() =
        runTestBlocking {
            // Web `buildQuery` sends context whenever `!= null` — an explicit "" IS on the wire.
            val url = captureRead { it.pinned(PinnedItemType.Widget, "") }
            assertEquals("widget", url.parameters["type"])
            assertEquals("", url.parameters["context"])
        }

    @Test
    fun pinnedUsesSnakeCaseWireTokenForCompoundTypes() =
        runTestBlocking {
            val url = captureRead { it.pinned(PinnedItemType.AlertRule) }
            assertEquals("alert_rule", url.parameters["type"])
        }

    @Test
    fun pinnedDecodesTypedRowsAndCachesUnderListKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowsBody)
            val emissions = r.pinned(PinnedItemType.Widget).toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals("battery", success.data.first().itemId)
            // Cached under the web `pinnedKeys.list` tuple `['pinned', 'widget', null]`.
            assertTrue(store.read(CacheDomain.Pinned, pinnedCacheKey(PinnedItemType.Widget, null)) != null)
        }

    // ---- Lookup helpers: peek (cache) + fetch (direct, uncached) ------------------

    @Test
    fun peekPinnedReadsCachedBucketWithoutNetwork() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowsBody)
            // Hydrate the bucket cache via a normal read.
            r.pinned(PinnedItemType.Widget).toList()

            val peeked = r.peekPinned(PinnedItemType.Widget)
            assertEquals(1, peeked?.size)
            assertEquals("battery", peeked?.first()?.itemId)
        }

    @Test
    fun peekPinnedIsNullOnColdCache() =
        runTestBlocking {
            val r = repo(body = rowsBody)
            assertNull(r.peekPinned(PinnedItemType.Widget))
        }

    @Test
    fun fetchPinnedHitsRootDirectlyAndDoesNotWriteCache() =
        runTestBlocking {
            val store = MapCacheStore()
            var seen: HttpRequestData? = null
            val r = repo(store, body = rowsBody) { seen = it }

            val result = r.fetchPinned(PinnedItemType.Widget, "glance")

            assertTrue(result.isSuccess)
            assertEquals(1, result.getOrThrow().size)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Get, req.method)
            assertEquals("/api/v1/pinned", req.url.encodedPath)
            assertEquals("widget", req.url.parameters["type"])
            assertEquals("glance", req.url.parameters["context"])
            // The fresh-fetch fallback never writes the cache (web raw `request` leaves it alone).
            assertEquals(0, store.size())
        }

    // ---- Mutations: method + path + body + cache-left-intact ----------------------

    @Test
    fun createPinPostsBodyAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Pinned, pinnedCacheKey(PinnedItemType.Widget, null), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = itemBody) { seen = it }

            val result = r.createPin(PinnedItemType.Widget, itemId = "battery", context = "glance")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/pinned", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("widget", body["item_type"]!!.jsonPrimitive.content)
            assertEquals("battery", body["item_id"]!!.jsonPrimitive.content)
            assertEquals("glance", body["context"]!!.jsonPrimitive.content)
            // INVALIDATE (refetch), not removeQueries: the durable cache is left intact.
            assertEquals(1, store.size())
        }

    @Test
    fun createPinOmitsContextWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = itemBody) { seen = it }

            r.createPin(PinnedItemType.Vehicle, itemId = "42")

            val req = requireNotNull(seen)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("vehicle", body["item_type"]!!.jsonPrimitive.content)
            assertEquals("42", body["item_id"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("context"))
        }

    @Test
    fun deletePinDeletesByIdAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Pinned, pinnedCacheKey(PinnedItemType.Widget, null), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.deletePin(42)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/pinned/42", req.url.encodedPath)
            assertEquals(1, store.size())
        }

    @Test
    fun reorderPinPatchesByIdWithPosition() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = itemBody) { seen = it }

            val result = r.reorderPin(id = 7, position = 3)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Patch, req.method)
            assertEquals("/api/v1/pinned/7", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("3", body["position"]!!.jsonPrimitive.content)
        }

    @Test
    fun mutationFailurePropagatesAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Pinned, pinnedCacheKey(PinnedItemType.Widget, null), "[]", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpPinnedRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.deletePin(42)

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.Pinned, pinnedCacheKey(PinnedItemType.Widget, null)) != null)
        }
}
