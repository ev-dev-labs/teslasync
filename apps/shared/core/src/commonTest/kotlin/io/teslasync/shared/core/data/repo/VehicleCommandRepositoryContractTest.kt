package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import io.teslasync.shared.core.presentation.vehiclecommand.SendVehicleCommandInput
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks [HttpVehicleCommandRepository]'s single mutation to the exact endpoint/method/body the web
 * `useVehicleCommand` hook issues (web/src/api/hooks/useVehicleCommand.ts) and verifies that a 2xx
 * reply evicts the four cache surfaces the web hook's `onSuccess` invalidates while a failure leaves
 * them untouched. A path/method/body regression — e.g. a double `/api/v1` prefix, a wrong segment,
 * a leaked `vehicleId` into the body, or a forgotten invalidation — is caught at build time instead
 * of as a silently-broken command surface in production.
 */
class VehicleCommandRepositoryContractTest {
    private val json = Json

    private val okBody = """{"success":true,"message":"Command sent"}"""

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = okBody,
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpVehicleCommandRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpVehicleCommandRepository(api, store)
    }

    private fun bodyOf(req: HttpRequestData): JsonObject = json.parseToJsonElement((req.body as TextContent).text) as JsonObject

    /** Seeds the four cache surfaces a command can change, so eviction is observable. */
    private fun MapCacheStore.seedSurfaces(vehicleId: Long) {
        putRaw(CacheDomain.VehicleState, vehicleId.toString(), "{}", 1L)
        putRaw(CacheDomain.Commands, commandLatestKey(vehicleId.toString()), "[]", 1L)
        putRaw(CacheDomain.Commands, commandHistoryKey(vehicleId.toString()), "[]", 1L)
        putRaw(CacheDomain.Vehicles, "all", "[]", 1L)
    }

    @Test
    fun postsToPerVehicleCommandEndpointWithMethodPost() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            repo(onRequest = { seen = it }).sendCommand(SendVehicleCommandInput(vehicleId = 7, command = "wake_up"))

            val req = assertNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/vehicles/7/command", req.url.encodedPath)
        }

    @Test
    fun bodyCarriesCommandAndOmitsParamsWhenNull() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            repo(onRequest = { seen = it }).sendCommand(SendVehicleCommandInput(vehicleId = 7, command = "wake_up"))

            val body = bodyOf(assertNotNull(seen))
            assertEquals("wake_up", body["command"]?.jsonPrimitive?.content)
            // vehicleId is a path segment only — it must never leak into the body.
            assertFalse(body.containsKey("vehicleId"))
            assertFalse(body.containsKey("vehicle_id"))
            // A null params is dropped entirely, mirroring `JSON.stringify` omitting `undefined`.
            assertFalse(body.containsKey("params"))
        }

    @Test
    fun bodyCarriesParamsWhenPresent() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val params = buildJsonObject { put("temp", 21) }
            repo(onRequest = { seen = it })
                .sendCommand(SendVehicleCommandInput(vehicleId = 9, command = "set_temp", params = params))

            val body = bodyOf(assertNotNull(seen))
            assertEquals("set_temp", body["command"]?.jsonPrimitive?.content)
            assertEquals(params, body["params"])
        }

    @Test
    fun successReturnsTheParsedCommandResult() =
        runTestBlocking {
            val result = repo().sendCommand(SendVehicleCommandInput(vehicleId = 7, command = "wake_up"))
            val value = result.getOrNull()
            assertNotNull(value)
            assertTrue(value.success)
            assertEquals("Command sent", value.message)
        }

    @Test
    fun successInvalidatesTheFourCacheSurfaces() =
        runTestBlocking {
            val store = MapCacheStore()
            store.seedSurfaces(7)
            // An unrelated vehicle's surfaces must survive (the per-key deletes are vehicle-scoped;
            // only the broad vehicle-list partition is cleared wholesale, matching `vehicleKeys.all`).
            store.putRaw(CacheDomain.VehicleState, "99", "{}", 1L)
            store.putRaw(CacheDomain.Commands, commandLatestKey("99"), "[]", 1L)

            repo(store = store).sendCommand(SendVehicleCommandInput(vehicleId = 7, command = "wake_up"))

            assertNull(store.read(CacheDomain.VehicleState, "7"), "vehicle-state evicted")
            assertNull(store.read(CacheDomain.Commands, commandLatestKey("7")), "command-latest evicted")
            assertNull(store.read(CacheDomain.Commands, commandHistoryKey("7")), "command-history evicted")
            assertNull(store.read(CacheDomain.Vehicles, "all"), "vehicle list partition cleared")
            // Unrelated vehicle's per-key surfaces are untouched.
            assertNotNull(store.read(CacheDomain.VehicleState, "99"))
            assertNotNull(store.read(CacheDomain.Commands, commandLatestKey("99")))
        }

    @Test
    fun failureReturnsFailureAndLeavesCacheUntouched() =
        runTestBlocking {
            val store = MapCacheStore()
            store.seedSurfaces(7)
            val before = store.size()

            val result =
                repo(store = store, body = """{"error":"boom"}""", status = HttpStatusCode.InternalServerError)
                    .sendCommand(SendVehicleCommandInput(vehicleId = 7, command = "wake_up"))

            assertTrue(result.isFailure, "a non-2xx command yields Result.failure")
            // onSuccess never ran, so every seeded surface is still present.
            assertEquals(before, store.size())
            assertNotNull(store.read(CacheDomain.VehicleState, "7"))
            assertNotNull(store.read(CacheDomain.Commands, commandHistoryKey("7")))
        }
}
