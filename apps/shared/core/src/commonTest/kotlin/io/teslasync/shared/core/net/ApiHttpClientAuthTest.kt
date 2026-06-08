package io.teslasync.shared.core.net

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull

class ApiHttpClientAuthTest {
    @Test
    fun attachesBearerTokenFromProvider() =
        runTestBlocking {
            var seenAuth: String? = null
            val engine =
                MockEngine { request ->
                    seenAuth = request.headers[HttpHeaders.Authorization]
                    respond("""{"name":"ok","count":1}""", HttpStatusCode.OK, jsonHeaders)
                }
            val provider =
                object : TokenProvider {
                    override suspend fun token(): String = "abc123"

                    override suspend fun onUnauthorized(failedToken: String?): Boolean = false
                }
            val client = buildApiHttpClient(engine, testConfig(tokenProvider = provider))

            client.request<Sample>(path = "/x")

            assertEquals("Bearer abc123", seenAuth)
        }

    @Test
    fun noopProviderSendsNoAuthorizationHeader() =
        runTestBlocking {
            var seenAuth: String? = "unset"
            val engine =
                MockEngine { request ->
                    seenAuth = request.headers[HttpHeaders.Authorization]
                    respond("""{"name":"ok","count":1}""", HttpStatusCode.OK, jsonHeaders)
                }
            val client = buildApiHttpClient(engine, testConfig())

            client.request<Sample>(path = "/x")

            assertNull(seenAuth)
        }

    @Test
    fun unauthorizedInvokesHookOnceThenReplaysWithRefreshedToken() =
        runTestBlocking {
            var calls = 0
            var hookCalls = 0
            var token = "stale"
            val engine =
                MockEngine { request ->
                    calls += 1
                    if (request.headers[HttpHeaders.Authorization] == "Bearer fresh") {
                        respond("""{"name":"ok","count":1}""", HttpStatusCode.OK, jsonHeaders)
                    } else {
                        respond("""{"code":"UNAUTHORIZED"}""", HttpStatusCode.Unauthorized, jsonHeaders)
                    }
                }
            val provider =
                object : TokenProvider {
                    override suspend fun token(): String = token

                    override suspend fun onUnauthorized(failedToken: String?): Boolean {
                        hookCalls += 1
                        token = "fresh"
                        return true
                    }
                }
            val client = buildApiHttpClient(engine, testConfig(tokenProvider = provider, maxRetries = 2))

            val result: Sample = client.request(path = "/x")

            assertEquals("ok", result.name)
            assertEquals(1, hookCalls)
            assertEquals(2, calls)
        }

    @Test
    fun unauthorizedHookReturningFalseSurfacesHttp401() =
        runTestBlocking {
            var calls = 0
            var hookCalls = 0
            val engine =
                MockEngine {
                    calls += 1
                    respond("""{"code":"UNAUTHORIZED"}""", HttpStatusCode.Unauthorized, jsonHeaders)
                }
            val provider =
                object : TokenProvider {
                    override suspend fun token(): String? = null

                    override suspend fun onUnauthorized(failedToken: String?): Boolean {
                        hookCalls += 1
                        return false
                    }
                }
            val client = buildApiHttpClient(engine, testConfig(tokenProvider = provider, maxRetries = 2))

            val result = client.safeRequest<Sample>(path = "/x")

            assertEquals(401, assertIs<ApiError.Http>(result.exceptionOrNull()).status)
            assertEquals(1, hookCalls)
            assertEquals(1, calls)
        }

    @Test
    fun unauthorizedHookIsInvokedAtMostOncePerRequest() =
        runTestBlocking {
            var calls = 0
            var hookCalls = 0
            // Server keeps returning 401 even after the refresh.
            val engine =
                MockEngine {
                    calls += 1
                    respond("""{"code":"UNAUTHORIZED"}""", HttpStatusCode.Unauthorized, jsonHeaders)
                }
            val provider =
                object : TokenProvider {
                    override suspend fun token(): String = "x"

                    override suspend fun onUnauthorized(failedToken: String?): Boolean {
                        hookCalls += 1
                        return true
                    }
                }
            val client = buildApiHttpClient(engine, testConfig(tokenProvider = provider, maxRetries = 2))

            val result = client.safeRequest<Sample>(path = "/x")

            assertEquals(401, assertIs<ApiError.Http>(result.exceptionOrNull()).status)
            assertEquals(1, hookCalls)
        }

    @Test
    fun unauthorizedHookReceivesTheTokenFromTheFailedAttempt() =
        runTestBlocking {
            var seenFailedToken: String? = "unset"
            val engine =
                MockEngine { request ->
                    if (request.headers[HttpHeaders.Authorization] == "Bearer fresh") {
                        respond("""{"name":"ok","count":1}""", HttpStatusCode.OK, jsonHeaders)
                    } else {
                        respond("""{"code":"UNAUTHORIZED"}""", HttpStatusCode.Unauthorized, jsonHeaders)
                    }
                }
            var token = "stale"
            val provider =
                object : TokenProvider {
                    override suspend fun token(): String = token

                    override suspend fun onUnauthorized(failedToken: String?): Boolean {
                        seenFailedToken = failedToken
                        token = "fresh"
                        return true
                    }
                }
            val client = buildApiHttpClient(engine, testConfig(tokenProvider = provider, maxRetries = 2))

            client.request<Sample>(path = "/x")

            assertEquals("stale", seenFailedToken)
        }
}
