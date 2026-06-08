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
import io.teslasync.shared.core.presentation.operatorconfidence.AuditLogQueryParams
import io.teslasync.shared.core.presentation.operatorconfidence.SlowQueryOrderBy
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.toList
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks [HttpOperatorConfidenceRepository]'s ten reads to the exact endpoints + params the web
 * `useOperatorConfidence` hooks issue (web/src/api/hooks/useOperatorConfidence.ts). A path
 * regression — a double `/api/v1` prefix, a renamed query key, a camelCase param — is caught at
 * build time instead of as a silently-always-failing admin screen in production. Also asserts the
 * `fetchEnvelope` `{data:T}` unwrap, the cache-then-network ordering, and the verbatim cache
 * round-trip.
 */
class OperatorConfidenceRepositoryContractTest {
    private fun repo(
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (Url) -> Unit = {},
    ): HttpOperatorConfidenceRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpOperatorConfidenceRepository(api, MapCacheStore())
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpOperatorConfidenceRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it }
        call(r).toList()
        return url!!
    }

    @Test
    fun schemaDriftHitsItsEndpoint() =
        runTestBlocking {
            val url = captureRead { it.schemaDrift() }
            assertEquals("/api/v1/admin/observability/schema-drift", url.encodedPath)
            assertFalse(url.encodedPath.contains("/api/v1/api/v1"), "no double /api/v1 prefix")
        }

    @Test
    fun slowQueriesHitsItsEndpointWithWebParams() =
        runTestBlocking {
            val url = captureRead { it.slowQueries(SlowQueryOrderBy.TOTAL_TIME, 40) }
            assertEquals("/api/v1/admin/observability/slow-queries", url.encodedPath)
            assertEquals("total_time", url.parameters["order_by"])
            assertEquals("40", url.parameters["limit"])
        }

    @Test
    fun slowQueriesUsesWebDefaults() =
        runTestBlocking {
            val url = captureRead { it.slowQueries() }
            assertEquals("mean_time", url.parameters["order_by"], "default order_by is mean_time")
            assertEquals("25", url.parameters["limit"], "default limit is 25")
        }

    @Test
    fun vehicleCostOmitsSinceWhenNull() =
        runTestBlocking {
            val url = captureRead { it.vehicleCost(sinceIso = null, limit = 100) }
            assertEquals("/api/v1/admin/observability/vehicle-cost", url.encodedPath)
            assertEquals("100", url.parameters["limit"])
            assertNull(url.parameters["since"], "since is omitted when null (web conditional)")
        }

    @Test
    fun vehicleCostIncludesSinceWhenProvided() =
        runTestBlocking {
            val url = captureRead { it.vehicleCost(sinceIso = "2026-01-01T00:00:00.000Z", limit = 50) }
            assertEquals("50", url.parameters["limit"])
            assertEquals("2026-01-01T00:00:00.000Z", url.parameters["since"])
        }

    @Test
    fun diskForecastHitsItsEndpoint() =
        runTestBlocking {
            val url = captureRead { it.diskForecast() }
            assertEquals("/api/v1/admin/observability/disk-forecast", url.encodedPath)
        }

    @Test
    fun secretRotationHitsItsEndpoint() =
        runTestBlocking {
            val url = captureRead { it.secretRotation() }
            assertEquals("/api/v1/admin/observability/secret-rotation", url.encodedPath)
        }

    @Test
    fun auditLogHitsItsEndpointWithSnakeCaseFilters() =
        runTestBlocking {
            val url =
                captureRead {
                    it.auditLog(
                        AuditLogQueryParams(
                            since = "2026-01-01T00:00:00Z",
                            categories = listOf("auth", "admin"),
                            entityType = "vehicle",
                            entityId = 7,
                            limit = 100,
                            offset = 20,
                        ),
                    )
                }
            assertEquals("/api/v1/admin/audit-log", url.encodedPath)
            assertEquals("2026-01-01T00:00:00Z", url.parameters["since"])
            assertEquals("auth,admin", url.parameters["categories"], "multi-value filters are comma-joined")
            assertEquals("vehicle", url.parameters["entity_type"])
            assertEquals("7", url.parameters["entity_id"])
            assertEquals("100", url.parameters["limit"])
            assertEquals("20", url.parameters["offset"])
        }

    @Test
    fun auditCategoriesAndActionsHitTheirEndpoints() =
        runTestBlocking {
            assertEquals("/api/v1/admin/audit-log/categories", captureRead { it.auditCategories() }.encodedPath)
            assertEquals("/api/v1/admin/audit-log/actions", captureRead { it.auditActions() }.encodedPath)
        }

    @Test
    fun auditChainVerifyHitsItsEndpointWithLimitOnlyByDefault() =
        runTestBlocking {
            val url = captureRead { it.auditChainVerify() }
            assertEquals("/api/v1/admin/audit-log/verify", url.encodedPath)
            assertEquals("1000", url.parameters["limit"], "default verify limit is 1000")
            assertNull(url.parameters["since"], "since omitted when null")
        }

    @Test
    fun gdprExportHitsItsEndpointWithIdInPath() =
        runTestBlocking {
            val url = captureRead { it.gdprExport("artifact-42") }
            assertEquals("/api/v1/admin/gdpr/exports/artifact-42", url.encodedPath)
        }

    @Test
    fun envelopeIsUnwrappedAndDecodedAndCachedVerbatim() =
        runTestBlocking {
            // The platform httputil.Respond handlers wrap the payload as {data: T} (web fetchEnvelope).
            val body =
                """
                {"data":{"order_by":"mean_time","slow_queries":[
                  {"query_id":99,"fingerprint":"SELECT 1","calls":12,"total_time_ms":34.5,
                   "mean_time_ms":2.9,"max_time_ms":9.1,"rows_returned":12,
                   "shared_blks_hit":100,"shared_blks_read":3}]}}
                """.trimIndent()
            val store = MapCacheStore()
            val engine = MockEngine { respond(body, HttpStatusCode.OK, jsonHeaders) }
            val api = buildApiHttpClient(engine, testConfig())

            val r = HttpOperatorConfidenceRepository(api, store)
            val emissions = r.slowQueries().toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            val success = emissions.last()
            assertTrue(success is Resource.Success, "terminal emission is the network success")
            assertEquals("mean_time", success.data.orderBy)
            val row = success.data.slowQueries.single()
            assertEquals(99L, row.queryId)
            assertEquals(34.5, row.totalTimeMs)
            assertEquals(100L, row.sharedBlksHit)

            // Cache stores the UNWRAPPED payload verbatim — the {data:...} wrapper is peeled before
            // caching, and the inner counts round-trip with no conversion.
            val key = slowQueriesKey(SlowQueryOrderBy.MEAN_TIME, 25)
            val payload = store.read(CacheDomain.OperatorConfidence, key)?.payload ?: ""
            assertFalse(payload.contains("\"data\""), "cached payload is the unwrapped body, not the envelope")
            assertTrue(payload.contains("\"query_id\":99"))
        }

    @Test
    fun bodyWithoutEnvelopeDecodesAsIs() =
        runTestBlocking {
            // Defensive no-op branch: a handler ever migrated off httputil.Respond returns a bare body.
            val body = """{"categories":["auth","billing"]}"""
            val r = repo(body = body)
            val success = r.auditCategories().toList().last()
            assertTrue(success is Resource.Success)
            assertEquals(listOf("auth", "billing"), success.data.categories)
        }

    @Test
    fun a503DegradesToErrorNotAThrow() =
        runTestBlocking {
            // Each route 503s with SUBSYSTEM_NOT_CONFIGURED when its repo is nil; the platform branches
            // on the error status. The flow must surface Resource.Error, never throw across the boundary.
            val r =
                repo(
                    body = """{"error":"not configured","code":"SUBSYSTEM_NOT_CONFIGURED"}""",
                    status = HttpStatusCode.ServiceUnavailable,
                )
            val emissions = r.diskForecast().toList()
            assertTrue(emissions.last() is Resource.Error, "a 503 surfaces as Resource.Error")
        }
}
