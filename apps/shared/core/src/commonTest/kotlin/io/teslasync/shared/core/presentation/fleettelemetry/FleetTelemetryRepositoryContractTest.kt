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
 * Locks [HttpFleetTelemetryRepository]'s read to the exact endpoint the web `useFleetTelemetryCoverage`
 * hook issues (web/src/api/hooks/useFleetTelemetry.ts). A path regression — e.g. a double `/api/v1`
 * prefix — is caught at build time instead of as a silently-always-failing Fleet-Telemetry screen
 * in production. Also asserts the `?? []` / `?? {}` normalization and the verbatim-SI cache round-trip.
 */
class FleetTelemetryRepositoryContractTest {
    private fun repo(
        body: String = "{}",
        onRequest: (Url) -> Unit = {},
    ): HttpFleetTelemetryRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpFleetTelemetryRepository(api, MapCacheStore())
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpFleetTelemetryRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it }
        call(r).toList()
        return url!!
    }

    @Test
    fun coverageHitsFleetTelemetryCoverageEndpoint() =
        runTestBlocking {
            val url = captureRead { it.coverage() }
            assertEquals("/api/v1/tesla/fleet-telemetry/coverage", url.encodedPath)
            assertFalse(url.encodedPath.contains("/api/v1/api/v1"), "no double /api/v1 prefix")
        }

    @Test
    fun readEmitsCacheThenNetworkSuccess() =
        runTestBlocking {
            val r = repo(body = "{\"categories\":[],\"destination_totals\":{},\"orphan_fields\":[]}")
            val emissions = r.coverage().toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            assertTrue(emissions.last() is Resource.Success, "terminal emission is the network success")
        }

    @Test
    fun missingAndNullCollectionsNormalizeToEmpty() =
        runTestBlocking {
            // The backend may omit or send explicit null for any of the three collections; the
            // normalized shape must default each to empty (web `?? []` / `?? {}`).
            val r = repo(body = "{\"categories\":null,\"destination_totals\":null}")
            val success = r.coverage().toList().last()
            assertTrue(success is Resource.Success)
            assertTrue(success.data.categories.isEmpty())
            assertTrue(success.data.destinationTotals.isEmpty())
            assertTrue(success.data.orphanFields.isEmpty())
        }

    @Test
    fun populatedPayloadIsDecodedAndCachedVerbatim() =
        runTestBlocking {
            val body =
                """
                {"categories":[{"category":"charge","total_fields":2,
                  "destinations":{"charging_sessions":2},
                  "fields":[{"field":"ChargeState","destination":"charging_sessions","column":"state",
                    "also_signal_log":true,"subscribed":true}]}],
                 "destination_totals":{"charging_sessions":2,"signal_log":7},
                 "orphan_fields":["UnroutedA"]}
                """.trimIndent()
            val store = MapCacheStore()
            val engine = MockEngine { respond(body, HttpStatusCode.OK, jsonHeaders) }
            val api = buildApiHttpClient(engine, testConfig())

            val success = HttpFleetTelemetryRepository(api, store).coverage().toList().last()
            assertTrue(success is Resource.Success)
            val category = success.data.categories.single()
            assertEquals("charge", category.category)
            assertEquals(2, category.totalFields)
            assertTrue(category.fields.single().alsoSignalLog)
            assertEquals(7, success.data.destinationTotals["signal_log"])
            assertEquals(listOf("UnroutedA"), success.data.orphanFields)

            // Cache stores the raw payload verbatim — counts/names round-trip with no SI conversion.
            val payload = store.read(CacheDomain.FleetTelemetry, "coverage")?.payload ?: ""
            assertTrue(payload.contains("\"total_fields\":2"))
            assertTrue(payload.contains("\"signal_log\":7"))
        }
}
