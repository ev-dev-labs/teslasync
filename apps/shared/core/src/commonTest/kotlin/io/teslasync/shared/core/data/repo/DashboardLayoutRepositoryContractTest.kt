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
import io.teslasync.shared.core.presentation.dashboardlayouts.CreateDashboardLayoutInput
import io.teslasync.shared.core.presentation.dashboardlayouts.UpdateDashboardLayoutInput
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpDashboardLayoutRepository] call to the exact endpoint/method/params/body the web
 * `useDashboardLayouts` hooks issue, and verifies each mutation evicts the WHOLE layout cache
 * partition (the web `invalidateQueries(dashboardLayoutLibraryKeys.all)` analogue). A
 * path/param/body regression is caught at build time instead of as a silent always-fails
 * LayoutSwitcher.
 */
class DashboardLayoutRepositoryContractTest {
    private val json = Json

    // A single row body the typed `List<NamedDashboardLayout>` read can decode.
    private val rowBody =
        """
        [{"id":1,"user_id":3,"vehicle_id":7,"name":"Morning","is_default":true,
          "layout":{"widgets":[],"version":2},"created_at":"2026-01-01T00:00:00Z",
          "updated_at":"2026-01-02T00:00:00Z"}]
        """.trimIndent()

    private val singleRowBody = rowBody.removeSurrounding("[", "]").trim()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpDashboardLayoutRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpDashboardLayoutRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpDashboardLayoutRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private fun objectLayout(): JsonObject =
        buildJsonObject {
            put("widgets", "[]")
            put("version", 2)
        }

    // ---- Read: path + params ------------------------------------------------------

    @Test
    fun namedLayoutsHitsLayoutsRootWithNoParamsWhenScopeless() =
        runTestBlocking {
            val url = captureRead { it.namedLayouts() }
            assertEquals("/api/v1/dashboard/layouts", url.encodedPath)
            assertNull(url.parameters["vehicle_id"])
        }

    @Test
    fun namedLayoutsSendsVehicleIdWhenScoped() =
        runTestBlocking {
            val url = captureRead { it.namedLayouts(vehicleId = 42) }
            assertEquals("/api/v1/dashboard/layouts", url.encodedPath)
            assertEquals("42", url.parameters["vehicle_id"])
        }

    @Test
    fun namedLayoutsDecodesTypedRowsAndCachesUnderScopeKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowBody)
            val emissions = r.namedLayouts(vehicleId = 7).toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals("Morning", success.data.first().name)
            assertTrue(success.data.first().isDefault)
            // The opaque layout blob round-trips verbatim.
            assertEquals(
                2,
                success.data
                    .first()
                    .layout.jsonObject["version"]!!
                    .jsonPrimitive.content
                    .toInt(),
            )
            // Cached under the web `dashboardLayoutLibraryKeys.list` scope key `7`.
            assertTrue(store.read(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(7)) != null)
        }

    @Test
    fun scopelessAndScopedReadsCacheUnderDistinctKeys() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowBody)
            r.namedLayouts().toList()
            r.namedLayouts(vehicleId = 7).toList()
            assertTrue(store.read(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(null)) != null)
            assertTrue(store.read(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(7)) != null)
            assertEquals("global", dashboardLayoutCacheKey(null))
        }

    // ---- Mutations: method + path + body + invalidate-all -------------------------

    @Test
    fun createLayoutPostsBodyAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            // Two distinct scope feeds cached — a create must drop BOTH (invalidate `all`).
            store.putRaw(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(7), "[]", 1)
            store.putRaw(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(null), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = singleRowBody, status = HttpStatusCode.Created) { seen = it }

            val result =
                r.createLayout(
                    CreateDashboardLayoutInput(
                        name = "Morning",
                        layout = objectLayout(),
                        vehicleId = 7,
                        isDefault = true,
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/dashboard/layouts", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("Morning", body["name"]!!.jsonPrimitive.content)
            assertEquals("7", body["vehicle_id"]!!.jsonPrimitive.content)
            assertTrue(body["is_default"]!!.jsonPrimitive.content.toBoolean())
            // The opaque layout blob is carried verbatim as a JSON object.
            assertEquals(
                2,
                body["layout"]!!
                    .jsonObject["version"]!!
                    .jsonPrimitive.content
                    .toInt(),
            )
            // invalidate `all`: the whole partition is gone.
            assertEquals(0, store.size())
        }

    @Test
    fun createLayoutOmitsOptionalKeysWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = singleRowBody, status = HttpStatusCode.Created) { seen = it }

            r.createLayout(CreateDashboardLayoutInput(name = "Minimal", layout = objectLayout()))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertTrue(body.containsKey("name"))
            assertTrue(body.containsKey("layout"))
            assertFalse(body.containsKey("vehicle_id"))
            assertFalse(body.containsKey("is_default"))
        }

    @Test
    fun updateLayoutPutsByIdWithOnlyChangedFields() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(null), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = singleRowBody) { seen = it }

            val result = r.updateLayout(UpdateDashboardLayoutInput(id = 42, name = "Renamed"))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/dashboard/layouts/42", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("Renamed", body["name"]!!.jsonPrimitive.content)
            // Untouched fields (id is path-only) are absent from the body.
            assertFalse(body.containsKey("id"))
            assertFalse(body.containsKey("is_default"))
            assertFalse(body.containsKey("layout"))
            assertEquals(0, store.size())
        }

    @Test
    fun updateLayoutSendsLayoutBlobWhenProvided() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = singleRowBody) { seen = it }

            r.updateLayout(UpdateDashboardLayoutInput(id = 42, layout = objectLayout(), isDefault = false))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertEquals(
                2,
                body["layout"]!!
                    .jsonObject["version"]!!
                    .jsonPrimitive.content
                    .toInt(),
            )
            assertFalse(body["is_default"]!!.jsonPrimitive.content.toBoolean())
            assertFalse(body.containsKey("name"))
        }

    @Test
    fun deleteLayoutDeletesByIdAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(7), "[]", 1)
            store.putRaw(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(null), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.deleteLayout(42)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/dashboard/layouts/42", req.url.encodedPath)
            assertEquals(0, store.size())
        }

    @Test
    fun applyLayoutPostsApplyByIdAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(7), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = singleRowBody) { seen = it }

            val result = r.applyLayout(2)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/dashboard/layouts/2/apply", req.url.encodedPath)
            assertEquals(0, store.size())
        }

    @Test
    fun mutationFailureDoesNotInvalidate() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(null), "[]", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpDashboardLayoutRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.deleteLayout(42)

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.DashboardLayouts, dashboardLayoutCacheKey(null)) != null)
        }
}
