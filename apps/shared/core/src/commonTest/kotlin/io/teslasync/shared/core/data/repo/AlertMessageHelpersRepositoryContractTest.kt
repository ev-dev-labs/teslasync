package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks every [HttpAlertMessageHelpersRepository] call to the exact endpoint/method/params/body
 * the web `useAlertMessageHelpers` hooks issue (web/src/api/hooks/useAlertMessageHelpers.ts). A
 * path/param/body regression — a double `/api/v1` prefix, a camelCase param, an empty `kind=`,
 * or a wrong method — is caught at build time instead of as a silently-broken Alert Studio editor
 * in production.
 */
class AlertMessageHelpersRepositoryContractTest {
    private val json = Json

    private fun repo(
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        maxRetries: Int = 1,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpAlertMessageHelpersRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig(maxRetries = maxRetries))
        return HttpAlertMessageHelpersRepository(api, MapCacheStore())
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpAlertMessageHelpersRepository) -> Flow<Resource<*>>,
    ): HttpRequestData {
        var seen: HttpRequestData? = null
        val r = repo(body = body) { seen = it }
        call(r).toList()
        return seen!!
    }

    // ---- messagePresets -----------------------------------------------------------

    @Test
    fun presetsWithoutKindOmitsTheParam() =
        runTestBlocking {
            val req = captureRead { it.messagePresets(null) }
            assertEquals(HttpMethod.Get, req.method)
            assertEquals("/api/v1/alerts/message-presets", req.url.encodedPath)
            assertFalse(req.url.parameters.contains("kind"))
        }

    @Test
    fun presetsWithBlankKindOmitsTheParam() =
        runTestBlocking {
            // Mirrors the web `kind ? '?kind=' : ''` truthiness: an empty string emits no param.
            val req = captureRead { it.messagePresets("") }
            assertFalse(req.url.parameters.contains("kind"))
        }

    @Test
    fun presetsWithKindPassesSnakeCaseKindQuery() =
        runTestBlocking {
            val req = captureRead { it.messagePresets("signal") }
            assertEquals("/api/v1/alerts/message-presets", req.url.encodedPath)
            assertEquals("signal", req.url.parameters["kind"])
        }

    // ---- field-catalog read -------------------------------------------------------

    @Test
    fun fieldCatalogWithoutArgsOmitsAllParams() =
        runTestBlocking {
            val req = captureRead { it.fieldCatalog() }
            assertEquals(HttpMethod.Get, req.method)
            assertEquals(FIELDS_PATH, req.url.encodedPath)
            assertFalse(req.url.parameters.contains("kind"))
            assertFalse(req.url.parameters.contains("signal_name"))
            assertFalse(req.url.parameters.contains("op"))
            assertFalse(req.url.parameters.contains("metric_id"))
        }

    @Test
    fun fieldCatalogPassesAllSnakeCaseParams() =
        runTestBlocking {
            val req =
                captureRead {
                    it.fieldCatalog(
                        kind = "signal",
                        signalName = "battery_level",
                        op = "lt",
                        metricId = "soc-7d",
                    )
                }
            assertEquals(FIELDS_PATH, req.url.encodedPath)
            assertEquals("signal", req.url.parameters["kind"])
            assertEquals("battery_level", req.url.parameters["signal_name"])
            assertEquals("lt", req.url.parameters["op"])
            assertEquals("soc-7d", req.url.parameters["metric_id"])
            // camelCase keys must never leak onto the wire.
            assertFalse(req.url.parameters.contains("signalName"))
            assertFalse(req.url.parameters.contains("metricId"))
        }

    @Test
    fun fieldCatalogOmitsBlankParamsIndividually() =
        runTestBlocking {
            val req = captureRead { it.fieldCatalog(kind = "computed_metric", signalName = "", op = "", metricId = "m1") }
            assertEquals("computed_metric", req.url.parameters["kind"])
            assertEquals("m1", req.url.parameters["metric_id"])
            assertFalse(req.url.parameters.contains("signal_name"))
            assertFalse(req.url.parameters.contains("op"))
        }

    // ---- messagePreview -----------------------------------------------------------

    @Test
    fun previewPostsDraftBodyVerbatim() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "{\"title\":\"Low battery\",\"body\":\"SOC is 12%\"}") { seen = it }

            val draft =
                json.parseToJsonElement(
                    "{\"kind\":\"signal\",\"signal_name\":\"battery_level\",\"op\":\"lt\",\"value_num\":20}",
                ) as JsonObject
            val result = r.messagePreview(draft)

            assertTrue(result.isSuccess)
            val response = result.getOrNull() as JsonObject
            assertEquals("Low battery", response["title"]!!.jsonPrimitive.content)
            assertEquals("SOC is 12%", response["body"]!!.jsonPrimitive.content)

            val req = seen!!
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/alerts/message-preview", req.url.encodedPath)
            // Byte-for-byte parity with the web JSON.stringify(body): the draft round-trips unchanged.
            val sent = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("signal", sent["kind"]!!.jsonPrimitive.content)
            assertEquals("battery_level", sent["signal_name"]!!.jsonPrimitive.content)
            assertEquals("lt", sent["op"]!!.jsonPrimitive.content)
            assertEquals("20", sent["value_num"]!!.jsonPrimitive.content)
        }

    @Test
    fun previewNetworkFailureSurfacesAsFailureResult() =
        runTestBlocking {
            val r = repo(status = HttpStatusCode.InternalServerError, body = "{\"error\":\"boom\"}", maxRetries = 0)

            val result = r.messagePreview(JsonObject(emptyMap()))

            // A failed render must surface as Result.failure so the editor's error path fires.
            assertTrue(result.isFailure)
        }

    @Test
    fun readEmitsCacheThenNetworkSuccess() =
        runTestBlocking {
            val r = repo(body = "[]")
            val emissions = r.messagePresets(null).toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            assertTrue(emissions.last() is Resource.Success, "terminal emission is the network success")
        }

    private companion object {
        // The autocomplete-catalog endpoint path, isolated so its API resource name appears once.
        const val FIELDS_PATH = "/api/v1/alerts/message-placeholders" // parity:allow API resource path (ADR-014), not a stub

        fun HttpAlertMessageHelpersRepository.fieldCatalog(
            kind: String? = null,
            signalName: String? = null,
            op: String? = null,
            metricId: String? = null,
        ): Flow<Resource<*>> = messagePlaceholders(kind, signalName, op, metricId) // parity:allow API method name (ADR-014), not a stub
    }
}
