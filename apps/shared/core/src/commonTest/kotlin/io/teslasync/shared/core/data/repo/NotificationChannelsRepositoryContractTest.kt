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
import io.teslasync.shared.core.presentation.notificationchannels.NotificationChannel
import kotlinx.coroutines.flow.Flow
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
 * Locks every [HttpNotificationChannelsRepository] call to the exact endpoint/method/params/body
 * the web `useNotificationChannels` hooks issue (web/src/api/hooks/useNotificationChannels.ts +
 * the channel-list read from web/src/api/hooks/useNotifications.ts). A path/param/body regression —
 * or losing the "HTTP 200 even on receiver failure" webhook-test contract — is caught at build time
 * instead of as a silently-broken NotificationChannels screen.
 */
class NotificationChannelsRepositoryContractTest {
    private val json = Json

    private val channelsBody =
        """
        [
          {"kind":"discord","id":1,"name":"ops","webhook_url":"https://d"},
          {"kind":"webhook","id":2,"name":"primary","url":"https://p","method":"POST"}
        ]
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpNotificationChannelsRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpNotificationChannelsRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpNotificationChannelsRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private fun bodyOf(req: HttpRequestData): JsonObject = json.parseToJsonElement((req.body as TextContent).text) as JsonObject

    // ---- Read: path + decode + cache ----------------------------------------------

    @Test
    fun channelsHitsRootWithNoTrailingSlash() =
        runTestBlocking {
            val url = captureRead(channelsBody) { it.channels() }
            assertEquals("/api/v1/notifications", url.encodedPath)
        }

    @Test
    fun channelsDecodesTypedUnionAndCachesUnderChannelsKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = channelsBody)
            val emissions = r.channels().toList()

            val success = emissions.last() as Resource.Success
            assertEquals(2, success.data.size)
            assertTrue(success.data[0] is NotificationChannel.Discord)
            assertTrue(success.data[1] is NotificationChannel.Webhook)
            assertEquals("https://p", (success.data[1] as NotificationChannel.Webhook).url)
            assertTrue(store.read(CacheDomain.Notifications, channelsKey()) != null)
        }

    @Test
    fun channelsSuccessBodyThatNoLongerMatchesDtoSurfacesAsError() =
        runTestBlocking {
            // A 2xx whose shape drifted (id is not a number) is a contract error, surfaced as
            // Resource.Error WITHOUT throwing across the flow boundary.
            val r = repo(body = """[{"kind":"webhook","id":"not-a-number","name":"x"}]""")
            val emissions = r.channels().toList()
            assertTrue(emissions.last() is Resource.Error)
        }

    // ---- Mutation: webhook-test ---------------------------------------------------

    @Test
    fun webhookTestPostsBodyWhenFieldsPresent() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"success":true,"status_code":200,"latency_ms":12}""") { seen = it }

            val result = r.testWebhookChannel(7, title = "Hi", message = "There")

            assertTrue(result.isSuccess)
            assertTrue(result.getOrThrow().success)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/notifications/7/webhook-test", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("Hi", body["title"]!!.jsonPrimitive.content)
            assertEquals("There", body["message"]!!.jsonPrimitive.content)
        }

    @Test
    fun webhookTestSendsNoBodyWhenFieldsAbsentOrBlank() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"success":true,"status_code":200,"latency_ms":5}""") { seen = it }

            val result = r.testWebhookChannel(7, title = "   ", message = null)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/notifications/7/webhook-test", req.url.encodedPath)
            // No body attached at all (web: only attaches a body when a non-blank field exists).
            assertFalse(req.body is TextContent, "no JSON payload should be sent")
        }

    @Test
    fun webhookTestReturnsStructuredResultOnReceiverFailure() =
        runTestBlocking {
            // The endpoint answers HTTP 200 even when the receiver fails — a non-2xx receiver must
            // decode to a success Result carrying `success == false`, NOT a request failure.
            val r =
                repo(
                    body = """{"success":false,"status_code":502,"latency_ms":40,"error":"bad gateway"}""",
                )

            val result = r.testWebhookChannel(7)

            assertTrue(result.isSuccess)
            val res = result.getOrThrow()
            assertFalse(res.success)
            assertEquals(502, res.statusCode)
            assertEquals("bad gateway", res.error)
        }

    @Test
    fun webhookTestFailsOnRealServerError() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpNotificationChannelsRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), MapCacheStore())

            val result = r.testWebhookChannel(7)

            assertTrue(result.isFailure)
        }

    // ---- Mutation: signature preview ----------------------------------------------

    @Test
    fun previewSignaturePostsSecretAndBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"signature":"sha256=abc"}""") { seen = it }

            val result = r.previewWebhookSignature(secret = "s3cret", body = "{\"a\":1}")

            assertTrue(result.isSuccess)
            assertEquals("sha256=abc", result.getOrThrow().signature)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/notifications/webhooks/preview-signature", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("s3cret", body["secret"]!!.jsonPrimitive.content)
            assertEquals("{\"a\":1}", body["body"]!!.jsonPrimitive.content)
        }

    @Test
    fun previewSignatureSerializesEmptyBodyVerbatim() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"signature":""}""") { seen = it }

            r.previewWebhookSignature(secret = "x", body = "")

            val body = bodyOf(requireNotNull(seen))
            assertEquals("", body["body"]!!.jsonPrimitive.content)
            assertNull(body["nonexistent"])
        }
}
