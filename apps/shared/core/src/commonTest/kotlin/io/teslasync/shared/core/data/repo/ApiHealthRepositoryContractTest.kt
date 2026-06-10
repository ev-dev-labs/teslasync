package io.teslasync.shared.core.data.repo

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.teslasync.shared.core.cache.Clock
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Locks [HttpApiHealthRepository] to the exact endpoint the web `useApiHealth` `probe()` issues
 * (web/src/api/hooks/useApiHealth.ts): a GET against the API server *root* `/healthz`, NOT under
 * `/api/v1`. A regression — e.g. accidentally versioning the path to `/api/v1/healthz` (a 404),
 * or treating a non-2xx as healthy — is caught at build time rather than as a permanently-red
 * footer indicator in production.
 */
class ApiHealthRepositoryContractTest {
    /** Deterministic clock returning queued epoch-millis readings (last repeats) for latency tests. */
    private class SequenceClock(
        private val readings: List<Long>,
    ) : Clock {
        private var index = 0

        override fun nowMillis(): Long {
            val value = readings[if (index < readings.size) index else readings.size - 1]
            index += 1
            return value
        }
    }

    private fun repo(
        status: HttpStatusCode = HttpStatusCode.OK,
        clock: Clock = SequenceClock(listOf(0L)),
        onRequest: (Url) -> Unit = {},
    ): HttpApiHealthRepository {
        val engine =
            MockEngine { request ->
                onRequest(request.url)
                respond("{\"status\":\"ok\"}", status, jsonHeaders)
            }
        val api: ApiHttpClient = buildApiHttpClient(engine, testConfig())
        return HttpApiHealthRepository(api, clock)
    }

    @Test
    fun probeHitsRootHealthzNotVersioned() =
        runTestBlocking {
            var url: Url? = null
            val r = repo { url = it }
            r.probe()
            val captured = url ?: error("probe issued no request")
            assertEquals("/healthz", captured.encodedPath)
            assertFalse(captured.encodedPath.contains("/api/v1"), "healthz must not be versioned")
        }

    @Test
    fun successfulProbeIsOk() =
        runTestBlocking {
            val r = repo(status = HttpStatusCode.OK, clock = SequenceClock(listOf(1_000L, 1_120L)))
            val probe = r.probe()
            assertTrue(probe.ok, "a 2xx /healthz is an ok probe")
            assertEquals(120L, probe.latencyMs, "latency is the clock span around the probe")
        }

    @Test
    fun nonSuccessProbeIsNotOk() =
        runTestBlocking {
            val r = repo(status = HttpStatusCode.ServiceUnavailable)
            val probe = r.probe()
            assertFalse(probe.ok, "a non-2xx /healthz resolves to an offline probe, never throws")
        }
}
