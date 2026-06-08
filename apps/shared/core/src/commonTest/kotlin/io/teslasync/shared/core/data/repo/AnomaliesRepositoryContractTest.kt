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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks [HttpAnomaliesRepository]'s read to the exact endpoint/method/params the web `useAnomalies`
 * hook issues (web/src/api/hooks/useAnomalies.ts). A path/param regression — e.g. a double
 * `/api/v1` prefix, a camelCase `vehicleId`, or a missing `days` — is caught at build time instead
 * of as a silently-always-failing Anomalies screen in production.
 */
class AnomaliesRepositoryContractTest {
    private fun repo(
        body: String = "{}",
        onRequest: (Url) -> Unit = {},
    ): HttpAnomaliesRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpAnomaliesRepository(api, MapCacheStore())
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpAnomaliesRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it }
        call(r).toList()
        return url!!
    }

    @Test
    fun anomaliesHitsAnalyticsAnomaliesWithSnakeCaseParams() =
        runTestBlocking {
            val url = captureRead { it.anomalies("7") }
            assertEquals("/api/v1/analytics/anomalies", url.encodedPath)
            assertEquals("7", url.parameters["vehicle_id"])
            // Default window mirrors the web hook's `days = 7`.
            assertEquals("7", url.parameters["days"])
            assertFalse(url.parameters.contains("vehicleId"), "param must be snake_case")
        }

    @Test
    fun anomaliesPassesExplicitDays() =
        runTestBlocking {
            val url = captureRead { it.anomalies("42", days = 30) }
            assertEquals("/api/v1/analytics/anomalies", url.encodedPath)
            assertEquals("42", url.parameters["vehicle_id"])
            assertEquals("30", url.parameters["days"])
        }

    @Test
    fun readEmitsCacheThenNetworkSuccess() =
        runTestBlocking {
            val r = repo(body = "{\"signals_monitored\":0,\"anomalies\":[]}")
            val emissions = r.anomalies("7").toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            assertTrue(emissions.last() is Resource.Success, "terminal emission is the network success")
        }

    @Test
    fun cachedPayloadKeepsSiValuesVerbatim() =
        runTestBlocking {
            // The anomaly report is SI on the wire (raw signal value, baseline, z-score) and must
            // round-trip through the cache unchanged — no conversion at the cache boundary.
            val body =
                """
                {"signals_monitored":12,"anomalies_last_7d":3,"anomalies_last_24h":1,
                 "health_summary":{"battery_level":"ok"},
                 "anomalies":[{"signal":"battery_level","type":"z_score","severity":"warning",
                   "value":3400.0,"baseline":3300.0,"z_score":2.4,
                   "detected_at":"2026-01-01T00:00:00Z","message":"elevated"}]}
                """.trimIndent()
            val store = MapCacheStore()
            val engine = MockEngine { respond(body, HttpStatusCode.OK, jsonHeaders) }
            val api = buildApiHttpClient(engine, testConfig())

            HttpAnomaliesRepository(api, store).anomalies("7", days = 7).toList()

            val payload = store.read(CacheDomain.Anomalies, "7:7")?.payload ?: ""
            assertTrue(payload.contains("\"z_score\":2.4"))
            assertTrue(payload.contains("\"baseline\":3300.0"))
            assertFalse(payload.contains("_mph"))
            assertFalse(payload.contains("_kwh"))
        }
}
