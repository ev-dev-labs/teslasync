package io.teslasync.shared.core.auth

import io.ktor.http.Url
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** A deterministic byte source so verifier/state/nonce are reproducible in tests. */
private fun fixedBytes(vararg fill: Int): (Int) -> ByteArray = { size -> ByteArray(size) { fill[it % fill.size].toByte() } }

class PkceTest {
    @Test
    fun generatePkceProducesAnS256PairDerivedFromTheVerifier() {
        val pkce = generatePkce(fixedBytes(0x00, 0x01, 0x02, 0x03))
        assertEquals("S256", pkce.method)
        // 32 random bytes → 43-char base64url verifier (RFC 7636 length window).
        assertEquals(43, pkce.verifier.length)
        // The challenge must be exactly BASE64URL(SHA256(verifier)).
        assertEquals(pkceChallengeFor(pkce.verifier), pkce.challenge)
    }

    @Test
    fun generatePkceIsDeterministicForAFixedRandomSource() {
        val a = generatePkce(fixedBytes(0xab))
        val b = generatePkce(fixedBytes(0xab))
        assertEquals(a.verifier, b.verifier)
        assertEquals(a.challenge, b.challenge)
    }

    @Test
    fun randomUrlTokenIsUrlSafeAndPaddingFree() {
        val token = randomUrlToken(fixedBytes(0xff, 0x00, 0x10))
        assertTrue(token.isNotEmpty())
        assertTrue(token.all { it.isLetterOrDigit() || it == '-' || it == '_' }, "unexpected char in $token")
    }

    @Test
    fun buildAuthorizeUrlIncludesAllRequiredPkceParameters() {
        val pkce = generatePkce(fixedBytes(0x07))
        val url = buildAuthorizeUrl(testOidcConfig, pkce, state = "the-state", nonce = "the-nonce")
        val parsed = Url(url)
        val params = parsed.parameters

        assertTrue(url.startsWith(testOidcConfig.authorizationEndpoint))
        assertEquals("code", params["response_type"])
        assertEquals(testOidcConfig.clientId, params["client_id"])
        assertEquals(testOidcConfig.redirectUri, params["redirect_uri"])
        assertEquals("openid profile email offline_access", params["scope"])
        assertEquals("the-state", params["state"])
        assertEquals("the-nonce", params["nonce"])
        assertEquals(pkce.challenge, params["code_challenge"])
        assertEquals("S256", params["code_challenge_method"])
    }

    @Test
    fun buildAuthorizeUrlAppendsWithAmpersandWhenEndpointAlreadyHasQuery() {
        val config =
            OidcConfig(
                clientId = "c",
                redirectUri = "app://cb",
                authorizationEndpoint = "https://auth.test/authorize?tenant=main",
                tokenEndpoint = "https://auth.test/token",
            )
        val url = buildAuthorizeUrl(config, generatePkce(fixedBytes(1)), "s", "n")
        assertTrue(url.startsWith("https://auth.test/authorize?tenant=main&"))
        assertEquals("main", Url(url).parameters["tenant"])
    }

    @Test
    fun parseRedirectReturnsCodeAndStateForAValidCallback() {
        val parsed =
            parseRedirect("teslasync://oauth/callback?code=the-code&state=the-state", testOidcConfig)
        assertEquals("the-code", parsed.code)
        assertEquals("the-state", parsed.state)
    }

    @Test
    fun parseRedirectRejectsAMismatchedRedirectTarget() {
        assertFailsWith<AuthException.RedirectMismatch> {
            parseRedirect("https://evil.test/callback?code=x&state=y", testOidcConfig)
        }
    }

    @Test
    fun parseRedirectSurfacesAProviderError() {
        val ex =
            assertFailsWith<AuthException.OAuth> {
                parseRedirect(
                    "teslasync://oauth/callback?error=access_denied&error_description=nope",
                    testOidcConfig,
                )
            }
        assertEquals("access_denied", ex.error)
        assertEquals("nope", ex.description)
    }

    @Test
    fun parseRedirectRejectsDuplicateStateParameters() {
        assertFailsWith<AuthException.InvalidResponse> {
            parseRedirect("teslasync://oauth/callback?code=x&state=a&state=b", testOidcConfig)
        }
    }

    @Test
    fun parseRedirectRejectsAMissingCode() {
        assertFailsWith<AuthException.InvalidResponse> {
            parseRedirect("teslasync://oauth/callback?state=a", testOidcConfig)
        }
    }
}
