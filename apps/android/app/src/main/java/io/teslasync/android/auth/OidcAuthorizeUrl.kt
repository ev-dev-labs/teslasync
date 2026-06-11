// File holds the OIDC authorize-URL parser plus its parameter type (a supporting declaration).
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.auth

import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * The fields the platform browser layer needs out of the shared-core authorize URL. The PKCE
 * [codeChallenge] (NOT the verifier — that stays private to the core) and the [state] are
 * per-request values the core generated; they are reused verbatim so the request AppAuth opens and
 * the redirect the core validates line up exactly.
 */
internal data class OidcAuthorizeParams(
    val authorizationEndpoint: String,
    val clientId: String,
    val redirectUri: String,
    val scope: String,
    val state: String,
    val codeChallenge: String,
    val codeChallengeMethod: String,
    val responseType: String,
    val nonce: String?,
)

/**
 * Pure helpers (no Android framework, no AppAuth) for the OIDC authorize URL the shared core builds.
 *
 * [parse] decomposes that URL so the Android browser activity can reconstruct an equivalent AppAuth
 * request, and [callbackUri] reassembles the success redirect from the authorization response so the
 * shared core's `parseRedirect` can validate `state` and extract the `code`. Kept framework-free
 * (java.net only) so both are covered by JVM unit tests.
 */
internal object OidcAuthorizeUrl {
    /** Parses [authorizeUrl]; throws [IllegalArgumentException] when malformed or missing a required param. */
    fun parse(authorizeUrl: String): OidcAuthorizeParams {
        val uri =
            try {
                URI(authorizeUrl)
            } catch (e: URISyntaxException) {
                throw IllegalArgumentException("Malformed authorize URL", e)
            }
        val params = parseQuery(uri.rawQuery)
        return OidcAuthorizeParams(
            authorizationEndpoint = endpointOf(uri),
            clientId = required(params, "client_id"),
            redirectUri = required(params, "redirect_uri"),
            scope = params["scope"].orEmpty(),
            state = required(params, "state"),
            codeChallenge = required(params, "code_challenge"),
            codeChallengeMethod = params["code_challenge_method"] ?: "S256",
            responseType = params["response_type"] ?: "code",
            nonce = params["nonce"],
        )
    }

    /** Reassembles the success callback URI `redirectUri?code=…&state=…` (values URL-encoded). */
    fun callbackUri(
        redirectUri: String,
        code: String,
        state: String,
    ): String {
        val separator = if (redirectUri.contains('?')) "&" else "?"
        return "$redirectUri${separator}code=${encode(code)}&state=${encode(state)}"
    }

    private fun endpointOf(uri: URI): String =
        buildString {
            append(uri.scheme).append("://").append(uri.rawAuthority)
            uri.rawPath?.takeIf { it.isNotEmpty() }?.let { append(it) }
        }

    private fun parseQuery(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrEmpty()) return emptyMap()
        return rawQuery
            .split("&")
            .filter { it.isNotEmpty() }
            .associate { pair ->
                val idx = pair.indexOf('=')
                if (idx < 0) {
                    decode(pair) to ""
                } else {
                    decode(pair.substring(0, idx)) to decode(pair.substring(idx + 1))
                }
            }
    }

    private fun required(
        params: Map<String, String>,
        key: String,
    ): String =
        params[key]?.takeIf { it.isNotEmpty() }
            ?: throw IllegalArgumentException("Authorize URL is missing required parameter '$key'")

    private fun decode(value: String): String = URLDecoder.decode(value, "UTF-8")

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8")
}
