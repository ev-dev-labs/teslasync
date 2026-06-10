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
import io.teslasync.shared.core.presentation.push.PushSubscribeBody
import io.teslasync.shared.core.presentation.push.PushSubscribeKeys
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpPushRepository] call to the exact endpoint/method/params/body the web `usePush`
 * hooks issue (web/src/api/hooks/usePush.ts), verifies the public-key 404/"not configured"
 * derivation resolves to a cached `null` key (not an error) while other failures surface as
 * [Resource.Error], and verifies the mutations leave the cache intact (the web hooks INVALIDATE —
 * refetch — via the S8 store, never removeQueries). A path/param/body regression is caught at build
 * time instead of as a silent always-fails Push surface.
 */
class PushRepositoryContractTest {
    private val json = Json

    private val subscriptionsBody =
        """
        [{"id":1,"user_id":null,"endpoint":"https://push.example.com/abc","p256dh":"pk",
          "auth":"sec","user_agent":"Chrome","created_at":"2026-01-01T00:00:00Z","last_used_at":null}]
        """.trimIndent()

    private val subscriptionRowBody =
        """
        {"id":1,"endpoint":"https://push.example.com/abc","p256dh":"pk","auth":"sec",
         "created_at":"2026-01-01T00:00:00Z"}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        maxRetries: Int = 1,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpPushRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig(maxRetries = maxRetries))
        return HttpPushRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        call: (HttpPushRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body, status = status) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Read: public key ---------------------------------------------------------

    @Test
    fun publicKeyHitsPublicKeyEndpointAndDecodesNonEmptyKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = """{"publicKey":"BFxVAPIDkey"}""")
            val emissions = r.publicKey().toList()

            val success = emissions.last() as Resource.Success
            assertEquals("BFxVAPIDkey", success.data.key)
            // Cached under the web `pushKeys.publicKey` tuple.
            assertTrue(store.read(CacheDomain.Push, pushPublicKeyKey()) != null)
        }

    @Test
    fun publicKeyUsesGetOnTheCorrectPath() =
        runTestBlocking {
            val url = captureRead(body = """{"publicKey":"k"}""") { it.publicKey() }
            assertEquals("/api/v1/push/public-key", url.encodedPath)
        }

    @Test
    fun publicKeyEmptyStringCoalescesToNull() =
        runTestBlocking {
            val r = repo(body = """{"publicKey":""}""")
            val success = r.publicKey().toList().last() as Resource.Success
            assertNull(success.data.key)
        }

    @Test
    fun publicKey404ResolvesToNullKeyNotError() =
        runTestBlocking {
            val store = MapCacheStore()
            val r =
                repo(
                    store,
                    body = """{"error":"web push is not configured on this install"}""",
                    status = HttpStatusCode.NotFound,
                    maxRetries = 0,
                )
            val emissions = r.publicKey().toList()

            val success = emissions.last() as Resource.Success
            assertNull(success.data.key, "404 / unconfigured maps to a successful null key")
            // The derived null wrapper is cached so the unconfigured state round-trips.
            assertTrue(store.read(CacheDomain.Push, pushPublicKeyKey()) != null)
        }

    @Test
    fun publicKeyServerErrorSurfacesAsError() =
        runTestBlocking {
            val r = repo(body = "boom", status = HttpStatusCode.InternalServerError, maxRetries = 0)
            val emissions = r.publicKey().toList()
            assertTrue(emissions.last() is Resource.Error, "a non-404 failure stays an error")
        }

    // ---- Read: subscriptions ------------------------------------------------------

    @Test
    fun subscriptionsHitsSubscribeEndpointAndDecodesRows() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = subscriptionsBody)
            val emissions = r.subscriptions().toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals("https://push.example.com/abc", success.data.first().endpoint)
            assertTrue(store.read(CacheDomain.Push, pushSubscriptionsKey()) != null)
        }

    @Test
    fun subscriptionsUsesGetOnTheSubscribePath() =
        runTestBlocking {
            val url = captureRead(body = "[]") { it.subscriptions() }
            assertEquals("/api/v1/push/subscribe", url.encodedPath)
        }

    @Test
    fun subscriptionsGuardsNonArrayToEmpty() =
        runTestBlocking {
            // safeArray collapses an object payload to an empty list rather than crashing the decode.
            val r = repo(body = """{"unexpected":"object"}""")
            val success = r.subscriptions().toList().last() as Resource.Success
            assertTrue(success.data.isEmpty())
        }

    // ---- Mutations ----------------------------------------------------------------

    @Test
    fun subscribePostsBrowserBodyAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Push, pushSubscriptionsKey(), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = subscriptionRowBody, status = HttpStatusCode.Created) { seen = it }

            val result =
                r.subscribe(
                    PushSubscribeBody(
                        endpoint = "https://push.example.com/abc",
                        keys = PushSubscribeKeys(p256dh = "pk", auth = "sec"),
                    ),
                )

            assertTrue(result.isSuccess)
            assertEquals(1L, result.getOrThrow().id)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/push/subscribe", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("https://push.example.com/abc", body["endpoint"]!!.jsonPrimitive.content)
            val keys = body["keys"]!!.jsonObject
            assertEquals("pk", keys["p256dh"]!!.jsonPrimitive.content)
            assertEquals("sec", keys["auth"]!!.jsonPrimitive.content)
            // INVALIDATE (refetch), not removeQueries: the durable cache is left intact.
            assertEquals(1, store.size())
        }

    @Test
    fun unsubscribeDeletesWithEndpointBodyAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Push, pushSubscriptionsKey(), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.unsubscribe("https://push.example.com/abc")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/push/subscribe", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("https://push.example.com/abc", body["endpoint"]!!.jsonPrimitive.content)
            assertEquals(1, store.size())
        }

    @Test
    fun mutationFailurePropagatesAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Push, pushSubscriptionsKey(), "[]", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpPushRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.unsubscribe("https://push.example.com/abc")

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.Push, pushSubscriptionsKey()) != null)
        }
}
