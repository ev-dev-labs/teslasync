package io.teslasync.shared.core.net

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.time.TimeSource

class ApiHttpClientRetryTest {
    @Test
    fun retriesIdempotent5xxWithExponentialBackoffThenSucceeds() =
        runTestBlocking {
            var calls = 0
            val engine =
                MockEngine {
                    calls += 1
                    if (calls < 3) {
                        respond("upstream boom", HttpStatusCode.InternalServerError)
                    } else {
                        respond("""{"name":"ok","count":2}""", HttpStatusCode.OK, jsonHeaders)
                    }
                }
            val scheduler = VirtualScheduler()
            val client = buildApiHttpClient(engine, testConfig(scheduler = scheduler, maxRetries = 2))

            val started = TimeSource.Monotonic.markNow()
            val result: Sample = client.request(path = "/x")
            val elapsed = started.elapsedNow()

            assertEquals(2, result.count)
            assertEquals(3, calls)
            // Two backoffs: base*2^0 and base*2^1 with fixed-jitter multiplier 1.0.
            assertEquals(listOf(1_000L, 2_000L), scheduler.sleeps)
            // Wall-clock guard: the recorded 3s of backoff must NOT have actually slept.
            assertTrue(elapsed.inWholeMilliseconds < 1_000, "backoff slept on the real clock: $elapsed")
        }

    @Test
    fun exhaustsRetriesThenThrowsLastHttpError() =
        runTestBlocking {
            var calls = 0
            val engine =
                MockEngine {
                    calls += 1
                    respond("still down", HttpStatusCode.ServiceUnavailable)
                }
            val client = buildApiHttpClient(engine, testConfig(maxRetries = 2))

            val result = client.safeRequest<Sample>(path = "/x")

            assertEquals(3, calls)
            val error = assertIs<ApiError.Http>(result.exceptionOrNull())
            assertEquals(503, error.status)
        }

    @Test
    fun doesNotRetryClientErrors() =
        runTestBlocking {
            var calls = 0
            val engine =
                MockEngine {
                    calls += 1
                    respond("""{"error":"bad"}""", HttpStatusCode.BadRequest, jsonHeaders)
                }
            val client = buildApiHttpClient(engine, testConfig(maxRetries = 3))

            val result = client.safeRequest<Sample>(path = "/x")

            assertEquals(1, calls)
            assertEquals(400, assertIs<ApiError.Http>(result.exceptionOrNull()).status)
        }

    @Test
    fun doesNotRetryNonIdempotentPostOn5xx() =
        runTestBlocking {
            var calls = 0
            val engine =
                MockEngine {
                    calls += 1
                    respond("boom", HttpStatusCode.InternalServerError)
                }
            val client = buildApiHttpClient(engine, testConfig(maxRetries = 3))

            val result = client.safeRequest<Sample>(method = HttpMethodKind.POST, path = "/x", body = "{}")

            assertEquals(1, calls)
            assertEquals(500, assertIs<ApiError.Http>(result.exceptionOrNull()).status)
        }

    @Test
    fun backoffJitterStaysWithinExpectedBounds() =
        runTestBlocking {
            // random()=0.0 → multiplier 0.75 (lower bound); random()=1.0 → 1.25 (upper bound).
            for ((rand, expected) in listOf(0.0 to listOf(750L, 1_500L), 1.0 to listOf(1_250L, 2_500L))) {
                var calls = 0
                val engine =
                    MockEngine {
                        calls += 1
                        if (calls < 3) {
                            respond("boom", HttpStatusCode.InternalServerError)
                        } else {
                            respond("""{"name":"ok","count":1}""", HttpStatusCode.OK, jsonHeaders)
                        }
                    }
                val scheduler = VirtualScheduler()
                val client =
                    buildApiHttpClient(
                        engine,
                        testConfig(scheduler = scheduler, maxRetries = 2, random = { rand }),
                    )

                client.request<Sample>(path = "/x")

                assertEquals(expected, scheduler.sleeps, "jitter bound for random()=$rand")
            }
        }

    @Test
    fun backoffIsCappedAtMaxRetryDelay() =
        runTestBlocking {
            var calls = 0
            val engine =
                MockEngine {
                    calls += 1
                    respond("boom", HttpStatusCode.InternalServerError)
                }
            val scheduler = VirtualScheduler()
            val client =
                buildApiHttpClient(
                    engine,
                    testConfig(
                        scheduler = scheduler,
                        maxRetries = 4,
                        baseRetryDelayMillis = 1_000,
                        maxRetryDelayMillis = 2_500,
                    ),
                )

            client.safeRequest<Sample>(path = "/x")

            // Uncapped (jitter 1.0) would be 1000, 2000, 4000, 8000; capped at 2500.
            assertEquals(listOf(1_000L, 2_000L, 2_500L, 2_500L), scheduler.sleeps)
        }
}
