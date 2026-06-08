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
import io.teslasync.shared.core.presentation.charging.ApplyScheduleInput
import io.teslasync.shared.core.presentation.charging.OptimizeChargeInput
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpChargingRepository] call to the exact endpoint/method/params/body the web
 * `useCharging` hooks issue (web/src/api/hooks/useCharging.ts). A path/param/body regression is
 * caught at build time instead of as a silently-broken Charging screen.
 */
class ChargingRepositoryContractTest {
    private val json = Json

    private val sessionBody =
        """{"id":5,"started_at":"2026-01-01T00:00:00Z","vehicle_id":7,"total_energy_added_wh":12000.0}"""
    private val sessionListBody = "[$sessionBody]"
    private val telemetryListBody =
        """[{"ts":"2026-01-01T00:00:00Z","vehicle_id":7,"dc_charging_power_w":48000.0}]"""

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpChargingRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpChargingRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpChargingRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private fun bodyOf(req: HttpRequestData): JsonObject = json.parseToJsonElement((req.body as TextContent).text) as JsonObject

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun sessionsHitsChargingSessionsWithVehicleId() =
        runTestBlocking {
            val url = captureRead(sessionListBody) { it.sessions(7) }
            assertEquals("/api/v1/charging-sessions", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun sessionsDecodesTypedRowsAndCachesUnderByVehicleKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = sessionListBody)
            val emissions = r.sessions(7).toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals(5L, success.data.first().id)
            assertEquals(12000.0, success.data.first().totalEnergyAddedWh)
            assertTrue(store.read(CacheDomain.Charging, chargingSessionsKey(7)) != null)
        }

    @Test
    fun sessionHitsChargingByStringIdAndCachesUnderDetailKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = sessionBody)
            val emissions = r.session("5").toList()

            assertEquals(5L, (emissions.last() as Resource.Success).data.id)
            assertTrue(store.read(CacheDomain.Charging, chargingSessionDetailKey("5")) != null)
        }

    @Test
    fun sessionUrlByStringId() =
        runTestBlocking {
            val url = captureRead(sessionBody) { it.session("5") }
            assertEquals("/api/v1/charging/5", url.encodedPath)
        }

    @Test
    fun sessionDetailHitsChargingByNumericIdAndCachesUnderSingularKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = sessionBody)
            val emissions = r.sessionDetail(5).toList()

            assertEquals(5L, (emissions.last() as Resource.Success).data.id)
            // Singular key — distinct from the string-id detail so a bulk delete won't touch it.
            assertTrue(store.read(CacheDomain.Charging, chargingSessionByIdKey(5)) != null)
            assertNull(store.read(CacheDomain.Charging, chargingSessionDetailKey("5")))
        }

    @Test
    fun chargeTelemetryHitsPerSessionTelemetry() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = telemetryListBody)
            val url = captureRead(telemetryListBody) { it.chargeTelemetry(5) }
            assertEquals("/api/v1/charging/5/telemetry", url.encodedPath)

            val emissions = r.chargeTelemetry(5).toList()
            assertEquals(1, (emissions.last() as Resource.Success).data.size)
        }

    @Test
    fun paginatedSendsVehicleLimitOffsetAndOptionalRange() =
        runTestBlocking {
            val all = captureRead(sessionListBody) { it.sessionsPaginated(7, limit = 25, offset = 50) }
            assertEquals("/api/v1/charging", all.encodedPath)
            assertEquals("7", all.parameters["vehicle_id"])
            assertEquals("25", all.parameters["limit"])
            assertEquals("50", all.parameters["offset"])
            assertNull(all.parameters["start"])

            val ranged =
                captureRead(sessionListBody) {
                    it.sessionsPaginated(7, start = "2026-01-01", end = "2026-02-01")
                }
            assertEquals("2026-01-01", ranged.parameters["start"])
            assertEquals("2026-02-01", ranged.parameters["end"])
        }

    @Test
    fun paginatedDropsBlankRange() =
        runTestBlocking {
            val url = captureRead(sessionListBody) { it.sessionsPaginated(7, start = "", end = "") }
            assertNull(url.parameters["start"])
            assertNull(url.parameters["end"])
        }

    @Test
    fun costForecastSendsVehicleAndMonths() =
        runTestBlocking {
            val url = captureRead("{}") { it.costForecast("7", months = 12) }
            assertEquals("/api/v1/analytics/cost-forecast", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
            assertEquals("12", url.parameters["months"])
        }

    @Test
    fun chargingOptimizerSendsVehicle() =
        runTestBlocking {
            val url = captureRead("{}") { it.chargingOptimizer("7") }
            assertEquals("/api/v1/analytics/charging-optimizer", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun teslaHistoryOmitsVinWhenAbsentAndSendsWhenPresent() =
        runTestBlocking {
            val none = captureRead("{}") { it.teslaChargingHistory() }
            assertEquals("/api/v1/tesla/charging/history", none.encodedPath)
            assertNull(none.parameters["vin"])

            val withVin = captureRead("{}") { it.teslaChargingHistory("VIN1") }
            assertEquals("VIN1", withVin.parameters["vin"])
        }

    @Test
    fun teslaSessionsOmitsVinWhenAbsentAndSendsWhenPresent() =
        runTestBlocking {
            val none = captureRead("{}") { it.teslaChargingSessions() }
            assertEquals("/api/v1/tesla/charging/sessions", none.encodedPath)
            assertNull(none.parameters["vin"])

            val withVin = captureRead("{}") { it.teslaChargingSessions("VIN1") }
            assertEquals("VIN1", withVin.parameters["vin"])
        }

    @Test
    fun chargePlansSendsVehicle() =
        runTestBlocking {
            val url = captureRead("[]") { it.chargePlans(7) }
            assertEquals("/api/v1/charge-planner/history", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun ratePlansHitsRatePlans() =
        runTestBlocking {
            val url = captureRead("[]") { it.ratePlans() }
            assertEquals("/api/v1/charge-planner/rate-plans", url.encodedPath)
        }

    // ---- Mutations: method + path + query/body ------------------------------------

    @Test
    fun refreshTeslaHistoryPostsWithOptionalQuery() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "{}") { seen = it }

            val result = r.refreshTeslaChargingHistory(vin = "VIN1", startTime = "2026-01-01")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/tesla/charging/history/refresh", req.url.encodedPath)
            assertEquals("VIN1", req.url.parameters["vin"])
            assertEquals("2026-01-01", req.url.parameters["start_time"])
            assertNull(req.url.parameters["end_time"])
        }

    @Test
    fun refreshTeslaSessionsPostsWithOptionalQuery() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "{}") { seen = it }

            val result = r.refreshTeslaChargingSessions(dateFrom = "2026-02-01", dateTo = "2026-03-01")

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/tesla/charging/sessions/refresh", req.url.encodedPath)
            assertNull(req.url.parameters["vin"])
            assertEquals("2026-02-01", req.url.parameters["date_from"])
            assertEquals("2026-03-01", req.url.parameters["date_to"])
        }

    @Test
    fun optimizePostsBodyDroppingNullKnobs() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "{}") { seen = it }

            val result =
                r.optimizeCharge(
                    OptimizeChargeInput(
                        vehicleId = 7,
                        targetSoc = 80,
                        departBy = "2026-06-15T07:00:00Z",
                        ratePlanId = "pge-ev2a",
                        maxAmps = 32,
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/charge-planner/optimize", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals(7, body["vehicle_id"]!!.jsonPrimitive.content.toInt())
            assertEquals(80, body["target_soc"]!!.jsonPrimitive.int)
            assertEquals("pge-ev2a", body["rate_plan_id"]!!.jsonPrimitive.content)
            assertEquals(32, body["max_amps"]!!.jsonPrimitive.int)
            // null knobs dropped (explicitNulls = false → web JSON.stringify parity).
            assertFalse(body.containsKey("battery_capacity_kwh"))
            assertFalse(body.containsKey("charger_voltage"))
            assertFalse(body.containsKey("prefer_off_peak"))
        }

    @Test
    fun applyPostsPlanId() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "{}") { seen = it }

            val result = r.applySchedule(ApplyScheduleInput(planId = 42))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/charge-planner/apply", req.url.encodedPath)
            assertEquals(42, bodyOf(req)["plan_id"]!!.jsonPrimitive.content.toInt())
        }

    @Test
    fun bulkDeleteSendsDeleteWithIdsBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"deleted":2}""") { seen = it }

            val result = r.bulkDeleteCharging(listOf(1, 2))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/charging/bulk", req.url.encodedPath)
            assertEquals(listOf("1", "2"), bodyOf(req)["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        }

    @Test
    fun mutationFailureReturnsFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpChargingRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), MapCacheStore())

            val result = r.bulkDeleteCharging(listOf(1))

            assertTrue(result.isFailure)
        }

    @Test
    fun successBodyThatNoLongerMatchesDtoSurfacesAsError() =
        runTestBlocking {
            // A 2xx whose shape drifted (id is not a number) is a contract error, surfaced as
            // Resource.Error WITHOUT throwing across the flow boundary.
            val r = repo(body = """[{"id":"not-a-number","started_at":"2026-01-01T00:00:00Z","vehicle_id":7}]""")
            val emissions = r.sessions(7).toList()
            assertTrue(emissions.last() is Resource.Error)
        }
}
