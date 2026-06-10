package io.teslasync.shared.core.net

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.delay
import kotlinx.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ApiHttpClientErrorTest {
    @Test
    fun httpErrorCarriesStatusBodyAndCode() =
        runTestBlocking {
            val engine =
                MockEngine {
                    respond("""{"error":"nope","code":"NOT_FOUND"}""", HttpStatusCode.NotFound, jsonHeaders)
                }
            val client = buildApiHttpClient(engine, testConfig(maxRetries = 0))

            val result = client.safeRequest<Sample>(path = "/x")

            val error = assertIs<ApiError.Http>(result.exceptionOrNull())
            assertEquals(404, error.status)
            assertEquals("NOT_FOUND", error.code)
            assertTrue(error.body?.contains("nope") == true)
        }

    @Test
    fun transportFailureMapsToNetworkError() =
        runTestBlocking {
            val engine = MockEngine { throw IOException("boom") }
            val client = buildApiHttpClient(engine, testConfig(maxRetries = 0))

            val result = client.safeRequest<Sample>(path = "/x")

            assertIs<ApiError.Network>(result.exceptionOrNull())
        }

    @Test
    fun slowResponseMapsToTimeoutError() =
        runTestBlocking {
            val engine =
                MockEngine {
                    // Real-time delay well beyond the configured timeout; withTimeout cancels
                    // the call at ~100ms so the suite never actually waits this long.
                    delay(60_000)
                    respond("""{"name":"x","count":1}""", HttpStatusCode.OK, jsonHeaders)
                }
            val client = buildApiHttpClient(engine, testConfig(maxRetries = 0, requestTimeoutMillis = 100))

            val result = client.safeRequest<Sample>(path = "/x")

            assertIs<ApiError.Timeout>(result.exceptionOrNull())
        }

    @Test
    fun undecodableSuccessBodyMapsToDecodeError() =
        runTestBlocking {
            val engine =
                MockEngine {
                    // Missing the required `count` field → SerializationException on decode.
                    respond("""{"name":"x"}""", HttpStatusCode.OK, jsonHeaders)
                }
            val client = buildApiHttpClient(engine, testConfig(maxRetries = 0))

            val result = client.safeRequest<Sample>(path = "/x")

            assertIs<ApiError.Decode>(result.exceptionOrNull())
        }

    @Test
    fun unserializableRequestBodyMapsToDecodeErrorWithoutRetry() =
        runTestBlocking {
            var calls = 0
            val engine =
                MockEngine {
                    calls += 1
                    respond("""{"name":"ok","count":1}""", HttpStatusCode.OK, jsonHeaders)
                }
            // An anonymous object has no kotlinx serializer → encoding fails before the wire.
            val client = buildApiHttpClient(engine, testConfig(maxRetries = 3))

            val result =
                client.safeRequest<Sample>(
                    method = HttpMethodKind.PUT,
                    path = "/x",
                    body = object {},
                )

            assertIs<ApiError.Decode>(result.exceptionOrNull())
            // Encoding never reached the network, so no attempt was made and none retried.
            assertEquals(0, calls)
        }
}
