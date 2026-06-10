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
import io.teslasync.shared.core.presentation.driving.TripLocation
import io.teslasync.shared.core.presentation.driving.TripPlanRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpDrivingRepository] call to the exact endpoint/method/params/body the web
 * `useDriving` hooks issue (web/src/api/hooks/useDriving.ts), against the generated OpenAPI
 * contract (`ApiEndpoints`). A path/param/body regression is caught at build time instead of as a
 * silently-broken Driving screen.
 */
class DrivingRepositoryContractTest {
    private val json = Json

    private val driveBody =
        "{\"id\":1,\"vehicle_id\":7,\"distance_m\":1234.5,\"duration_s\":600," +
            "\"start_ts\":\"2026-01-01T00:00:00Z\",\"created_at\":\"2026-01-01T00:00:00Z\"," +
            "\"updated_at\":\"2026-01-01T00:10:00Z\",\"avg_speed_mps\":2.06," +
            "\"max_speed_mps\":5.0,\"energy_used_wh\":3400.0}"
    private val driveListBody = "[$driveBody]"
    private val telemetryListBody =
        "[{\"id\":1,\"drive_id\":5,\"vehicle_id\":7,\"created_at\":\"2026-01-01T00:00:00Z\",\"speed\":2.06,\"power\":1000.0}]"

    private val driftedDriveBody =
        "[{\"id\":\"not-a-number\",\"vehicle_id\":7,\"distance_m\":1.0,\"duration_s\":1," +
            "\"start_ts\":\"2026-01-01T00:00:00Z\",\"created_at\":\"2026-01-01T00:00:00Z\"," +
            "\"updated_at\":\"2026-01-01T00:00:00Z\"}]"

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "[]",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpDrivingRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpDrivingRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "[]",
        call: (HttpDrivingRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private fun bodyOf(req: HttpRequestData): JsonObject = json.parseToJsonElement((req.body as TextContent).text) as JsonObject

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun drivesHitsDrivesRootWithVehicleIdAndDecodesTypedRows() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = driveListBody)
            val emissions = r.drives("7").toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals(1L, success.data.first().id)
            assertEquals(1234.5, success.data.first().distanceM)
            assertTrue(store.read(CacheDomain.Drives, drivesKey("7")) != null)

            val url = captureRead(driveListBody) { it.drives("7") }
            assertEquals("/api/v1/drives/", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun driveDetailHitsPerDriveAndCachesUnderDriveFamilyKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val url = captureRead(driveBody) { it.drive("5") }
            assertEquals("/api/v1/drives/5/", url.encodedPath)

            val r = repo(store, body = driveBody)
            r.drive("5").toList()
            assertTrue(store.read(CacheDomain.Drives, driveDetailKey("5")) != null)
        }

    @Test
    fun driveScoreStatsDynamicsAccelHitDrivesSubpathsWithVehicleId() =
        runTestBlocking {
            assertEquals("/api/v1/drives/score", captureRead("{}") { it.driveScore("7") }.encodedPath)
            assertEquals("7", captureRead("{}") { it.driveScore("7") }.parameters["vehicle_id"])
            assertEquals("/api/v1/drives/stats", captureRead("{}") { it.drivingStats("7") }.encodedPath)
            assertEquals("/api/v1/drives/dynamics", captureRead("{}") { it.drivingDynamics("7") }.encodedPath)
            assertEquals(
                "/api/v1/drives/acceleration-distribution",
                captureRead("{}") { it.accelerationDistribution("7") }.encodedPath,
            )
        }

    @Test
    fun drivetrainHealthHitsDrivetrainHealthWithVehicleId() =
        runTestBlocking {
            val url = captureRead("{}") { it.drivetrainHealth("7") }
            assertEquals("/api/v1/drivetrain/health", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun analyticsRangeReadsSendVehicleAndOptionalRange() =
        runTestBlocking {
            val noRange = captureRead("{}") { it.speedProfile("7") }
            assertEquals("/api/v1/analytics/speed-profile", noRange.encodedPath)
            assertEquals("7", noRange.parameters["vehicle_id"])
            assertNull(noRange.parameters["start"])

            val ranged = captureRead("{}") { it.regenEfficiency("7", start = "2026-01-01", end = "2026-02-01") }
            assertEquals("/api/v1/analytics/regen", ranged.encodedPath)
            assertEquals("2026-01-01", ranged.parameters["start"])
            assertEquals("2026-02-01", ranged.parameters["end"])

            val route = captureRead("{}") { it.routeEfficiency("7") }
            assertEquals("/api/v1/analytics/route-efficiency", route.encodedPath)

            // Blank range slots are dropped (truthy guard parity).
            val blank = captureRead("{}") { it.speedProfile("7", start = "", end = "") }
            assertNull(blank.parameters["start"])
            assertNull(blank.parameters["end"])
        }

    @Test
    fun positionsAndTelemetryHitPerDriveSubpaths() =
        runTestBlocking {
            assertEquals("/api/v1/drives/5/positions", captureRead("[]") { it.drivePositions("5") }.encodedPath)

            val store = MapCacheStore()
            val r = repo(store, body = telemetryListBody)
            val url = captureRead(telemetryListBody) { it.driveTelemetry("5") }
            assertEquals("/api/v1/drives/5/telemetry", url.encodedPath)

            val emissions = r.driveTelemetry("5").toList()
            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals(5L, success.data.first().driveId)
        }

    @Test
    fun drivingCoachSendsVehicleAndDays() =
        runTestBlocking {
            val url = captureRead("{}") { it.drivingCoach("7", days = 45) }
            assertEquals("/api/v1/analytics/driving-coach", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
            assertEquals("45", url.parameters["days"])
            // Default is 30.
            assertEquals("30", captureRead("{}") { it.drivingCoach("7") }.parameters["days"])
        }

    @Test
    fun geocodeSearchSendsQueryAndFixedLimit() =
        runTestBlocking {
            val url = captureRead("[]") { it.geocodeSearch("San Francisco") }
            assertEquals("/api/v1/geocode/search", url.encodedPath)
            assertEquals("San Francisco", url.parameters["q"])
            assertEquals("5", url.parameters["limit"])
        }

    @Test
    fun whyEndedSendsWindow() =
        runTestBlocking {
            val url = captureRead("{}") { it.driveWhyEnded("5", window = "5m") }
            assertEquals("/api/v1/drives/5/why-ended", url.encodedPath)
            assertEquals("5m", url.parameters["window"])
            // Default window is 60s.
            assertEquals("60s", captureRead("{}") { it.driveWhyEnded("5") }.parameters["window"])
        }

    // ---- Mutations: method + path + body ------------------------------------------

    @Test
    fun planTripPostsBodyDroppingNullOptionals() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = "{}") { seen = it }

            val result =
                r.planTrip(
                    TripPlanRequest(
                        vehicleId = 7,
                        origin = TripLocation(lat = 37.0, lng = -122.0, name = "Home"),
                        destination = TripLocation(lat = 34.0, lng = -118.0, name = "LA"),
                        currentSoc = 90,
                        chargeLimitSoc = 90,
                        minArrivalSoc = 10,
                    ),
                )

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/trip-planner/plan", req.url.encodedPath)
            val body = bodyOf(req)
            assertEquals(7, body["vehicle_id"]!!.jsonPrimitive.content.toInt())
            assertEquals(90, body["current_soc"]!!.jsonPrimitive.int)
            assertEquals("Home", body["origin"]!!.jsonObject["name"]!!.jsonPrimitive.content)
            // Null optionals dropped (explicitNulls = false → web JSON.stringify parity).
            assertFalse(body.containsKey("waypoints"))
            assertFalse(body.containsKey("departure_time"))
            assertFalse(body.containsKey("preferences"))
        }

    @Test
    fun bulkDeleteSendsDeleteWithIdsBody() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = """{"deleted":2}""") { seen = it }

            val result = r.bulkDeleteDrives(listOf(1, 2))

            assertTrue(result.isSuccess)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/drives/bulk", req.url.encodedPath)
            assertEquals(listOf("1", "2"), bodyOf(req)["ids"]!!.jsonArray.map { it.jsonPrimitive.content })
        }

    @Test
    fun mutationFailureReturnsFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpDrivingRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), MapCacheStore())

            val result = r.bulkDeleteDrives(listOf(1))

            assertTrue(result.isFailure)
        }

    @Test
    fun successBodyThatNoLongerMatchesDtoSurfacesAsError() =
        runTestBlocking {
            // A 2xx whose shape drifted (id is not a number) is a contract error, surfaced as
            // Resource.Error WITHOUT throwing across the flow boundary.
            val r = repo(body = driftedDriveBody)
            val emissions = r.drives("7").toList()
            assertTrue(emissions.last() is Resource.Error)
        }
}
