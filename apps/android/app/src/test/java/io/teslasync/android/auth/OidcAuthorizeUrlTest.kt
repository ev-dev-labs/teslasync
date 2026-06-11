package io.teslasync.android.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * JVM unit tests for [OidcAuthorizeUrl]: parsing the shared-core authorize URL into the fields the
 * AppAuth request needs, and reassembling the success callback URI the shared core then validates.
 */
class OidcAuthorizeUrlTest {
    @Test
    fun parseExtractsEveryAuthorizeParameter() {
        val url =
            "https://auth.test/application/o/authorize/?response_type=code&client_id=teslasync-android" +
                "&redirect_uri=io.teslasync.android%3A%2F%2Foauth2redirect&scope=openid%20profile%20offline_access" +
                "&state=STATE-123&nonce=NONCE-9&code_challenge=CHALLENGE&code_challenge_method=S256"

        val params = OidcAuthorizeUrl.parse(url)

        assertEquals("https://auth.test/application/o/authorize/", params.authorizationEndpoint)
        assertEquals("teslasync-android", params.clientId)
        assertEquals("io.teslasync.android://oauth2redirect", params.redirectUri)
        assertEquals("openid profile offline_access", params.scope)
        assertEquals("STATE-123", params.state)
        assertEquals("NONCE-9", params.nonce)
        assertEquals("CHALLENGE", params.codeChallenge)
        assertEquals("S256", params.codeChallengeMethod)
        assertEquals("code", params.responseType)
    }

    @Test
    fun parseDefaultsMethodAndResponseTypeAndAllowsAbsentNonce() {
        val url =
            "https://auth.test/o/authorize/?client_id=c&redirect_uri=app%3A%2F%2Fcb&state=s&code_challenge=ch"

        val params = OidcAuthorizeUrl.parse(url)

        assertEquals("S256", params.codeChallengeMethod)
        assertEquals("code", params.responseType)
        assertNull(params.nonce)
    }

    @Test(expected = IllegalArgumentException::class)
    fun parseRejectsAuthorizeUrlMissingRequiredState() {
        OidcAuthorizeUrl.parse("https://auth.test/o/authorize/?client_id=c&redirect_uri=app%3A%2F%2Fcb&code_challenge=ch")
    }

    @Test
    fun callbackUriAppendsCodeAndStateWithQuerySeparator() {
        val uri = OidcAuthorizeUrl.callbackUri("io.teslasync.android://oauth2redirect", "abc", "xyz")
        assertEquals("io.teslasync.android://oauth2redirect?code=abc&state=xyz", uri)
    }

    @Test
    fun callbackUriUsesAmpersandWhenRedirectAlreadyHasQuery() {
        val uri = OidcAuthorizeUrl.callbackUri("https://app.example/cb?ref=1", "abc", "xyz")
        assertEquals("https://app.example/cb?ref=1&code=abc&state=xyz", uri)
    }

    @Test
    fun callbackUriUrlEncodesReservedCharacters() {
        val uri = OidcAuthorizeUrl.callbackUri("app://cb", "a/b+c", "p&q")
        assertEquals("app://cb?code=a%2Fb%2Bc&state=p%26q", uri)
    }
}
