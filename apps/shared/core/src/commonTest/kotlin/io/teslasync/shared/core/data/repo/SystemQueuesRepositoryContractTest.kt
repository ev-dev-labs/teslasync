package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
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

/**
 * Locks every [HttpSystemQueuesRepository] call to the exact endpoint/params the web `useSystemQueues`
 * hooks issue (`GET /system/queues`, `GET /system/queues/{worker}/jobs?limit=`), and proves each read
 * decodes its typed envelope and caches under the web `queueKeys` shape. A path/param/decode
 * regression is caught at build time instead of as a silent always-fails queue panel in production.
 */
class SystemQueuesRepositoryContractTest {
    private fun repo(
        store: MapCacheStore = MapCacheStore(),
        body: String = "{}",
        onRequest: (HttpRequestData) -> Unit = {},
    ): HttpSystemQueuesRepository {
        val engine =
            MockEngine { request ->
                onRequest(request)
                respond(body, HttpStatusCode.OK, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpSystemQueuesRepository(api, store)
    }

    private suspend fun captureRead(
        body: String = "{}",
        call: (HttpSystemQueuesRepository) -> Flow<Resource<*>>,
    ): Url {
        var url: Url? = null
        val r = repo(body = body) { url = it.url }
        call(r).toList()
        return url!!
    }

    // ---- Reads: path + params -----------------------------------------------------

    @Test
    fun queueStatusHitsSystemQueues() =
        runTestBlocking {
            val url = captureRead("{\"generated_at\":\"t\",\"workers\":[]}") { it.queueStatus() }
            assertEquals("/api/v1/system/queues", url.encodedPath)
        }

    @Test
    fun queueJobsHitsPerWorkerJobsWithLimit() =
        runTestBlocking {
            val url =
                captureRead("{\"worker\":\"notification\",\"jobs\":[]}") {
                    it.queueJobs("notification", limit = 25)
                }
            assertEquals("/api/v1/system/queues/notification/jobs", url.encodedPath)
            assertEquals("25", url.parameters["limit"])
        }

    @Test
    fun queueJobsDefaultLimitIs25() =
        runTestBlocking {
            val url = captureRead("{\"worker\":\"export\",\"jobs\":[]}") { it.queueJobs("export") }
            assertEquals("25", url.parameters["limit"])
        }

    @Test
    fun queueJobsPercentEncodesWorkerSegment() =
        runTestBlocking {
            // A worker id with URL-unsafe characters must be percent-encoded exactly as the web
            // `encodeURIComponent(worker)` does (the proof the path derivation matches the wire).
            val url = captureRead("{\"worker\":\"a b/c\",\"jobs\":[]}") { it.queueJobs("a b/c") }
            assertEquals("/api/v1/system/queues/a%20b%2Fc/jobs", url.encodedPath)
        }

    // ---- Reads: typed decode + cache key ------------------------------------------

    @Test
    fun queueStatusDecodesTypedEnvelope() =
        runTestBlocking {
            val r =
                repo(
                    body =
                        "{\"generated_at\":\"2026-01-01T00:00:00Z\",\"workers\":[{\"worker\":\"notification\"," +
                            "\"display_name\":\"Notifications\",\"pending\":3,\"in_progress\":1,\"succeeded_24h\":40," +
                            "\"failed_24h\":2,\"oldest_pending_age_seconds\":90,\"heartbeat_severity\":\"ok\"," +
                            "\"heartbeat_detail\":\"Last beat 7m ago\"}]}",
                )
            val success = r.queueStatus().toList().last() as Resource.Success
            assertEquals("2026-01-01T00:00:00Z", success.data.generatedAt)
            assertEquals(1, success.data.workers.size)
            val w = success.data.workers.first()
            assertEquals("notification", w.worker)
            assertEquals(3L, w.pending)
            assertEquals(90L, w.oldestPendingAgeSeconds)
            assertEquals("ok", w.heartbeatSeverity)
        }

    @Test
    fun queueJobsDecodesTypedEnvelope() =
        runTestBlocking {
            val r =
                repo(
                    body =
                        "{\"worker\":\"export\",\"jobs\":[{\"id\":\"j1\",\"worker\":\"export\",\"status\":\"succeeded\"," +
                            "\"title\":\"CSV export\",\"started_at\":\"2026-01-01T00:00:00Z\"," +
                            "\"finished_at\":\"2026-01-01T00:00:05Z\",\"duration_ms\":5000}]}",
                )
            val success = r.queueJobs("export").toList().last() as Resource.Success
            assertEquals("export", success.data.worker)
            assertEquals(1, success.data.jobs.size)
            val job = success.data.jobs.first()
            assertEquals("j1", job.id)
            assertEquals("succeeded", job.status)
            assertEquals(5000L, job.durationMs)
        }

    @Test
    fun queueStatusCachesUnderWebStatusKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store = store, body = "{\"generated_at\":\"t\",\"workers\":[]}")
            r.queueStatus().toList()
            // web `queueKeys.status` analogue: the status feed caches under the status key.
            assertNotNull(store.read(CacheDomain.SystemQueues, SYSTEM_QUEUES_STATUS_KEY))
        }

    @Test
    fun queueJobsCachesUnderWebWorkerKey() =
        runTestBlocking {
            val store = MapCacheStore()
            val r = repo(store = store, body = "{\"worker\":\"automation\",\"jobs\":[]}")
            r.queueJobs("automation").toList()
            // web `queueKeys.jobs(worker)` analogue: keyed by worker alone, not the limit.
            assertNotNull(store.read(CacheDomain.SystemQueues, queueJobsCacheKey("automation")))
        }
}
