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
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayBucket
import io.teslasync.shared.core.presentation.ingestxray.IngestXRayWindow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks [HttpIngestXRayRepository]'s read to the exact endpoint + params the web `useIngestXRay`
 * hook issues (web/src/api/hooks/useIngestXRay.ts). A path regression — e.g. a double `/api/v1`
 * prefix or a renamed query key — is caught at build time instead of as a silently-always-failing
 * X-Ray screen in production. Also asserts the cache-then-network ordering and the verbatim-SI
 * cache round-trip.
 */
class IngestXRayRepositoryContractTest {
    private fun repo(
        body: String = "{}",
        onRequest: (Url) -> Unit = {},
    ): HttpIngestXRayRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpIngestXRayRepository(api, MapCacheStore())
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpIngestXRayRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it }
        call(r).toList()
        return url!!
    }

    @Test
    fun xrayHitsIngestXRayEndpointWithWebParams() =
        runTestBlocking {
            val url = captureRead { it.xray(42L, IngestXRayWindow.W6H, IngestXRayBucket.B5M, 25) }
            assertEquals("/api/v1/system/ingest-xray/42", url.encodedPath)
            assertFalse(url.encodedPath.contains("/api/v1/api/v1"), "no double /api/v1 prefix")
            assertEquals("6h", url.parameters["window"])
            assertEquals("5m", url.parameters["bucket"])
            assertEquals("25", url.parameters["limit"])
        }

    @Test
    fun xrayUsesWebDefaultParams() =
        runTestBlocking {
            val url = captureRead { it.xray(42L) }
            // web useIngestXRay defaults: window '1h', bucket '1m', limit PAGINATION.DEFAULT_LIMIT (50)
            assertEquals("1h", url.parameters["window"])
            assertEquals("1m", url.parameters["bucket"])
            assertEquals("50", url.parameters["limit"])
        }

    @Test
    fun readEmitsCacheThenNetworkSuccess() =
        runTestBlocking {
            val r = repo(body = "{\"vehicle_id\":42,\"window\":\"1h\",\"bucket\":\"1m\"}")
            val emissions = r.xray(42L).toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            assertTrue(emissions.last() is Resource.Success, "terminal emission is the network success")
        }

    @Test
    fun populatedPayloadIsDecodedAndCachedVerbatim() =
        runTestBlocking {
            val body =
                """
                {"vehicle_id":42,"window":"1h","bucket":"1m","generated_at":"2026-06-05T09:00:00Z",
                 "total_samples":1234,"unique_fields":3,
                 "fields":[{"field":"VehicleSpeed","sample_count":900,
                   "last_seen_at":"2026-06-05T08:59:59Z","value_kind":6}],
                 "buckets":[{"bucket_start":"2026-06-05T08:00:00Z","count":120}]}
                """.trimIndent()
            val store = MapCacheStore()
            val engine = MockEngine { respond(body, HttpStatusCode.OK, jsonHeaders) }
            val api = buildApiHttpClient(engine, testConfig())

            val xrayRepo = HttpIngestXRayRepository(api, store)
            val success =
                xrayRepo
                    .xray(42L)
                    .toList()
                    .last()
            assertTrue(success is Resource.Success)
            assertEquals(42L, success.data.vehicleId)
            assertEquals(1234L, success.data.totalSamples)
            assertEquals(3L, success.data.uniqueFields)
            val field = success.data.fields.single()
            assertEquals("VehicleSpeed", field.field)
            assertEquals(900L, field.sampleCount)
            assertEquals(6, field.valueKind)
            val onlyBucket = success.data.buckets.single()
            assertEquals(120L, onlyBucket.count)

            // Cache stores the raw payload verbatim — counts round-trip with no SI conversion.
            val key = ingestXRayKey(42L, IngestXRayWindow.W1H, IngestXRayBucket.B1M, 50)
            val payload = store.read(CacheDomain.IngestXRay, key)?.payload ?: ""
            assertTrue(payload.contains("\"total_samples\":1234"))
            assertTrue(payload.contains("\"sample_count\":900"))
        }
}
