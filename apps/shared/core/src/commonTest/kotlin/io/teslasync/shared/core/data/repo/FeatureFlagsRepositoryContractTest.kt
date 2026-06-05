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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpFeatureFlagsRepository] call to the exact endpoint/method/params/body the web
 * `useFeatureFlags` hooks issue, and verifies each mutation evicts the cache keys the web hook
 * invalidates (the whole `['system','flags']` prefix). A path/param/body regression is caught at
 * build time instead of as a silent always-fails Feature-Flags screen in production.
 */
class FeatureFlagsRepositoryContractTest {
    private val json = Json

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpFeatureFlagsRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpFeatureFlagsRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpFeatureFlagsRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun flagsHitsSystemFlags() =
        runTestBlocking {
            val url = captureRead("{\"count\":0,\"flags\":[]}") { it.flags() }
            assertEquals("/api/v1/system/flags", url.encodedPath)
        }

    @Test
    fun flagHitsPerKeyEndpointEncoded() =
        runTestBlocking {
            val url = captureRead("{\"key\":\"a.b\",\"value\":true}") { it.flag("a.b") }
            assertEquals("/api/v1/system/flags/a.b", url.encodedPath)
        }

    @Test
    fun globalChangesHitsChangesWithLimit() =
        runTestBlocking {
            val url =
                captureRead("{\"count\":0,\"flag_key\":\"\",\"limit\":50,\"rows\":[]}") {
                    it.flagChanges(limit = 50)
                }
            assertEquals("/api/v1/system/flags/changes", url.encodedPath)
            assertEquals("50", url.parameters["limit"])
        }

    @Test
    fun scopedChangesHitsPerKeyChangesWithLimit() =
        runTestBlocking {
            val url =
                captureRead("{\"count\":0,\"flag_key\":\"alpha\",\"limit\":10,\"rows\":[]}") {
                    it.flagChanges("alpha", limit = 10)
                }
            assertEquals("/api/v1/system/flags/alpha/changes", url.encodedPath)
            assertEquals("10", url.parameters["limit"])
        }

    // ---- Reads: typed decode ------------------------------------------------------

    @Test
    fun flagsDecodesTypedListResponse() =
        runTestBlocking {
            val r = repo(body = "{\"count\":2,\"flags\":[{\"key\":\"a\",\"value\":true},{\"key\":\"b\",\"value\":5}]}")
            val success = r.flags().toList().last() as Resource.Success
            assertEquals(2, success.data.count)
            assertEquals(
                "a",
                success.data.flags
                    .first()
                    .key,
            )
        }

    // ---- Mutations: method + path + body + invalidation ---------------------------

    @Test
    fun setFlagPutsValueAndReasonBodyAndInvalidatesPartition() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.FeatureFlags, "list", "{\"count\":0,\"flags\":[]}", 1)
            store.putRaw(CacheDomain.FeatureFlags, "flag:alpha", "{\"key\":\"alpha\",\"value\":false}", 1)
            var seen: HttpRequestData? = null
            val engine =
                MockEngine { request ->
                    seen = request
                    respond("{\"key\":\"alpha\",\"old_value\":false,\"new_value\":true,\"audit_id\":9}", HttpStatusCode.OK, jsonHeaders)
                }
            val r = HttpFeatureFlagsRepository(buildApiHttpClient(engine, testConfig()), store)

            val result = r.setFlag("alpha", JsonPrimitive(true), reason = "enable beta")

            assertTrue(result.isSuccess)
            assertEquals("alpha", result.getOrNull()!!.key)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Put, req.method)
            assertEquals("/api/v1/system/flags/alpha", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals(true, body["value"]!!.jsonPrimitive.content.toBoolean())
            assertEquals("enable beta", body["reason"]!!.jsonPrimitive.content)
            // invalidateQueries(['system','flags']) analogue: the whole partition is evicted.
            assertNull(store.read(CacheDomain.FeatureFlags, "list"))
            assertNull(store.read(CacheDomain.FeatureFlags, "flag:alpha"))
        }

    @Test
    fun deleteFlagSendsReasonQueryAndInvalidatesPartition() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.FeatureFlags, "list", "{\"count\":0,\"flags\":[]}", 1)
            var seen: HttpRequestData? = null
            val engine =
                MockEngine { request ->
                    seen = request
                    respond("{\"key\":\"alpha\",\"old_value\":true,\"deleted\":true,\"audit_id\":10}", HttpStatusCode.OK, jsonHeaders)
                }
            val r = HttpFeatureFlagsRepository(buildApiHttpClient(engine, testConfig()), store)

            val result = r.deleteFlag("alpha", reason = "retired")

            assertTrue(result.isSuccess)
            assertTrue(result.getOrNull()!!.deleted)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/system/flags/alpha", req.url.encodedPath)
            // reason is a query param (URLSearchParams), never a body.
            assertEquals("retired", req.url.parameters["reason"])
            assertNull(store.read(CacheDomain.FeatureFlags, "list"))
        }

    @Test
    fun mutationFailureDoesNotInvalidate() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.FeatureFlags, "list", "{\"count\":0,\"flags\":[]}", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpFeatureFlagsRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.deleteFlag("alpha", reason = "retired")

            assertTrue(result.isFailure)
            // A failed mutation must leave the cache untouched.
            assertFalse(store.read(CacheDomain.FeatureFlags, "list") == null)
        }
}
