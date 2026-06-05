package io.teslasync.shared.core.auth

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.teslasync.shared.core.net.runTestBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

private fun jsonHeaders() = headersOf("Content-Type", "application/json")

private fun tokenClient(
    recorder: RecordingTokenEngine,
    status: HttpStatusCode = HttpStatusCode.OK,
    body: () -> String,
): KtorTokenEndpointClient = KtorTokenEndpointClient(buildTokenHttpClient(recorder.engine(status, body)), testOidcConfig, defaultAuthJson)

class TokenEndpointClientTest {
    @Test
    fun exchangePostsTheCorrectPkceFormAndParsesTokens() =
        runTestBlocking {
            val recorder = RecordingTokenEngine()
            val client =
                tokenClient(recorder) {
                    """{"access_token":"acc","refresh_token":"ref","id_token":"idt","token_type":"Bearer","expires_in":600}"""
                }

            val grant = client.exchangeAuthorizationCode(code = "the-code", codeVerifier = "the-verifier")

            val form = recorder.last
            assertEquals("authorization_code", form["grant_type"])
            assertEquals("the-code", form["code"])
            assertEquals("the-verifier", form["code_verifier"])
            assertEquals(testOidcConfig.redirectUri, form["redirect_uri"])
            assertEquals(testOidcConfig.clientId, form["client_id"])

            assertEquals("acc", grant.accessToken)
            assertEquals("ref", grant.refreshToken)
            assertEquals("idt", grant.idToken)
            assertEquals(600, grant.expiresInSeconds)
        }

    @Test
    fun refreshPostsTheRefreshGrantForm() =
        runTestBlocking {
            val recorder = RecordingTokenEngine()
            val client =
                tokenClient(recorder) {
                    """{"access_token":"acc2","token_type":"Bearer","expires_in":600}"""
                }

            val grant = client.refresh("the-refresh-token")

            val form = recorder.last
            assertEquals("refresh_token", form["grant_type"])
            assertEquals("the-refresh-token", form["refresh_token"])
            assertEquals(testOidcConfig.clientId, form["client_id"])
            // No rotated refresh token in the response → grant carries null.
            assertEquals("acc2", grant.accessToken)
            assertNullRefresh(grant)
        }

    @Test
    fun invalidGrantErrorBecomesAnOAuthException() =
        runTestBlocking {
            val recorder = RecordingTokenEngine()
            val client =
                tokenClient(recorder, status = HttpStatusCode.BadRequest) {
                    """{"error":"invalid_grant","error_description":"expired"}"""
                }

            val ex = assertFailsWith<AuthException.OAuth> { client.refresh("dead-token") }
            assertTrue(ex.isInvalidGrant)
            assertEquals("expired", ex.description)
        }

    @Test
    fun aMalformedSuccessBodyBecomesInvalidResponse() =
        runTestBlocking {
            val recorder = RecordingTokenEngine()
            val client = tokenClient(recorder) { "not-json-at-all" }

            assertFailsWith<AuthException.InvalidResponse> {
                client.exchangeAuthorizationCode("c", "v")
            }
        }

    @Test
    fun aSuccessBodyMissingExpiryBecomesInvalidResponse() =
        runTestBlocking {
            val recorder = RecordingTokenEngine()
            val client =
                tokenClient(recorder) { """{"access_token":"acc","token_type":"Bearer"}""" }

            assertFailsWith<AuthException.InvalidResponse> {
                client.exchangeAuthorizationCode("c", "v")
            }
        }

    @Test
    fun aNon2xxWithoutAnOAuthErrorBecomesTransport() =
        runTestBlocking {
            val recorder = RecordingTokenEngine()
            val client =
                tokenClient(recorder, status = HttpStatusCode.InternalServerError) { "upstream boom" }

            assertFailsWith<AuthException.Transport> {
                client.refresh("r")
            }
        }

    @Test
    fun revokePostsToTheRevocationEndpoint() =
        runTestBlocking {
            var seenUrl: String? = null
            val engine =
                MockEngine { request ->
                    seenUrl = request.url.toString()
                    respond("", HttpStatusCode.OK, jsonHeaders())
                }
            val client = KtorTokenEndpointClient(buildTokenHttpClient(engine), testOidcConfig, defaultAuthJson)

            client.revoke("the-token", "refresh_token")

            assertEquals(testOidcConfig.revocationEndpoint, seenUrl)
        }
}

/** Asserts a refreshed grant did not include a rotated refresh token. */
private fun assertNullRefresh(grant: TokenGrant) {
    assertEquals(null, grant.refreshToken)
}
