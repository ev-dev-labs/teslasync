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
 * Locks [HttpSystemRepository]'s single read to the exact endpoint the web `useRateLimitStatus`
 * hook issues (web/src/api/hooks/useSystem.ts). A path regression — a double `/api/v1` prefix, a
 * renamed route — is caught at build time instead of as a silently-always-failing Settings panel
 * in production. Also asserts the bare-body decode (no `{data:T}` envelope, matching the backend's
 * `httpx.WriteJSON` handler), the cache-then-network ordering, and the verbatim cache round-trip.
 */
class SystemRepositoryContractTest {
    private fun repo(
        body: String = """{"generated_at":"","scopes":[]}""",
        status: HttpStatusCode = HttpStatusCode.OK,
        onRequest: (Url) -> Unit = {},
    ): HttpSystemRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSystemRepository(api, MapCacheStore())
    }

    @Test
    fun rateLimitStatusHitsItsEndpoint() =
        runTestBlocking {
            var url: Url? = null
            val r = repo { url = it }
            r.rateLimitStatus().toList()
            val captured = url ?: error("no request was issued")
            assertEquals("/api/v1/system/rate-limits", captured.encodedPath)
            assertFalse(captured.encodedPath.contains("/api/v1/api/v1"), "no double /api/v1 prefix")
        }

    @Test
    fun rateLimitStatusDecodesBareBodyAndCachesVerbatim() =
        runTestBlocking {
            // The backend ratelimit handler answers with a bare httpx.WriteJSON body (no {data:T}
            // envelope), exactly as the web plain `request<RateLimitStatusResponse>` expects.
            val body =
                """
                {"generated_at":"2026-06-05T12:00:00Z","scopes":[
                  {"id":"tesla.fleet_api.burst","name":"Tesla Fleet API","current":12.5,"limit":40,
                   "window_seconds":0,"reset_at":"2026-06-05T12:01:00Z","severity":"warn",
                   "detail":"client-side burst"},
                  {"id":"api.internal.minute","name":"Internal API","current":3,"limit":600,
                   "window_seconds":60,"severity":"ok"}]}
                """.trimIndent()
            val store = MapCacheStore()
            val engine = MockEngine { respond(body, HttpStatusCode.OK, jsonHeaders) }
            val api = buildApiHttpClient(engine, testConfig())

            val r = HttpSystemRepository(api, store)
            val emissions = r.rateLimitStatus().toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            val success = emissions.last()
            assertTrue(success is Resource.Success, "terminal emission is the network success")
            assertEquals("2026-06-05T12:00:00Z", success.data.generatedAt)
            assertEquals(2, success.data.scopes.size)
            val tesla = success.data.scopes.first()
            assertEquals("tesla.fleet_api.burst", tesla.id)
            assertEquals(12.5, tesla.current)
            assertEquals(40.0, tesla.limit)
            assertEquals("warn", tesla.severity)
            assertEquals("2026-06-05T12:01:00Z", tesla.resetAt)
            // The sliding-window scope omits reset_at — it must decode to null, not throw.
            assertEquals(null, success.data.scopes[1].resetAt)
            assertEquals(60, success.data.scopes[1].windowSeconds)

            // Cache stores the SI payload verbatim — the snake_case keys round-trip with no conversion.
            val payload = store.read(CacheDomain.System, SYSTEM_RATE_LIMITS_KEY)?.payload ?: ""
            assertTrue(payload.contains("\"window_seconds\":60"), "cached payload keeps snake_case keys")
            assertTrue(payload.contains("tesla.fleet_api.burst"))
        }

    @Test
    fun aTransportErrorDegradesToErrorNotAThrow() =
        runTestBlocking {
            val r =
                repo(
                    body = """{"error":"boom","code":"INTERNAL"}""",
                    status = HttpStatusCode.InternalServerError,
                )
            val emissions = r.rateLimitStatus().toList()
            assertTrue(emissions.last() is Resource.Error, "a 5xx surfaces as Resource.Error, never a throw")
        }
}
