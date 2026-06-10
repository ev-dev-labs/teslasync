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
import io.teslasync.shared.core.presentation.savedviews.SavedViewCreateInput
import io.teslasync.shared.core.presentation.savedviews.SavedViewUpdateInput
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
 * Locks every [HttpSavedViewRepository] call to the exact endpoint/method/params/body the web
 * `useSavedViews` hooks issue, and verifies each mutation evicts ONLY the affected route's cache key
 * (the web `invalidateQueries(savedViewsKeys.list(route))` analogue — never the whole `all` prefix).
 * A path/param/body regression is caught at build time instead of as a silent always-fails
 * SavedViewMenu.
 */
class SavedViewRepositoryContractTest {
    private val json = Json

    // A single-row array body the typed `List<SavedView>` read can decode.
    private val rowBody =
        """
        [{"id":1,"user_id":3,"name":"Last week","route":"/drives",
          "query":"from=2025-04-24&sort=distance","is_default":true,"is_pinned":false,
          "sort_order":2,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-02T00:00:00Z"}]
        """.trimIndent()

    private val singleRowBody = rowBody.removeSurrounding("[", "]").trim()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpSavedViewRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSavedViewRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpSavedViewRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Read: path + params ------------------------------------------------------

    @Test
    fun savedViewsHitsRootWithRouteParam() =
        runTestBlocking {
            val url = captureRead { it.savedViews("/drives") }
            assertEquals("/api/v1/saved-views", url.encodedPath)
            assertEquals("/drives", url.parameters["route"])
        }

    @Test
    fun savedViewsDecodesTypedRowsAndCachesUnderRouteKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowBody)
            val emissions = r.savedViews("/drives").toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            val row = success.data.first()
            assertEquals("Last week", row.name)
            assertEquals("/drives", row.route)
            assertTrue(row.isDefault)
            assertFalse(row.isPinned)
            assertEquals(2, row.sortOrder)
            // The opaque query blob round-trips verbatim.
            assertEquals("from=2025-04-24&sort=distance", row.query)
            // Cached under the web `savedViewsKeys.list(route)` key.
            assertTrue(store.read(CacheDomain.SavedViews, savedViewCacheKey("/drives")) != null)
        }

    @Test
    fun distinctRoutesCacheUnderDistinctKeys() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = rowBody)
            r.savedViews("/drives").toList()
            r.savedViews("/charging").toList()
            assertTrue(store.read(CacheDomain.SavedViews, savedViewCacheKey("/drives")) != null)
            assertTrue(store.read(CacheDomain.SavedViews, savedViewCacheKey("/charging")) != null)
            assertEquals("/drives", savedViewCacheKey("/drives"))
        }

    // ---- Mutations: method + path + body + per-route invalidate --------------------

    @Test
    fun createPostsBodyAndEvictsOnlyCreatedRoute() =
        runTestBlocking {
            val store = MapCacheStore()
            // Two distinct route feeds cached — a create on /drives must drop ONLY /drives.
            store.putRaw(CacheDomain.SavedViews, savedViewCacheKey("/drives"), "[]", 1)
            store.putRaw(CacheDomain.SavedViews, savedViewCacheKey("/charging"), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = singleRowBody, status = HttpStatusCode.Created) { seen = it }

            val result =
                r.createSavedView(
                    SavedViewCreateInput(
                        name = "Last week",
                        route = "/drives",
                        query = "from=2025-04-24&sort=distance",
                        isDefault = true,
                        isPinned = false,
                        sortOrder = 2,
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/saved-views", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("Last week", body["name"]!!.jsonPrimitive.content)
            assertEquals("/drives", body["route"]!!.jsonPrimitive.content)
            assertEquals("from=2025-04-24&sort=distance", body["query"]!!.jsonPrimitive.content)
            assertTrue(body["is_default"]!!.jsonPrimitive.content.toBoolean())
            assertEquals(2, body["sort_order"]!!.jsonPrimitive.content.toInt())
            // Only the created row's route is evicted; the other route survives.
            assertNull(store.read(CacheDomain.SavedViews, savedViewCacheKey("/drives")))
            assertTrue(store.read(CacheDomain.SavedViews, savedViewCacheKey("/charging")) != null)
        }

    @Test
    fun createOmitsOptionalKeysWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = singleRowBody, status = HttpStatusCode.Created) { seen = it }

            r.createSavedView(SavedViewCreateInput(name = "Minimal", route = "/drives", query = "q=1"))

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertTrue(body.containsKey("name"))
            assertTrue(body.containsKey("route"))
            assertTrue(body.containsKey("query"))
            assertFalse(body.containsKey("is_default"))
            assertFalse(body.containsKey("is_pinned"))
            assertFalse(body.containsKey("sort_order"))
        }

    @Test
    fun updatePutsByIdWithOnlyChangedFieldsAndEvictsRoute() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.SavedViews, savedViewCacheKey("/drives"), "[]", 1)
            store.putRaw(CacheDomain.SavedViews, savedViewCacheKey("/charging"), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = singleRowBody) { seen = it }

            val result = r.updateSavedView(42, "/drives", SavedViewUpdateInput(name = "Renamed"))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/saved-views/42", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("Renamed", body["name"]!!.jsonPrimitive.content)
            // Untouched fields (id is path-only) are absent from the body.
            assertFalse(body.containsKey("id"))
            assertFalse(body.containsKey("query"))
            assertFalse(body.containsKey("is_default"))
            // Only the supplied route is evicted.
            assertNull(store.read(CacheDomain.SavedViews, savedViewCacheKey("/drives")))
            assertTrue(store.read(CacheDomain.SavedViews, savedViewCacheKey("/charging")) != null)
        }

    @Test
    fun deleteDeletesByIdAndEvictsRoute() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.SavedViews, savedViewCacheKey("/drives"), "[]", 1)
            store.putRaw(CacheDomain.SavedViews, savedViewCacheKey("/charging"), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = "", status = HttpStatusCode.NoContent) { seen = it }

            val result = r.deleteSavedView(42, "/drives")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/saved-views/42", req.url.encodedPath)
            assertNull(store.read(CacheDomain.SavedViews, savedViewCacheKey("/drives")))
            assertTrue(store.read(CacheDomain.SavedViews, savedViewCacheKey("/charging")) != null)
        }

    @Test
    fun setDefaultPutsIsDefaultByIdAndEvictsRoute() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.SavedViews, savedViewCacheKey("/drives"), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = singleRowBody) { seen = it }

            val result = r.setDefaultSavedView(7, "/drives", true)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/saved-views/7", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            // The web useSetDefaultSavedView sends ONLY { is_default }.
            assertTrue(body["is_default"]!!.jsonPrimitive.content.toBoolean())
            assertFalse(body.containsKey("name"))
            assertEquals(1, body.size)
            assertNull(store.read(CacheDomain.SavedViews, savedViewCacheKey("/drives")))
        }

    @Test
    fun mutationFailureDoesNotEvict() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.SavedViews, savedViewCacheKey("/drives"), "[]", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpSavedViewRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.deleteSavedView(42, "/drives")

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.SavedViews, savedViewCacheKey("/drives")) != null)
        }
}
