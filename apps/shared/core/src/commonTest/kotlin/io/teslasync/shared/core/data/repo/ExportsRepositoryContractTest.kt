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
import io.teslasync.shared.core.presentation.exports.CreateAccountExportPayload
import io.teslasync.shared.core.presentation.exports.CreateExportPayload
import io.teslasync.shared.core.presentation.exports.ScheduledExportDelivery
import io.teslasync.shared.core.presentation.exports.ScheduledExportInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks every [HttpExportsRepository] call to the exact endpoint/method/params/body the web
 * `useExports` hooks issue (web/src/api/hooks/useExports.ts). A path/param/body regression is
 * caught at build time instead of as a silently-broken Exports screen.
 */
class ExportsRepositoryContractTest {
    private val json = Json

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpExportsRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpExportsRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpExportsRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private fun bodyOf(req: HttpRequestData): JsonObject = json.parseToJsonElement((req.body as TextContent).text) as JsonObject

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun exportsHitsExportJobs() =
        runTestBlocking {
            val url = captureRead("[]") { it.exports() }
            assertEquals("/api/v1/export/jobs", url.encodedPath)
        }

    @Test
    fun exportJobsHitsExportJobsAndCachesUnderJobsKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = """[{"id":"j1","status":"ready"}]""")
            val emissions = r.exportJobs().toList()

            val success = emissions.last() as Resource.Success
            assertEquals("j1", success.data.first().id)
            assertTrue(store.read(CacheDomain.Exports, exportJobsKey()) != null)
        }

    @Test
    fun exportJobHitsByIdUnderExportJobs() =
        runTestBlocking {
            val url = captureRead("""{"id":"j1"}""") { it.exportJob("j1") }
            assertEquals("/api/v1/export/jobs/j1", url.encodedPath)
        }

    @Test
    fun exportDetailHitsExportsById() =
        runTestBlocking {
            val url = captureRead("""{"id":"e1"}""") { it.export("e1") }
            assertEquals("/api/v1/exports/e1", url.encodedPath)
        }

    @Test
    fun exportColumnsSendsTypeParam() =
        runTestBlocking {
            val url =
                captureRead("""{"type":"drives","columns":[],"supports_selection":true}""") {
                    it.exportColumns("drives")
                }
            assertEquals("/api/v1/exports/columns", url.encodedPath)
            assertEquals("drives", url.parameters["type"])
        }

    @Test
    fun scheduledExportsHitsScheduledExports() =
        runTestBlocking {
            val url = captureRead("[]") { it.scheduledExports() }
            assertEquals("/api/v1/scheduled-exports", url.encodedPath)
        }

    @Test
    fun listReadsTolerateNonArrayViaSafeArray() =
        runTestBlocking {
            // A non-array payload collapses to an empty list (web `select: safeArray`), not an error.
            val r = repo(body = """{"unexpected":"object"}""")
            val emissions = r.exportJobs().toList()
            val success = emissions.last() as Resource.Success
            assertTrue(success.data.isEmpty())
        }

    // ---- Mutations: method + path + body ------------------------------------------

    @Test
    fun createExportPostsPayloadWithSnakeCaseVehicleId() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"id":"new","status":"queued"}""") { seen = it }

            val result =
                r.createExport(
                    CreateExportPayload(type = "drives", format = "csv", vehicleId = 7, columns = listOf("a", "b")),
                )

            assertTrue(result.isSuccess)
            assertEquals("new", result.getOrThrow().id)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/export/jobs", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("drives", body["type"]!!.jsonPrimitive.content)
            assertEquals("csv", body["format"]!!.jsonPrimitive.content)
            assertEquals("7", body["vehicle_id"]!!.jsonPrimitive.content)
            assertEquals(listOf("a", "b"), body["columns"]!!.jsonArray.map { it.jsonPrimitive.content })
            // null start/end dropped (web JSON.stringify parity).
            assertFalse(body.containsKey("start"))
            assertFalse(body.containsKey("end"))
        }

    @Test
    fun createAccountExportPostsEmptyBodyByDefault() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"id":"acct","status":"queued"}""") { seen = it }

            val result = r.createAccountExport(CreateAccountExportPayload())

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/export/jobs/account", req.url.encodedPath)
            // All-null payload serializes to `{}` (web default-arg parity).
            assertTrue(bodyOf(req).keys.isEmpty())
        }

    @Test
    fun bulkDeletePostsIdsWithDeleteOp() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"deleted":2,"failed":[]}""") { seen = it }

            val result = r.bulkExportsDelete(listOf("a", "b"))

            assertTrue(result.isSuccess)
            assertEquals(2, result.getOrThrow().deleted)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/export/jobs/bulk", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals(listOf("a", "b"), body["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
            assertEquals("delete", body["op"]!!.jsonPrimitive.content)
        }

    @Test
    fun createScheduledExportPostsInputBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"id":1,"name":"Nightly"}""") { seen = it }

            val result =
                r.createScheduledExport(
                    ScheduledExportInput(
                        name = "Nightly",
                        exportType = "drives",
                        format = "csv",
                        scheduleCron = "0 2 * * *",
                        delivery = ScheduledExportDelivery(kind = "email", target = "me@example.com"),
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/scheduled-exports", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("Nightly", body["name"]!!.jsonPrimitive.content)
            assertEquals("drives", body["export_type"]!!.jsonPrimitive.content)
            assertEquals("0 2 * * *", body["schedule_cron"]!!.jsonPrimitive.content)
            // owner_subject must NEVER be on the wire (backend DisallowUnknownFields).
            assertFalse(body.containsKey("owner_subject"))
            // null optionals dropped.
            assertFalse(body.containsKey("vehicle_id"))
            assertFalse(body.containsKey("range_window"))
            assertFalse(body.containsKey("enabled"))
        }

    @Test
    fun updateScheduledExportPutsById() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"id":5,"name":"Edited"}""") { seen = it }

            val result =
                r.updateScheduledExport(
                    5,
                    ScheduledExportInput(
                        name = "Edited",
                        exportType = "charging",
                        format = "json",
                        scheduleCron = "0 3 * * *",
                        delivery = ScheduledExportDelivery(kind = "download"),
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/scheduled-exports/5", req.url.encodedPath)
            assertEquals("Edited", bodyOf(req)["name"]!!.jsonPrimitive.content)
        }

    @Test
    fun deleteScheduledExportSendsDeleteById() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.deleteScheduledExport(5)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/scheduled-exports/5", req.url.encodedPath)
        }

    @Test
    fun runScheduledExportNowPostsRunById() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"id":5,"name":"Nightly"}""") { seen = it }

            val result = r.runScheduledExportNow(5)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/scheduled-exports/5/run", req.url.encodedPath)
        }

    @Test
    fun mutationFailureReturnsFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpExportsRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), MapCacheStore())

            val result = r.deleteScheduledExport(5)

            assertTrue(result.isFailure)
        }

    @Test
    fun successBodyThatNoLongerMatchesDtoSurfacesAsError() =
        runTestBlocking {
            // A 2xx scheduled-exports row whose id drifted to non-numeric is a contract error,
            // surfaced as Resource.Error WITHOUT throwing across the flow boundary.
            val r = repo(body = """[{"id":"not-a-number","name":"x"}]""")
            val emissions = r.scheduledExports().toList()
            assertTrue(emissions.last() is Resource.Error)
        }
}
