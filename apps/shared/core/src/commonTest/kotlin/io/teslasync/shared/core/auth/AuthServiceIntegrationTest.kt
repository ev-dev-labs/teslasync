package io.teslasync.shared.core.auth

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.teslasync.shared.core.net.Sample
import io.teslasync.shared.core.net.buildApiHttpClient
import io.teslasync.shared.core.net.jsonHeaders
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.runTestBlocking
import io.teslasync.shared.core.net.testConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class AuthServiceIntegrationTest {
    @Test
    fun a401TriggersASingleRefreshThenTheRequestSucceeds() =
        runTestBlocking {
            var tokenCalls = 0
            val tokenEngine =
                MockEngine {
                    tokenCalls += 1
                    respond(
                        """{"access_token":"fresh","refresh_token":"r2","token_type":"Bearer","expires_in":600}""",
                        HttpStatusCode.OK,
                        jsonHeaders,
                    )
                }
            val tokenClient =
                KtorTokenEndpointClient(buildTokenHttpClient(tokenEngine), testOidcConfig, defaultAuthJson)

            val store = InMemorySecureTokenStore(tokenSet("stale", "r1", expiresAt = 100_000))
            val svc =
                AuthService(
                    tokenClient = tokenClient,
                    store = store,
                    config = testOidcConfig,
                    browser = AuthBrowser { error("unused") },
                    nowEpochSeconds = { 1_000 },
                )
            svc.restore()

            var apiCalls = 0
            val apiEngine =
                MockEngine { request ->
                    apiCalls += 1
                    if (request.headers[HttpHeaders.Authorization] == "Bearer fresh") {
                        respond("""{"name":"ok","count":1}""", HttpStatusCode.OK, jsonHeaders)
                    } else {
                        respond("""{"code":"UNAUTHORIZED"}""", HttpStatusCode.Unauthorized, jsonHeaders)
                    }
                }
            val api =
                buildApiHttpClient(
                    apiEngine,
                    testConfig(tokenProvider = svc.asTokenProvider(), maxRetries = 2),
                )

            val result: Sample = api.request(path = "/x")

            assertEquals("ok", result.name)
            // The stale call 401'd, one refresh occurred, the replay with the fresh
            // token succeeded → two API calls and exactly one token-endpoint call.
            assertEquals(2, apiCalls)
            assertEquals(1, tokenCalls)
            assertEquals("fresh", svc.currentAccessToken)
            assertIs<AuthState.SignedIn>(svc.state.value)
        }
}
