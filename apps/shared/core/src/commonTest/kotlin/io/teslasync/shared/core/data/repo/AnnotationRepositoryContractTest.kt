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
import io.teslasync.shared.core.presentation.annotations.AnnotationListParams
import io.teslasync.shared.core.presentation.annotations.CreateAnnotationInput
import io.teslasync.shared.core.presentation.annotations.UpdateAnnotationInput
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
 * Locks every [HttpAnnotationRepository] call to the exact endpoint/method/params/body the web
 * `useAnnotations` hooks issue, and verifies each mutation evicts the WHOLE annotation cache
 * partition (the web `invalidateQueries(annotationKeys.all)` analogue). A path/param/body
 * regression is caught at build time instead of as a silent always-fails Annotations screen.
 */
class AnnotationRepositoryContractTest {
    private val json = Json

    // A single row body the typed `List<ChartAnnotationRow>` read can decode.
    private val rowBody =
        """
        [{"id":1,"vehicle_id":7,"occurred_at":"2026-01-01T00:00:00Z","category":"maintenance",
          "title":"Tire rotation","scope":["tire"],"created_at":"2026-01-01T00:00:00Z",
          "updated_at":"2026-01-01T00:00:00Z"}]
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpAnnotationRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpAnnotationRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpAnnotationRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Read: path + params ------------------------------------------------------

    @Test
    fun chartAnnotationsHitsAnnotationsRootWithNoParamsWhenEmpty() =
        runTestBlocking {
            val url = captureRead { it.chartAnnotations() }
            assertEquals("/api/v1/annotations/", url.encodedPath)
            assertNull(url.parameters["vehicle_id"])
            assertNull(url.parameters["scope"])
            assertNull(url.parameters["from"])
            assertNull(url.parameters["to"])
        }

    @Test
    fun chartAnnotationsSendsEveryParam() =
        runTestBlocking {
            val url =
                captureRead {
                    it.chartAnnotations(
                        AnnotationListParams(vehicleId = 7, scope = "battery", from = "2026-01-01", to = "2026-02-01"),
                    )
                }
            assertEquals("/api/v1/annotations/", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
            assertEquals("battery", url.parameters["scope"])
            assertEquals("2026-01-01", url.parameters["from"])
            assertEquals("2026-02-01", url.parameters["to"])
        }

    @Test
    fun chartAnnotationsOmitsBlankScopeFromAndTo() =
        runTestBlocking {
            // Web `buildQuery` uses truthy guards, so empty strings are dropped (only vehicle_id
            // is sent via `!= null`).
            val url =
                captureRead {
                    it.chartAnnotations(AnnotationListParams(vehicleId = 7, scope = "", from = "", to = ""))
                }
            assertEquals("7", url.parameters["vehicle_id"])
            assertNull(url.parameters["scope"])
            assertNull(url.parameters["from"])
            assertNull(url.parameters["to"])
        }

    @Test
    fun chartAnnotationsDecodesTypedRowsAndCachesUnderListKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowBody)
            val emissions = r.chartAnnotations(AnnotationListParams(vehicleId = 7)).toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals("Tire rotation", success.data.first().title)
            // Cached under the web `annotationKeys.list` tuple `[7, all, '', '']`.
            assertTrue(store.read(CacheDomain.Annotations, annotationCacheKey(AnnotationListParams(vehicleId = 7))) != null)
        }

    // ---- Mutations: method + path + body + invalidate-all -------------------------

    @Test
    fun createAnnotationPostsBodyAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            // Two distinct list feeds cached — a create must drop BOTH (invalidate `all`).
            store.putRaw(CacheDomain.Annotations, annotationCacheKey(AnnotationListParams(vehicleId = 7)), "[]", 1)
            store.putRaw(CacheDomain.Annotations, annotationCacheKey(AnnotationListParams(scope = "cost")), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = rowBody.removeSurrounding("[", "]")) { seen = it }

            val result =
                r.createAnnotation(
                    CreateAnnotationInput(
                        occurredAt = "2026-06-15T00:00:00Z",
                        category = "maintenance",
                        title = "Tire rotation",
                        vehicleId = 7,
                        description = "Front to back",
                        scope = listOf("tire"),
                        color = "#ff8800",
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/annotations/", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("2026-06-15T00:00:00Z", body["occurred_at"]!!.jsonPrimitive.content)
            assertEquals("maintenance", body["category"]!!.jsonPrimitive.content)
            assertEquals("Tire rotation", body["title"]!!.jsonPrimitive.content)
            assertEquals("7", body["vehicle_id"]!!.jsonPrimitive.content)
            assertEquals("Front to back", body["description"]!!.jsonPrimitive.content)
            val firstScope = body["scope"]!!.jsonArray.first()
            assertEquals("tire", firstScope.jsonPrimitive.content)
            assertEquals("#ff8800", body["color"]!!.jsonPrimitive.content)
            // invalidate `all`: the whole partition is gone.
            assertEquals(0, store.size())
        }

    @Test
    fun createAnnotationOmitsOptionalKeysWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = rowBody.removeSurrounding("[", "]")) { seen = it }

            r.createAnnotation(
                CreateAnnotationInput(occurredAt = "2026-06-15T00:00:00Z", category = "custom", title = "Note"),
            )

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertFalse(body.containsKey("vehicle_id"))
            assertFalse(body.containsKey("description"))
            assertFalse(body.containsKey("scope"))
            assertFalse(body.containsKey("color"))
        }

    @Test
    fun updateAnnotationPatchesByIdWithOnlyChangedFields() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Annotations, annotationCacheKey(AnnotationListParams()), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = rowBody.removeSurrounding("[", "]")) { seen = it }

            val result = r.updateAnnotation(UpdateAnnotationInput(id = 42, title = "New title"))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Patch, req.method)
            assertEquals("/api/v1/annotations/42", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("New title", body["title"]!!.jsonPrimitive.content)
            // Untouched fields are absent from the patch.
            assertFalse(body.containsKey("category"))
            assertFalse(body.containsKey("occurred_at"))
            assertEquals(0, store.size())
        }

    @Test
    fun updateAnnotationSendsClearFlagsOnlyWhenSet() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = rowBody.removeSurrounding("[", "]")) { seen = it }

            r.updateAnnotation(UpdateAnnotationInput(id = 42, clearDescription = true, clearColor = true))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertTrue(body["clear_description"]!!.jsonPrimitive.content.toBoolean())
            assertTrue(body["clear_color"]!!.jsonPrimitive.content.toBoolean())
        }

    @Test
    fun updateAnnotationOmitsClearFlagsWhenUnset() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = rowBody.removeSurrounding("[", "]")) { seen = it }

            r.updateAnnotation(UpdateAnnotationInput(id = 42, title = "x"))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertFalse(body.containsKey("clear_description"))
            assertFalse(body.containsKey("clear_color"))
        }

    @Test
    fun deleteAnnotationDeletesByIdAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Annotations, annotationCacheKey(AnnotationListParams(vehicleId = 7)), "[]", 1)
            store.putRaw(CacheDomain.Annotations, annotationCacheKey(AnnotationListParams()), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.deleteAnnotation(42)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/annotations/42", req.url.encodedPath)
            assertEquals(0, store.size())
        }

    @Test
    fun mutationFailureDoesNotInvalidate() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Annotations, annotationCacheKey(AnnotationListParams()), "[]", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpAnnotationRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.deleteAnnotation(42)

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.Annotations, annotationCacheKey(AnnotationListParams())) != null)
        }
}
