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
import io.teslasync.shared.core.presentation.guard.SetGuardConfigInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Locks every [HttpGuardRepository] call to the exact endpoint/method/params/body the web `useGuard`
 * hooks issue, so a path/param/body regression is caught at build time instead of as a silent
 * always-fails Guard screen in production. The mutations leave the cache intact (invalidation is the
 * S8 store's targeted refresh, the web `invalidateQueries` analogue), which these tests also assert.
 */
class GuardRepositoryContractTest {
    private val json = Json

    private val configBody =
        """
        {"vehicle_id":7,"enabled":true,"home_geofence_id":3,"sensitivity":"high","auto_panic":false,
         "created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}
        """.trimIndent()

    private val eventsBody =
        """
        {"vehicle_id":7,"events":[{"id":1,"vehicle_id":7,"ts":"2026-01-01T00:00:00Z",
          "event_type":"state_changed","acknowledged_at":null}]}
        """.trimIndent()

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpGuardRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpGuardRepository(api, store)
    }

    private suspend fun captureRead(
        body: String,
        call: (HttpGuardRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + caching ----------------------------------------------------

    @Test
    fun guardConfigHitsVehicleGuardAndCachesUnderConfigKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = configBody)
            val emissions = r.guardConfig("7").toList()

            val success = emissions.last() as Resource.Success
            assertEquals(7L, success.data.vehicleId)
            assertEquals("high", success.data.sensitivity)
            assertEquals(3L, success.data.homeGeofenceId)
            assertTrue(store.read(CacheDomain.Guard, guardConfigKey("7")) != null)
        }

    @Test
    fun guardConfigUsesTheExactWebPath() =
        runTestBlocking {
            val url = captureRead(configBody) { it.guardConfig("7") }
            assertEquals("/api/v1/vehicles/7/guard", url.encodedPath)
        }

    @Test
    fun guardEventsHitsEventsAndCachesUnderEventsKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = eventsBody)
            val emissions = r.guardEvents("7").toList()

            val success = emissions.last() as Resource.Success
            assertEquals(7L, success.data.vehicleId)
            assertEquals(1, success.data.events.size)
            assertTrue(store.read(CacheDomain.Guard, guardEventsKey("7")) != null)
        }

    @Test
    fun guardEventsUsesTheExactWebPath() =
        runTestBlocking {
            val url = captureRead(eventsBody) { it.guardEvents("7") }
            assertEquals("/api/v1/vehicles/7/guard/events", url.encodedPath)
        }

    // ---- setGuardConfig: POST body + cache intact ---------------------------------

    @Test
    fun setGuardConfigPostsAllFourBodyKeysAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Guard, guardConfigKey("7"), "{}", 1)
            store.putRaw(CacheDomain.Guard, guardEventsKey("7"), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = """{"config":$configBody,"arm_results":{"door":"locked"}}""") { seen = it }

            val result =
                r.setGuardConfig(
                    SetGuardConfigInput(
                        vehicleId = "7",
                        enabled = true,
                        homeGeofenceId = 3,
                        sensitivity = "high",
                        autoPanic = true,
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/vehicles/7/guard", req.url.encodedPath)
            val body = json.parseToJsonElement((req.body as TextContent).text) as JsonObject
            assertTrue(body["enabled"]!!.jsonPrimitive.content.toBoolean())
            assertEquals("3", body["home_geofence_id"]!!.jsonPrimitive.content)
            assertEquals("high", body["sensitivity"]!!.jsonPrimitive.content)
            assertTrue(body["auto_panic"]!!.jsonPrimitive.content.toBoolean())
            assertEquals(7L, result.getOrThrow().config.vehicleId)
            // Cache is intentionally left intact — invalidation is the S8 store's targeted refresh.
            assertEquals(2, store.size())
        }

    @Test
    fun setGuardConfigSendsExplicitNullForMissingHomeGeofence() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"config":$configBody}""") { seen = it }

            r.setGuardConfig(
                SetGuardConfigInput(
                    vehicleId = "7",
                    enabled = false,
                    homeGeofenceId = null,
                    sensitivity = "low",
                    autoPanic = false,
                ),
            )

            val body = json.parseToJsonElement((requireNotNull(seen).body as TextContent).text) as JsonObject
            // Web `JSON.stringify` carries an explicit null, not a dropped key.
            assertTrue(body.containsKey("home_geofence_id"))
            assertEquals(JsonNull, body["home_geofence_id"])
        }

    // ---- triggerPanic / acknowledge: POST path + cache intact ---------------------

    @Test
    fun triggerPanicPostsToPanicAndLeavesCacheIntact() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Guard, guardEventsKey("7"), "{}", 1)
            var seen: HttpRequestData? = null
            val r = repo(store, body = """{"command_results":{},"notified_channels":[],"event_id":99}""") { seen = it }

            val result = r.triggerPanic("7")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/vehicles/7/guard/panic", req.url.encodedPath)
            assertEquals(99L, result.getOrThrow().eventId)
            assertEquals(1, store.size())
        }

    @Test
    fun acknowledgeGuardEventPostsToTheEventAcknowledgePath() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"status":"acknowledged"}""") { seen = it }

            val result = r.acknowledgeGuardEvent("7", 42)

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/vehicles/7/guard/events/42/acknowledge", req.url.encodedPath)
            assertEquals("acknowledged", result.getOrThrow().status)
        }

    @Test
    fun mutationFailureLeavesCacheIntactAndReturnsFailure() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Guard, guardEventsKey("7"), "{}", 1)
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpGuardRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), store)

            val result = r.triggerPanic("7")

            assertTrue(result.isFailure)
            assertTrue(store.read(CacheDomain.Guard, guardEventsKey("7")) != null)
        }
}
