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
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpWatchRepository] call to the exact endpoint/method/params/body the web `useWatch`
 * hooks issue (web/src/api/hooks/useWatch.ts). A path/param/body regression is caught at build time
 * instead of as a silently-broken Watch screen.
 */
class WatchRepositoryContractTest {
    private val json = Json

    private val summaryBody =
        "{\"vehicle_name\":\"Lightning\",\"state\":\"online\",\"battery_level\":72,\"range_km\":312.5," +
            "\"is_charging\":true,\"charge_rate\":48,\"time_to_full\":35,\"is_locked\":true,\"sentry_mode\":true," +
            "\"inside_temp_c\":21.5,\"outside_temp_c\":14,\"is_climate_on\":true,\"last_updated\":\"2026-06-05T12:00:00Z\"}"
    private val complicationBody =
        "{\"battery\":\"72%\",\"range\":\"312 km\",\"state\":\"online\",\"charging\":true}"

    // A 2xx whose shape drifted (battery_level is not a number) is a contract error, surfaced as
    // Resource.Error WITHOUT throwing across the flow boundary.
    private val driftedSummaryBody =
        "{\"vehicle_name\":\"Lightning\",\"battery_level\":\"not-a-number\"}"

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpWatchRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpWatchRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpWatchRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private fun bodyOf(req: HttpRequestData): JsonObject = json.parseToJsonElement((req.body as TextContent).text) as JsonObject

    // ---- Reads: path + params + decode + cache ------------------------------------

    @Test
    fun summaryHitsWatchSummaryWithVehicleIdAndDecodesTypedRow() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = summaryBody)
            val emissions = r.watchSummary(7L).toList()

            val success = emissions.last() as Resource.Success
            assertEquals("Lightning", success.data.vehicleName)
            assertEquals(312.5, success.data.rangeKm)
            assertTrue(success.data.isCharging)
            assertTrue(store.read(CacheDomain.Watch, watchSummaryCacheKey(7L)) != null)

            val url = captureRead(summaryBody) { it.watchSummary(7L) }
            assertEquals("/api/v1/watch/summary", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun summaryOmitsVehicleIdWhenNull() =
        runTestBlocking {
            val url = captureRead(summaryBody) { it.watchSummary(null) }
            assertEquals("/api/v1/watch/summary", url.encodedPath)
            assertNull(url.parameters["vehicle_id"])
        }

    @Test
    fun complicationHitsWatchComplicationWithVehicleIdAndDecodesTypedRow() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = complicationBody)
            val emissions = r.watchComplication(7L).toList()

            val success = emissions.last() as Resource.Success
            assertEquals("72%", success.data.battery)
            assertEquals("312 km", success.data.range)
            assertTrue(store.read(CacheDomain.Watch, watchComplicationCacheKey(7L)) != null)

            val url = captureRead(complicationBody) { it.watchComplication(7L) }
            assertEquals("/api/v1/watch/complication", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun complicationOmitsVehicleIdWhenNull() =
        runTestBlocking {
            val url = captureRead(complicationBody) { it.watchComplication(null) }
            assertNull(url.parameters["vehicle_id"])
        }

    @Test
    fun driftedSummaryBodySurfacesAsError() =
        runTestBlocking {
            val r = repo(body = driftedSummaryBody)
            val emissions = r.watchSummary(7L).toList()
            assertTrue(emissions.last() is Resource.Error)
        }

    // ---- Command: method + path + body --------------------------------------------

    @Test
    fun commandPostsVehicleIdAndCommandBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"success":true,"message":"Command sent"}""") { seen = it }

            val result = r.sendWatchCommand(7L, "flash_lights")

            assertTrue(result.isSuccess)
            assertTrue(result.getOrThrow().success)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/watch/command", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals("7", body["vehicle_id"]!!.jsonPrimitive.content)
            assertEquals("flash_lights", body["command"]!!.jsonPrimitive.content)
        }

    @Test
    fun commandDefaultsNullVehicleIdToZero() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"success":false,"message":"no"}""") { seen = it }

            val result = r.sendWatchCommand(null, "honk")

            // A transport 2xx can still carry success=false (the backend rejected the command).
            assertTrue(result.isSuccess)
            assertTrue(!result.getOrThrow().success)
            assertEquals("0", bodyOf(requireNotNull(seen))["vehicle_id"]!!.jsonPrimitive.content)
        }

    @Test
    fun commandFailureReturnsFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpWatchRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), MapCacheStore())

            val result = r.sendWatchCommand(7L, "flash_lights")

            assertTrue(result.isFailure)
        }
}
