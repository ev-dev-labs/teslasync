package io.teslasync.shared.core.auth

import io.ktor.http.Url
import io.ktor.http.encodeURLParameter

/**
 * A PKCE (RFC 7636) verifier/challenge pair. The [verifier] is kept private to the
 * app and sent only on the token exchange; the [challenge] is what travels in the
 * authorize request. [method] is always `S256` — the `plain` method is rejected.
 */
public class PkcePair internal constructor(
    public val verifier: String,
    public val challenge: String,
) {
    public val method: String get() = "S256"
}

/**
 * Derives the S256 `code_challenge` for a given `code_verifier`:
 * `BASE64URL(SHA256(ASCII(verifier)))`. Exposed for the RFC 7636 known-answer test.
 */
internal fun pkceChallengeFor(verifier: String): String = base64UrlNoPad(sha256(verifier.encodeToByteArray()))

/**
 * Generates a fresh PKCE pair: a 43-character verifier (256 bits of entropy,
 * `BASE64URL(32 random bytes)`, within RFC 7636's 43–128 length) and its S256
 * challenge. [randomBytes] is injectable so tests can pin the verifier; production
 * uses [secureRandomBytes].
 */
internal fun generatePkce(randomBytes: (Int) -> ByteArray = ::secureRandomBytes): PkcePair {
    val verifier = base64UrlNoPad(randomBytes(32))
    return PkcePair(verifier, pkceChallengeFor(verifier))
}

/**
 * A 256-bit, URL-safe random token used for the OAuth `state` (CSRF defense) and
 * `nonce` (ID-token replay defense) parameters.
 */
internal fun randomUrlToken(randomBytes: (Int) -> ByteArray = ::secureRandomBytes): String = base64UrlNoPad(randomBytes(32))

/**
 * Builds the authorization-request URL for the Authorization Code + PKCE flow. All
 * parameter values are URL-encoded. The caller retains [state]/[nonce] (and the
 * verifier) to validate the callback and exchange the code.
 */
internal fun buildAuthorizeUrl(
    config: OidcConfig,
    pkce: PkcePair,
    state: String,
    nonce: String,
): String {
    val params =
        listOf(
            "response_type" to "code",
            "client_id" to config.clientId,
            "redirect_uri" to config.redirectUri,
            "scope" to config.scopes.joinToString(" "),
            "state" to state,
            "nonce" to nonce,
            "code_challenge" to pkce.challenge,
            "code_challenge_method" to pkce.method,
        )
    val query =
        params.joinToString("&") { (key, value) ->
            "${key.encodeURLParameter()}=${value.encodeURLParameter()}"
        }
    val separator = if (config.authorizationEndpoint.contains('?')) "&" else "?"
    return "${config.authorizationEndpoint}$separator$query"
}

/** The authorization `code` + echoed `state` parsed from a verified redirect. */
internal class ParsedRedirect(
    val code: String,
    val state: String,
)

/**
 * Parses and validates an authorization-response callback URI. Enforces that the
 * callback matches the configured redirect (scheme + host + path prefix), surfaces a
 * provider `error` as [AuthException.OAuth], and rejects ambiguous responses
 * (missing/duplicate `state` or `code`, or both `code` and `error`). State equality
 * is checked by the caller against the value it generated.
 */
internal fun parseRedirect(
    callbackUri: String,
    config: OidcConfig,
): ParsedRedirect {
    val url =
        try {
            Url(callbackUri)
        } catch (e: Throwable) {
            throw AuthException.RedirectMismatch("Unparseable redirect URI")
        }
    val expected = Url(config.redirectUri)
    val sameTarget =
        url.protocol.name.equals(expected.protocol.name, ignoreCase = true) &&
            url.host.equals(expected.host, ignoreCase = true) &&
            url.encodedPath.startsWith(expected.encodedPath)
    if (!sameTarget) {
        throw AuthException.RedirectMismatch("Redirect URI does not match the configured callback")
    }

    val params = url.parameters
    val errors = params.getAll("error").orEmpty()
    if (errors.isNotEmpty()) {
        throw AuthException.OAuth(errors.first(), params["error_description"])
    }

    val states = params.getAll("state").orEmpty()
    val codes = params.getAll("code").orEmpty()
    if (states.size != 1) {
        throw AuthException.InvalidResponse("Redirect is missing a single state value")
    }
    if (codes.size != 1) {
        throw AuthException.InvalidResponse("Redirect is missing a single code value")
    }
    return ParsedRedirect(code = codes.first(), state = states.first())
}
