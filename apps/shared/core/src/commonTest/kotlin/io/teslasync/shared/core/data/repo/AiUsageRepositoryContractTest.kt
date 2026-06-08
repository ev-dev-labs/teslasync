package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
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
 * Locks every [HttpAiUsageRepository] read to the exact endpoint/method/params the web
 * `useAiUsage` hooks issue (web/src/api/hooks/useAiUsage.ts). A path/param regression — e.g.
 * a double `/api/v1` prefix, a camelCase param, or emitting an empty `since=` — is caught at
 * build time instead of as a silently-always-failing AI-usage screen in production.
 */
class AiUsageRepositoryContractTest {
    private fun repo(
        body: String = "{}",
        onRequest: (Url) -> Unit = {},
    ): HttpAiUsageRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpAiUsageRepository(api, MapCacheStore())
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpAiUsageRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it }
        call(r).toList()
        return url!!
    }

    @Test
    fun todayHitsAiUsageToday() =
        runTestBlocking {
            val url = captureRead { it.today() }
            assertEquals("/api/v1/ai/usage/today", url.encodedPath)
        }

    @Test
    fun byFeatureWithoutSinceOmitsTheParam() =
        runTestBlocking {
            val url = captureRead { it.byFeature(null) }
            assertEquals("/api/v1/ai/usage/by-feature", url.encodedPath)
            // Verbatim with the web conditional path: no `since=` is emitted when absent.
            assertFalse(url.parameters.contains("since"))
        }

    @Test
    fun byFeatureWithSincePassesSnakeCaseSinceQuery() =
        runTestBlocking {
            val since = "2026-06-01T00:00:00Z"
            val url = captureRead { it.byFeature(since) }
            assertEquals("/api/v1/ai/usage/by-feature", url.encodedPath)
            assertEquals(since, url.parameters["since"])
        }

    @Test
    fun recentWithoutLimitOmitsTheParam() =
        runTestBlocking {
            val url = captureRead { it.recent(null) }
            assertEquals("/api/v1/ai/usage/recent", url.encodedPath)
            assertFalse(url.parameters.contains("limit"))
        }

    @Test
    fun recentWithLimitPassesLimitQuery() =
        runTestBlocking {
            val url = captureRead { it.recent(100) }
            assertEquals("/api/v1/ai/usage/recent", url.encodedPath)
            assertEquals("100", url.parameters["limit"])
        }

    @Test
    fun readEmitsCacheThenNetworkSuccess() =
        runTestBlocking {
            val r = repo(body = "{\"call_count\":0}")
            val emissions = r.today().toList()
            assertTrue(emissions.first() is Resource.Loading, "first emission is the cache slot")
            assertTrue(emissions.last() is Resource.Success, "terminal emission is the network success")
        }
}
