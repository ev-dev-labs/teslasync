package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.CacheDomain
import io.teslasync.shared.core.cache.MapCacheStore
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks the [HttpDashboardRepository] read to the exact endpoint/method the web `useDashboardStats`
 * hook issues (web/src/api/hooks/useDashboard.ts). A path regression — e.g. a double `/api/v1`
 * prefix — is caught at build time instead of as a silently-always-failing Dashboard screen in
 * production, and the typed [DashboardStats] shape (SI fields) is asserted to round-trip.
 */
class DashboardRepositoryContractTest {
    private val body =
        """
        {
          "totalVehicles": 3,
          "totalM": 1234567.0,
          "totalEnergyWh": 89000.0,
          "totalChargingSessions": 42,
          "totalTrips": 128,
          "avgEfficiency": 0.18,
          "totalCostCents": 9900
        }
        """.trimIndent()

    private fun repo(
        respondBody: String = body,
        onRequest: (Url) -> Unit = {},
    ): HttpDashboardRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(respondBody, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpDashboardRepository(api, MapCacheStore())
    }

    @Test
    fun statsHitsDashboardStats() =
        runTestBlocking {
            var url: Url? = null
            val r = repo { url = it }
            r.stats().toList()
            val captured = url!!
            assertEquals("/api/v1/dashboard/stats", captured.encodedPath)
            // No query params — the web hook passes only `{ signal }`.
            assertTrue(captured.parameters.isEmpty())
        }

    @Test
    fun readEmitsCacheThenNetworkSuccess() =
        runTestBlocking {
            val emissions = repo().stats().toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            val last = emissions.last()
            assertTrue(last is Resource.Success, "terminal emission is the network success")
            assertEquals(3, last.data.totalVehicles)
            assertEquals(1234567.0, last.data.totalM)
            assertEquals(89000.0, last.data.totalEnergyWh)
            assertEquals(42, last.data.totalChargingSessions)
            assertEquals(128, last.data.totalTrips)
            assertEquals(0.18, last.data.avgEfficiency)
            assertEquals(9900, last.data.totalCostCents)
        }

    @Test
    fun partialPayloadDecodesWithSafeZeroDefaults() =
        runTestBlocking {
            val partial = """{"totalVehicles":2}"""
            val emissions = repo(respondBody = partial).stats().toList()
            val last = emissions.last()
            assertTrue(last is Resource.Success)
            assertEquals(2, last.data.totalVehicles)
            assertEquals(0.0, last.data.totalM)
            assertEquals(0, last.data.totalCostCents)
        }

    @Test
    fun cachedPayloadKeepsSiSerialNamesAndNoLegacySuffixes() =
        runTestBlocking {
            val store = MapCacheStore()
            val engine = MockEngine { respond(body, HttpStatusCode.OK, jsonHeaders) }
            val api = buildApiHttpClient(engine, testConfig())

            HttpDashboardRepository(api, store).stats().toList()

            val payload = store.read(CacheDomain.Dashboard, "stats")?.payload ?: ""
            // SI serial names are persisted verbatim — no conversion at the cache boundary.
            assertTrue(payload.contains("totalM"))
            assertTrue(payload.contains("totalEnergyWh"))
            // Legacy imperial-suffixed names must never appear in a cached row.
            assertFalse(payload.contains("_mi"))
            assertFalse(payload.contains("_mph"))
            assertFalse(payload.contains("_kwh"))
        }
}
