package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.cache.newTestCache
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks each repository's request to the path declared by the generated OpenAPI
 * contract (`ApiEndpoints`), so a path/query regression is caught at build time rather
 * than as a silent always-fails refresh in production.
 */
class RepositoryContractTest {
    private suspend fun capture(
        body: String,
        call: suspend (ApiHttpClient) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val engine =
            MockEngine { request ->
                url = request.url
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api = buildApiHttpClient(engine, testConfig())
        call(api).toList()
        return url!!
    }

    @Test
    fun vehiclesHitsVehiclesRoot() =
        runTestBlocking {
            val url = capture("[]") { VehicleRepository(it, newTestCache().store).vehicles() }
            assertEquals("/api/v1/vehicles/", url.encodedPath)
        }

    @Test
    fun vehicleStateHitsPerVehicleState() =
        runTestBlocking {
            val url = capture("{}") { VehicleStateRepository(it, newTestCache().store).state(7) }
            assertEquals("/api/v1/vehicles/7/state", url.encodedPath)
        }

    @Test
    fun drivesHitsDrivesWithVehicleIdQuery() =
        runTestBlocking {
            val url = capture("[]") { DriveRepository(it, newTestCache().store).drives(7) }
            assertEquals("/api/v1/drives/", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun chargingHitsChargingSessionsWithVehicleIdQuery() =
        runTestBlocking {
            val url = capture("[]") { HttpChargingRepository(it, newTestCache().store).sessions(7) }
            assertEquals("/api/v1/charging-sessions", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
        }

    @Test
    fun energySummaryHitsAnalyticsEnergy() =
        runTestBlocking {
            val url = capture("[]") { EnergySummaryRepository(it, newTestCache().store).summary() }
            assertEquals("/api/v1/analytics/energy", url.encodedPath)
        }

    @Test
    fun analyticsFleetHitsAnalyticsFleet() =
        runTestBlocking {
            val url = capture("{}") { HttpAnalyticsRepository(it, newTestCache().store).fleetAnalytics() }
            assertEquals("/api/v1/analytics/fleet", url.encodedPath)
        }

    @Test
    fun notificationsHitsNotificationsRoot() =
        runTestBlocking {
            val url = capture("{}") { NotificationRepository(it, newTestCache().store).feed() }
            assertEquals("/api/v1/notifications/", url.encodedPath)
        }

    @Test
    fun signalsHitsPerVehicleAvailable() =
        runTestBlocking {
            val url = capture("{}") { HttpSignalsRepository(it, newTestCache().store).availableSignals(7) }
            assertEquals("/api/v1/signals/7/available", url.encodedPath)
        }

    @Test
    fun cachedPayloadKeepsSiSerialNamesAndNoLegacySuffixes() =
        runTestBlocking {
            val driveJson =
                """
                [{"id":1,"vehicle_id":7,"distance_m":1234.5,"duration_s":600,
                  "start_ts":"2026-01-01T00:00:00Z","created_at":"2026-01-01T00:00:00Z",
                  "updated_at":"2026-01-01T00:10:00Z","avg_speed_mps":2.06,
                  "max_speed_mps":5.0,"energy_used_wh":3400.0}]
                """.trimIndent()
            val store = MapCacheStore()
            val engine = MockEngine { respond(driveJson, HttpStatusCode.OK, jsonHeaders) }
            val api = buildApiHttpClient(engine, testConfig())

            DriveRepository(api, store).drives(7).toList()

            val payload = store.read(CacheDomain.Drives, "7")?.payload ?: ""
            // SI serial names are persisted verbatim — no conversion at the cache boundary.
            assertTrue(payload.contains("distance_m"))
            assertTrue(payload.contains("avg_speed_mps"))
            assertTrue(payload.contains("energy_used_wh"))
            // Legacy imperial-suffixed names must never appear in a cached row.
            assertFalse(payload.contains("_mph"))
            assertFalse(payload.contains("distance_mi"))
            assertFalse(payload.contains("_kwh"))
        }
}
