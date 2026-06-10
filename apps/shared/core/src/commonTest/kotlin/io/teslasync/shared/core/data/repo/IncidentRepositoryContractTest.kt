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
import io.teslasync.shared.core.presentation.incidents.AppendIncidentUpdateInput
import io.teslasync.shared.core.presentation.incidents.CreateIncidentInput
import io.teslasync.shared.core.presentation.incidents.ListIncidentsParams
import io.teslasync.shared.core.presentation.incidents.PatchIncidentInput
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpIncidentRepository] call to the exact endpoint/method/params/body the web
 * `useIncidents` hooks issue, and verifies each mutation evicts the WHOLE incident cache partition
 * (the web `invalidateQueries(['status-incidents'])` analogue). A path/param/body regression is
 * caught at build time instead of as a silent always-fails Incidents screen.
 */
class IncidentRepositoryContractTest {
    private val json = Json

    // A single incident body the typed reads/mutations can decode.
    private val incidentBody =
        """
        {"id":1,"title":"Outage","description":"API down","severity":"major","status":"investigating",
         "source":"manual","affected_components":["api"],"updates":[],
         "started_at":"2026-01-01T00:00:00Z","created_at":"2026-01-01T00:00:00Z",
         "updated_at":"2026-01-01T00:00:00Z"}
        """.trimIndent()

    private val listBody = """{"incidents":[$incidentBody],"count":1}"""

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpIncidentRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpIncidentRepository(api, store)
    }

    private suspend fun captureRead(
        body: String,
        call: (HttpIncidentRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun incidentsHitsBaseWithNoParamsWhenEmpty() =
        runTestBlocking {
            val url = captureRead(listBody) { it.incidents() }
            assertEquals("/api/v1/status/incidents", url.encodedPath)
            assertNull(url.parameters["active"])
            assertNull(url.parameters["limit"])
        }

    @Test
    fun incidentsSendsActiveAndLimit() =
        runTestBlocking {
            val url = captureRead(listBody) { it.incidents(ListIncidentsParams(activeOnly = true, limit = 25)) }
            assertEquals("/api/v1/status/incidents", url.encodedPath)
            assertEquals("1", url.parameters["active"])
            assertEquals("25", url.parameters["limit"])
        }

    @Test
    fun incidentsOmitsActiveWhenFalseAndZeroLimit() =
        runTestBlocking {
            // Web `listIncidents` uses truthy guards: a false active and a zero limit are dropped.
            val url = captureRead(listBody) { it.incidents(ListIncidentsParams(activeOnly = false, limit = 0)) }
            assertNull(url.parameters["active"])
            assertNull(url.parameters["limit"])
        }

    @Test
    fun incidentsDecodesTypedEnvelopeAndCachesUnderListKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = listBody)
            val emissions = r.incidents(ListIncidentsParams(activeOnly = true)).toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.count)
            val firstIncident = success.data.incidents.first()
            assertEquals("Outage", firstIncident.title)
            assertTrue(
                store.read(CacheDomain.Incidents, incidentListCacheKey(ListIncidentsParams(activeOnly = true))) != null,
            )
        }

    @Test
    fun incidentHitsDetailPathAndCachesUnderDetailKey() =
        runTestBlocking {
            val store = MapCacheStore()
            var url: Url? = null
            val r = repo(store, body = incidentBody) { url = it.url }
            val emissions = r.incident(42).toList()

            assertEquals("/api/v1/status/incidents/42", url!!.encodedPath)
            val success = emissions.last() as Resource.Success
            assertEquals(1L, success.data.id)
            assertTrue(store.read(CacheDomain.Incidents, incidentDetailCacheKey(42)) != null)
        }

    // ---- Mutations: method + path + body + invalidate-all -------------------------

    @Test
    fun createIncidentPostsBodyAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            // A list feed AND a detail feed are cached — a create must drop BOTH (invalidate all).
            store.putRaw(CacheDomain.Incidents, incidentListCacheKey(ListIncidentsParams()), "{}", 1)
            store.putRaw(CacheDomain.Incidents, incidentDetailCacheKey(1), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = incidentBody) { seen = it }

            val result =
                r.createIncident(
                    CreateIncidentInput(
                        title = "Outage",
                        description = "API down",
                        severity = "major",
                        status = "investigating",
                        affectedComponents = listOf("api", "db"),
                        initialMessage = "We are investigating",
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/status/incidents", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("Outage", body["title"]!!.jsonPrimitive.content)
            assertEquals("API down", body["description"]!!.jsonPrimitive.content)
            assertEquals("major", body["severity"]!!.jsonPrimitive.content)
            assertEquals("investigating", body["status"]!!.jsonPrimitive.content)
            val firstComponent = body["affected_components"]!!.jsonArray.first()
            assertEquals("api", firstComponent.jsonPrimitive.content)
            assertEquals("We are investigating", body["initial_message"]!!.jsonPrimitive.content)
            // invalidate `['status-incidents']`: the whole partition is gone.
            assertEquals(0, store.size())
        }

    @Test
    fun createIncidentOmitsOptionalKeysWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = incidentBody) { seen = it }

            r.createIncident(CreateIncidentInput(title = "Bare"))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertEquals("Bare", body["title"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("description"))
            assertFalse(body.containsKey("severity"))
            assertFalse(body.containsKey("status"))
            assertFalse(body.containsKey("affected_components"))
            assertFalse(body.containsKey("initial_message"))
        }

    @Test
    fun patchIncidentPatchesByIdWithOnlyChangedFields() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Incidents, incidentListCacheKey(ListIncidentsParams()), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = incidentBody) { seen = it }

            val result = r.patchIncident(PatchIncidentInput(id = 42, status = "resolved", resolved = true))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Patch, req.method)
            assertEquals("/api/v1/status/incidents/42", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("resolved", body["status"]!!.jsonPrimitive.content)
            assertTrue(body["resolved"]!!.jsonPrimitive.content.toBoolean())
            // Untouched fields are absent from the patch.
            assertFalse(body.containsKey("title"))
            assertFalse(body.containsKey("severity"))
            assertEquals(0, store.size())
        }

    @Test
    fun appendIncidentUpdatePostsToUpdatesPathAndInvalidates() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Incidents, incidentDetailCacheKey(7), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = incidentBody) { seen = it }

            val result = r.appendIncidentUpdate(AppendIncidentUpdateInput(id = 7, message = "mitigated", status = "monitoring"))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/status/incidents/7/updates", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("mitigated", body["message"]!!.jsonPrimitive.content)
            assertEquals("monitoring", body["status"]!!.jsonPrimitive.content)
            assertEquals(0, store.size())
        }

    @Test
    fun appendIncidentUpdateOmitsStatusWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = incidentBody) { seen = it }

            r.appendIncidentUpdate(AppendIncidentUpdateInput(id = 7, message = "just a note"))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertEquals("just a note", body["message"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("status"))
        }

    @Test
    fun deleteIncidentDeletesByIdAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Incidents, incidentListCacheKey(ListIncidentsParams()), "{}", 1)
            store.putRaw(CacheDomain.Incidents, incidentDetailCacheKey(42), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.deleteIncident(42)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/status/incidents/42", req.url.encodedPath)
            assertEquals(0, store.size())
        }

    @Test
    fun mutationFailureDoesNotInvalidate() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Incidents, incidentListCacheKey(ListIncidentsParams()), "{}", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpIncidentRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.deleteIncident(42)

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.Incidents, incidentListCacheKey(ListIncidentsParams())) != null)
        }
}
