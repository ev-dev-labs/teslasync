package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpVehiclesRepository] call to the exact endpoint/method/params the web
 * `useVehicles` hooks issue (web/src/api/hooks/useVehicles.ts), against the generated OpenAPI
 * contract. A path/param regression is caught at build time instead of as a silently-broken
 * Vehicles screen. Also pins the typed-decode boundaries: the list/detail decode to the SI [Vehicle]
 * DTO, the state read folds to a [io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope],
 * a drifted 2xx body surfaces as [Resource.Error] (no throw across the flow), and a mutation HTTP
 * failure surfaces as [Result.failure].
 */
class VehiclesRepositoryContractTest {
    private val vehicleBody =
        "{\"id\":7,\"display_name\":\"Car\",\"vin\":\"VIN7\",\"tesla_id\":1007,\"timezone\":\"UTC\"," +
            "\"created_at\":\"2026-01-01T00:00:00Z\",\"updated_at\":\"2026-01-01T00:10:00Z\"," +
            "\"enrolled_at\":\"2026-01-01T00:00:00Z\"}"
    private val vehicleListBody = "[$vehicleBody]"
    private val driftedVehicleListBody =
        "[{\"id\":\"not-a-number\",\"display_name\":\"Car\",\"vin\":\"VIN7\",\"tesla_id\":1007," +
            "\"timezone\":\"UTC\",\"created_at\":\"2026-01-01T00:00:00Z\"," +
            "\"updated_at\":\"2026-01-01T00:10:00Z\",\"enrolled_at\":\"2026-01-01T00:00:00Z\"}]"
    private val stateBody =
        "{\"live\":true,\"state\":{\"vehicle_id\":7,\"state\":\"online\",\"latitude\":0.0,\"longitude\":0.0," +
            "\"speed\":0.0,\"power\":0.0,\"battery_level\":80,\"rated_range\":400.0,\"ideal_range\":420.0," +
            "\"odometer\":0.0,\"inside_temp\":0.0,\"outside_temp\":0.0,\"is_climate_on\":false," +
            "\"is_charging\":false,\"charger_power\":0.0,\"charge_rate\":0.0,\"time_to_full_charge\":0.0," +
            "\"is_locked\":true,\"sentry_mode\":false,\"software_version\":\"x\"}}"

    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpVehiclesRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpVehiclesRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpVehiclesRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    private suspend fun captureMutation(
        body: String = "{}",
        call: suspend (HttpVehiclesRepository) -> Result<*>,
    ): HttpRequestData {
        var seen: HttpRequestData? = null
        val r = repo(body = body) { seen = it }
        val result = call(r)
        assertTrue(result.isSuccess, "mutation should succeed on 2xx")
        return requireNotNull(seen)
    }

    // ---- Reads: path + params + typed decode --------------------------------------

    @Test
    fun vehiclesHitsRootAndDecodesTypedRows() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = vehicleListBody)
            val emissions = r.vehicles().toList()

            val success = emissions.last() as Resource.Success
            assertEquals(1, success.data.size)
            assertEquals(7L, success.data.first().id)
            assertEquals("VIN7", success.data.first().vin)
            assertTrue(store.read(CacheDomain.VehicleInfo, vehiclesKey()) != null)

            val url = captureRead(vehicleListBody) { it.vehicles() }
            assertEquals("/api/v1/vehicles", url.encodedPath)
        }

    @Test
    fun vehicleDetailHitsPerVehicleAndDecodesTypedRow() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store, body = vehicleBody)
            val emissions = r.vehicle("7").toList()
            assertEquals(7L, (emissions.last() as Resource.Success).data.id)

            val url = captureRead(vehicleBody) { it.vehicle("7") }
            assertEquals("/api/v1/vehicles/7", url.encodedPath)
            assertTrue(store.read(CacheDomain.VehicleInfo, vehicleDetailKey("7")) != null)
        }

    @Test
    fun vehicleStateHitsStateSubpathFoldsEnvelopeAndGuardsAsOf() =
        runTestBlocking {
            val r = repo(body = stateBody)
            val success = r.vehicleState(7).toList().last() as Resource.Success
            assertTrue(success.data.live)
            val state = requireNotNull(success.data.state)
            assertEquals(7L, state.vehicleId)
            assertEquals("online", state.state)

            val live = captureRead(stateBody) { it.vehicleState(7) }
            assertEquals("/api/v1/vehicles/7/state", live.encodedPath)
            assertNull(live.parameters["as_of"])

            val historical = captureRead(stateBody) { it.vehicleState(7, asOf = "2026-01-01T00:00:00Z") }
            assertEquals("2026-01-01T00:00:00Z", historical.parameters["as_of"])
        }

    @Test
    fun positionsAndMotorHistorySendVehicleIdAndLimit() =
        runTestBlocking {
            val positions = captureRead("[]") { it.vehiclePositions(7) }
            assertEquals("/api/v1/vehicles/7/positions", positions.encodedPath)
            assertEquals("100", positions.parameters["limit"])

            val motorHistory = captureRead("[]") { it.motorHistory(7) }
            assertEquals("/api/v1/motor", motorHistory.encodedPath)
            assertEquals("7", motorHistory.parameters["vehicle_id"])
            assertEquals("200", motorHistory.parameters["limit"])
        }

    @Test
    fun latestProjectionsHitTheirPathsWithVehicleId() =
        runTestBlocking {
            val cases =
                listOf<Pair<String, (HttpVehiclesRepository) -> Flow<Resource<*>>>>(
                    "/api/v1/motor/latest" to { it.motorLatest(7) },
                    "/api/v1/drive-dynamics/latest" to { it.driveDynamicsLatest(7) },
                    "/api/v1/climate/latest" to { it.climateLatest(7) },
                    "/api/v1/security/latest" to { it.securityLatest(7) },
                    "/api/v1/tire-pressure/latest" to { it.latestTirePressure(7) },
                    "/api/v1/charging-telemetry/latest" to { it.chargingTelemetryLatest(7) },
                    "/api/v1/media/latest" to { it.mediaLatest(7) },
                    "/api/v1/location-snapshots/latest" to { it.locationSnapshotLatest(7) },
                    "/api/v1/vehicle-config/latest" to { it.vehicleConfigLatest(7) },
                    "/api/v1/user-preferences/latest" to { it.userPreferenceLatest(7) },
                )
            for ((path, call) in cases) {
                val url = captureRead("{}", call)
                assertEquals(path, url.encodedPath)
                assertEquals("7", url.parameters["vehicle_id"], "vehicle_id param for $path")
            }
        }

    @Test
    fun infoEnvelopesHitTheirSubpaths() =
        runTestBlocking {
            assertEquals("/api/v1/vehicles/7/mobile-enabled", captureRead("{}") { it.vehicleMobileEnabled("7") }.encodedPath)
            assertEquals("/api/v1/vehicles/7/options", captureRead("{}") { it.vehicleOptions("7") }.encodedPath)
            assertEquals("/api/v1/vehicles/7/specs", captureRead("{}") { it.vehicleSpecs("7") }.encodedPath)
            assertEquals("/api/v1/vehicles/7/subscriptions", captureRead("{}") { it.vehicleSubscriptions("7") }.encodedPath)
            assertEquals("/api/v1/vehicles/7/upgrades", captureRead("{}") { it.vehicleUpgrades("7") }.encodedPath)
            assertEquals("/api/v1/tesla/warranty", captureRead("{}") { it.warrantyDetails() }.encodedPath)
        }

    // ---- Mutations: method + path -------------------------------------------------

    @Test
    fun refreshVehiclePostsWakeAndDecodesTypedVehicle() =
        runTestBlocking {
            var seen: HttpRequestData? = null
            val r = repo(body = vehicleBody) { seen = it }
            val result = r.refreshVehicle("7")

            assertTrue(result.isSuccess)
            assertEquals(7L, result.getOrThrow().id)
            val req = requireNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/vehicles/7/wake", req.url.encodedPath)
        }

    @Test
    fun deleteVehicleSendsDeleteAndMapsToUnit() =
        runTestBlocking {
            val req = captureMutation { it.deleteVehicle(7) }
            assertEquals(HttpMethod.Delete, req.method)
            assertEquals("/api/v1/vehicles/7", req.url.encodedPath)
        }

    @Test
    fun syncAndWakePostTheirPaths() =
        runTestBlocking {
            val sync = captureMutation { it.syncVehicles() }
            assertEquals(HttpMethod.Post, sync.method)
            assertEquals("/api/v1/vehicles/sync", sync.url.encodedPath)

            val wake = captureMutation { it.wakeVehicle(7) }
            assertEquals(HttpMethod.Post, wake.method)
            assertEquals("/api/v1/vehicles/7/wake", wake.url.encodedPath)
        }

    @Test
    fun infoRefreshMutationsPostRefreshSubpaths() =
        runTestBlocking {
            assertEquals(
                "/api/v1/vehicles/7/mobile-enabled/refresh",
                captureMutation { it.refreshVehicleMobileEnabled("7") }.url.encodedPath,
            )
            assertEquals("/api/v1/vehicles/7/options/refresh", captureMutation { it.refreshVehicleOptions("7") }.url.encodedPath)
            assertEquals("/api/v1/vehicles/7/specs/refresh", captureMutation { it.refreshVehicleSpecs("7") }.url.encodedPath)
            assertEquals(
                "/api/v1/vehicles/7/subscriptions/refresh",
                captureMutation { it.refreshVehicleSubscriptions("7") }.url.encodedPath,
            )
            assertEquals("/api/v1/vehicles/7/upgrades/refresh", captureMutation { it.refreshVehicleUpgrades("7") }.url.encodedPath)
            assertEquals("/api/v1/tesla/warranty/refresh", captureMutation { it.refreshWarrantyDetails() }.url.encodedPath)
        }

    // ---- Decode/failure boundaries ------------------------------------------------

    @Test
    fun driftedSuccessBodySurfacesAsError() =
        runTestBlocking {
            val r = repo(body = driftedVehicleListBody)
            assertTrue(r.vehicles().toList().last() is Resource.Error)
        }

    @Test
    fun mutationFailureReturnsFailure() =
        runTestBlocking {
            val engine = MockEngine { respond("nope", HttpStatusCode.InternalServerError) }
            val r = HttpVehiclesRepository(buildApiHttpClient(engine, testConfig(maxRetries = 0)), MapCacheStore())

            assertTrue(r.syncVehicles().isFailure)
        }
}
