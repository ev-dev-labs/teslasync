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
import io.teslasync.shared.core.presentation.sharing.CreateShareRequest
import io.teslasync.shared.core.presentation.sharing.SharedDriveData
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks every [HttpSharingRepository] call to the exact endpoint/method/params/body the web
 * `useSharing` hooks issue, and verifies each mutation evicts ONLY the affected drive's share-link
 * cache key (the web `invalidateQueries(sharingKeys.shares(driveId))` analogue — never the public
 * report, never another drive). A path/param/body regression is caught at build time instead of as
 * a silent always-fails Sharing screen.
 */
class SharingRepositoryContractTest {
    private val json = Json

    private val shareRowsBody =
        """
        [{"id":1,"token":"abc","drive_id":42,"created_by":"me","title":"Loop","description":null,
          "include_map":true,"include_telemetry":false,"include_speed":true,"views":3,
          "expires_at":null,"created_at":"2026-01-01T00:00:00Z"}]
        """.trimIndent()

    private val sharedDriveBody =
        """
        {"payload_version":"v2","title":"Loop","description":"",
         "drive":{"date":"2026-01-01","distance_m":1609.34,"duration_s":600.0,
                  "start_address":"A","end_address":"B"}}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpSharingRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSharingRepository(api, store)
    }

    // ---- Reads: path + decode + cache key -----------------------------------------

    @Test
    fun shareLinksHitsDriveSharesPathAndCachesUnderTheSharesKey() =
        runTestBlocking {
            val store = MapCacheStore()
            var url: Url? = null
            val r = repo(store, body = shareRowsBody) { url = it.url }

            val emissions = r.shareLinks("42").toList()

            assertEquals("/api/v1/drives/42/shares", url!!.encodedPath)
            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals("abc", success.data.first().token)
            assertTrue(store.read(CacheDomain.Sharing, shareLinksCacheKey("42")) != null)
        }

    @Test
    fun sharedDriveHitsPublicSharePathAndCachesUnderTheSharedKey() =
        runTestBlocking {
            val store = MapCacheStore()
            var url: Url? = null
            val r = repo(store, body = sharedDriveBody) { url = it.url }

            val emissions = r.sharedDrive("tok-9").toList()

            assertEquals("/api/v1/share/tok-9", url!!.encodedPath)
            val success = emissions.last() as Resource.Success
            val drive = success.data
            assertTrue(drive is SharedDriveData)
            assertEquals(1609.34, drive.drive.distanceM)
            assertTrue(store.read(CacheDomain.Sharing, sharedDriveCacheKey("tok-9")) != null)
        }

    // ---- Mutations: method + path + body + targeted eviction ----------------------

    @Test
    fun createShareLinkPostsBodyAndEvictsOnlyThatDriveKey() =
        runTestBlocking {
            val store = MapCacheStore()
            // Two share-link feeds + one public report cached — a create must drop ONLY drive 42's.
            store.putRaw(CacheDomain.Sharing, shareLinksCacheKey("42"), "[]", 1)
            store.putRaw(CacheDomain.Sharing, shareLinksCacheKey("99"), "[]", 1)
            store.putRaw(CacheDomain.Sharing, sharedDriveCacheKey("tok-9"), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = """{"token":"t","url":"https://x/t","id":5}""") { seen = it }

            val result =
                r.createShareLink(
                    "42",
                    CreateShareRequest(title = "Loop", description = "d", includeSpeed = true, expiresInDays = 7),
                )

            assertTrue(result.isSuccess)
            assertEquals("t", result.getOrThrow().token)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/drives/42/share", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("Loop", body["title"]!!.jsonPrimitive.content)
            assertEquals("d", body["description"]!!.jsonPrimitive.content)
            assertEquals("true", body["include_speed"]!!.jsonPrimitive.content)
            assertEquals("7", body["expires_in_days"]!!.jsonPrimitive.content)
            assertFalse(body.containsKey("include_telemetry"))
            // Only drive 42's share key is gone; drive 99 and the public report survive.
            assertTrue(store.read(CacheDomain.Sharing, shareLinksCacheKey("42")) == null)
            assertTrue(store.read(CacheDomain.Sharing, shareLinksCacheKey("99")) != null)
            assertTrue(store.read(CacheDomain.Sharing, sharedDriveCacheKey("tok-9")) != null)
        }

    @Test
    fun revokeShareLinkDeletesByTokenAndEvictsOnlyThatDriveKey() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Sharing, shareLinksCacheKey("42"), "[]", 1)
            store.putRaw(CacheDomain.Sharing, sharedDriveCacheKey("abc"), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = """{"status":"revoked"}""") { seen = it }

            val result = r.revokeShareLink("42", "abc")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/shares/abc", req.url.encodedPath)
            assertTrue(store.read(CacheDomain.Sharing, shareLinksCacheKey("42")) == null)
            // The DELETE is by token but invalidates by drive — the public report is left intact.
            assertTrue(store.read(CacheDomain.Sharing, sharedDriveCacheKey("abc")) != null)
        }

    @Test
    fun createShareLinkOmitsEveryNullField() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"token":"t","url":"u","id":1}""") { seen = it }

            r.createShareLink("42", CreateShareRequest())

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            assertTrue(body.keys.isEmpty(), "an empty request sends no keys")
        }

    @Test
    fun mutationFailureDoesNotEvict() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Sharing, shareLinksCacheKey("42"), "[]", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpSharingRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.revokeShareLink("42", "abc")

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.Sharing, shareLinksCacheKey("42")) != null)
        }
}
