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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks every [HttpDlqRepository] call to the exact endpoint/method/params the web `useDLQ` hooks
 * issue, and verifies the replay mutation evicts the whole DLQ partition the web hook invalidates
 * (`invalidateQueries(['system','dlq'])`). A path/param regression is caught at build time instead
 * of as a silent always-fails DLQ screen in production.
 */
class DlqRepositoryContractTest {
    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        status: HttpStatusCode = HttpStatusCode.OK,
        maxRetries: Int = 2,
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpDlqRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig(maxRetries = maxRetries))
        return HttpDlqRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpDlqRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun listHitsSystemDlq() =
        runTestBlocking {
            assertEquals("/api/v1/system/dlq", captureRead { it.list() }.encodedPath)
        }

    @Test
    fun entryHitsSystemDlqWithId() =
        runTestBlocking {
            assertEquals("/api/v1/system/dlq/42", captureRead { it.entry(42) }.encodedPath)
        }

    @Test
    fun globalAuditHitsSystemDlqAuditWithLimit() =
        runTestBlocking {
            val url = captureRead("[]") { it.audit(dlqId = null, limit = 50) }
            assertEquals("/api/v1/system/dlq/audit", url.encodedPath)
            assertEquals("50", url.parameters["limit"])
        }

    @Test
    fun globalAuditUsedForNonPositiveId() =
        runTestBlocking {
            // dlqId == 0 is the global feed, matching the web `scoped = dlqId > 0`.
            assertEquals("/api/v1/system/dlq/audit", captureRead("[]") { it.audit(dlqId = 0, limit = 25) }.encodedPath)
        }

    @Test
    fun scopedAuditHitsPerEntryAuditWithLimit() =
        runTestBlocking {
            val url = captureRead("[]") { it.audit(dlqId = 7, limit = 100) }
            assertEquals("/api/v1/system/dlq/7/audit", url.encodedPath)
            assertEquals("100", url.parameters["limit"])
        }

    // ---- Mutation: method + path + invalidation -----------------------------------

    @Test
    fun replayPostsReplayAndInvalidatesWholePartition() =
        runTestBlocking {
            val store = MapCacheStore()
            // Seed every DLQ feed shape so we can prove the whole partition is cleared.
            store.putRaw(CacheDomain.Dlq, "list", "[]", 1)
            store.putRaw(CacheDomain.Dlq, "entry:7", "{}", 1)
            store.putRaw(CacheDomain.Dlq, "audit:50", "[]", 1)
            store.putRaw(CacheDomain.Dlq, "entry-audit:7:50", "[]", 1)
            var seen: HttpRequestData? = null
            val engine =
                MockEngine { request ->
                    seen = request
                    respond("{\"result\":\"replayed\",\"dst_topic\":\"t\"}", HttpStatusCode.OK, jsonHeaders)
                }
            val r = HttpDlqRepository(buildApiHttpClient(engine, testConfig()), store)

            val result = r.replayEntry(7)

            assertTrue(result.isSuccess)
            val req = assertNotNull(seen)
            assertEquals(HttpMethod.Post, req.method)
            assertEquals("/api/v1/system/dlq/7/replay", req.url.encodedPath)
            // invalidateQueries(['system','dlq']) analogue: the whole partition is cleared.
            assertNull(store.read(CacheDomain.Dlq, "list"))
            assertNull(store.read(CacheDomain.Dlq, "entry:7"))
            assertNull(store.read(CacheDomain.Dlq, "audit:50"))
            assertNull(store.read(CacheDomain.Dlq, "entry-audit:7:50"))
        }

    @Test
    fun replayFailureDoesNotInvalidate() =
        runTestBlocking {
            val store = MapCacheStore()
            store.putRaw(CacheDomain.Dlq, "list", "[]", 1)
            // 403 is the DLQ_REPLAY_ENABLED=false gate; the web surfaces it as a failed mutation
            // that does NOT invalidate, so the cached list must survive.
            val r = repo(store = store, body = "{\"result\":\"disabled\"}", status = HttpStatusCode.Forbidden, maxRetries = 0)

            val result = r.replayEntry(7)

            assertTrue(result.isFailure)
            assertNotNull(store.read(CacheDomain.Dlq, "list"))
        }
}
