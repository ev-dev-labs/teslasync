package io.teslasync.shared.core.net

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class CircuitBreakerTest {
    @Test
    fun opensAfterThresholdRejectsWhileOpenThenHalfOpenProbeCloses() =
        runTestBlocking {
            var calls = 0
            var fail = true
            val engine =
                MockEngine {
                    calls += 1
                    if (fail) {
                        respond("down", HttpStatusCode.InternalServerError)
                    } else {
                        respond("""{"name":"ok","count":1}""", HttpStatusCode.OK, jsonHeaders)
                    }
                }
            val scheduler = VirtualScheduler()
            val client =
                buildApiHttpClient(
                    engine,
                    testConfig(
                        scheduler = scheduler,
                        maxRetries = 0,
                        breakerFailureThreshold = 3,
                        breakerOpenMillis = 1_000,
                    ),
                )

            // Three consecutive failures trip the breaker.
            repeat(3) {
                val r = client.safeRequest<Sample>(path = "/x")
                assertIs<ApiError.Http>(r.exceptionOrNull())
            }
            assertEquals(CircuitState.OPEN, client.circuitState())

            // While open, the next call is fast-failed with no network round-trip.
            val callsBeforeReject = calls
            val rejected = client.safeRequest<Sample>(path = "/x")
            assertIs<ApiError.CircuitOpen>(rejected.exceptionOrNull())
            assertEquals(callsBeforeReject, calls)

            // Elapse the open window; the next call probes (half-open) and, on success, closes.
            scheduler.current += 1_001
            fail = false
            val probe = client.safeRequest<Sample>(path = "/x")
            assertTrue(probe.isSuccess)
            assertEquals(CircuitState.CLOSED, client.circuitState())
        }

    @Test
    fun failedHalfOpenProbeReopensBreaker() =
        runTestBlocking {
            val engine = MockEngine { respond("down", HttpStatusCode.InternalServerError) }
            val scheduler = VirtualScheduler()
            val client =
                buildApiHttpClient(
                    engine,
                    testConfig(
                        scheduler = scheduler,
                        maxRetries = 0,
                        breakerFailureThreshold = 2,
                        breakerOpenMillis = 1_000,
                    ),
                )

            repeat(2) { client.safeRequest<Sample>(path = "/x") }
            assertEquals(CircuitState.OPEN, client.circuitState())

            scheduler.current += 1_001
            // Half-open probe fails → breaker reopens immediately.
            val probe = client.safeRequest<Sample>(path = "/x")
            assertIs<ApiError.Http>(probe.exceptionOrNull())
            assertEquals(CircuitState.OPEN, client.circuitState())
        }

    @Test
    fun clientErrorsDoNotTripBreaker() =
        runTestBlocking {
            val engine = MockEngine { respond("""{"error":"bad"}""", HttpStatusCode.BadRequest, jsonHeaders) }
            val client =
                buildApiHttpClient(engine, testConfig(maxRetries = 0, breakerFailureThreshold = 2))

            repeat(5) { client.safeRequest<Sample>(path = "/x") }

            // 4xx means the server is reachable — the breaker stays closed.
            assertEquals(CircuitState.CLOSED, client.circuitState())
        }
}
