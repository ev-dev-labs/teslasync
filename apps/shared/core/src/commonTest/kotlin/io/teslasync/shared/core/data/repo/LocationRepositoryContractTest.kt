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
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Locks every [HttpLocationRepository] call to the exact endpoint/method/params/body the web
 * `useLocations` hooks issue, verifies the `safeArray` guard collapses a non-array payload to an
 * empty list, and confirms the bulk-delete mutation leaves the cache intact (invalidation is the S8
 * store's targeted refresh). A path/param/body regression is caught at build time instead of as a
 * silent always-fails Locations screen.
 */
class LocationRepositoryContractTest {
    private val json = Json

    private val locationBody =
        """
        [{"id":1,"vehicle_id":7,"address_name":"Home","visit_count":12,
          "total_duration_s":3600,"last_visited":"2026-01-02T00:00:00Z","created_at":"2026-01-01T00:00:00Z"}]
        """.trimIndent()

    private val geofenceBody =
        """
        [{"id":3,"name":"Work","polygon_wkt":"POLYGON((0 0,0 1,1 1,1 0,0 0))","enabled":true,
          "alert_on_entry":true,"alert_on_exit":false,"created_at":"2026-01-01T00:00:00Z",
          "updated_at":"2026-01-01T00:00:00Z","latitude":1.0,"longitude":2.0,"radius":150.0}]
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpLocationRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpLocationRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpLocationRepository) -> kotlinx.coroutines.flow.Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun visitedLocationsHitsLocationsWithVehicleIdParam() =
        runTestBlocking {
            val url = captureRead { it.visitedLocations("7") }
            assertEquals("/api/v1/locations", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun geofencesHitsGeofencesRoot() =
        runTestBlocking {
            val url = captureRead { it.geofences() }
            assertEquals("/api/v1/geofences", url.encodedPath)
        }

    @Test
    fun visitedLocationsDecodesTypedRowsAndCachesUnderLocationsKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = locationBody)
            val emissions = r.visitedLocations("7").toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals("Home", success.data.first().addressName)
            assertEquals(3600L, success.data.first().totalDurationS)
            assertTrue(store.read(CacheDomain.Locations, visitedLocationsKey("7")) != null)
        }

    @Test
    fun geofencesDecodesTypedRowsAndCachesUnderGeofencesKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = geofenceBody)
            val emissions = r.geofences().toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals("Work", success.data.first().name)
            assertEquals(150.0, success.data.first().radius)
            assertTrue(store.read(CacheDomain.Locations, geofencesKey()) != null)
        }

    @Test
    fun nonArrayPayloadCollapsesToEmptyListViaSafeArray() =
        runTestBlocking {
            // A scalar/object instead of an array must not crash the decode (web `select: safeArray`).
            val r = repo(body = """{"unexpected":"object"}""")
            val success = r.geofences().toList().last() as Resource.Success
            assertEquals(emptyList(), success.data)
        }

    // ---- Mutation: method + path + body + no cache touch --------------------------

    @Test
    fun bulkDeleteGeofencesPostsOpDeleteBodyAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            // A geofences feed AND a locations feed are cached — the mutation must touch NEITHER.
            store.putRaw(CacheDomain.Locations, geofencesKey(), "[]", 1)
            store.putRaw(CacheDomain.Locations, visitedLocationsKey("7"), "[]", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = """{"deleted":2,"failed":[{"id":99,"reason":"not_found"}]}""") { seen = it }

            val result = r.bulkDeleteGeofences(listOf(1L, 2L, 99L))

            assertTrue(result.isSuccess)
            val res = result.getOrThrow()
            assertEquals(2L, res.deleted)
            assertEquals(1, res.failed.size)
            assertEquals(99L, res.failed.first().id)
            assertEquals("not_found", res.failed.first().reason)

            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/geofences/bulk", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertEquals("delete", body["op"]!!.jsonPrimitive.content)
            assertEquals(listOf("1", "2", "99"), body["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
            // Invalidation is the S8 store's job — the durable cache is left intact here.
            assertTrue(store.read(CacheDomain.Locations, geofencesKey()) != null)
            assertTrue(store.read(CacheDomain.Locations, visitedLocationsKey("7")) != null)
        }

    @Test
    fun bulkDeleteFailurePropagatesAsResultFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpLocationRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), MapCacheStore())

            val result = r.bulkDeleteGeofences(listOf(1L))

            assertTrue(result.isFailure)
        }
}
