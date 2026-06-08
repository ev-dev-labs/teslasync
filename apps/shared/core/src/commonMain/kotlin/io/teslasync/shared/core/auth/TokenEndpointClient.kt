package io.teslasync.shared.core.auth

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.request.forms.submitForm
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.Parameters
import io.teslasync.shared.core.net.defaultHttpClientEngine
import kotlinx.serialization.json.Json
import kotlin.coroutines.cancellation.CancellationException

/**
 * Talks to the OAuth 2.0 token + revocation endpoints (Authentik). This is a
 * deliberately separate client from the TeslaSync `ApiHttpClient`: those endpoints
 * are absolute provider URLs using `application/x-www-form-urlencoded` requests,
 * whereas `ApiHttpClient` is JSON and hard-prefixes `/api/v1` against the API host.
 */
public interface TokenEndpointClient {
    /** Exchanges an authorization [code] (+ PKCE [codeVerifier]) for tokens. */
    public suspend fun exchangeAuthorizationCode(
        code: String,
        codeVerifier: String,
    ): TokenGrant

    /** Redeems a [refreshToken] for a new token grant. */
    public suspend fun refresh(refreshToken: String): TokenGrant

    /** Best-effort revoke of [token] (`token_type_hint` = [hint]). No-op if unsupported. */
    public suspend fun revoke(
        token: String,
        hint: String,
    )
}

/**
 * [TokenEndpointClient] over a raw Ktor [HttpClient]. Posts form-encoded grants to
 * [OidcConfig.tokenEndpoint], validates the OAuth response, and maps provider errors
 * to [AuthException.OAuth] while transport failures become [AuthException.Transport].
 */
public class KtorTokenEndpointClient internal constructor(
    private val client: HttpClient,
    private val config: OidcConfig,
    private val json: Json,
) : TokenEndpointClient {
    override suspend fun exchangeAuthorizationCode(
        code: String,
        codeVerifier: String,
    ): TokenGrant =
        tokenRequest(
            Parameters.build {
                append("grant_type", "authorization_code")
                append("code", code)
                append("code_verifier", codeVerifier)
                append("redirect_uri", config.redirectUri)
                append("client_id", config.clientId)
            },
        )

    override suspend fun refresh(refreshToken: String): TokenGrant =
        tokenRequest(
            Parameters.build {
                append("grant_type", "refresh_token")
                append("refresh_token", refreshToken)
                append("client_id", config.clientId)
                append("scope", config.scopes.joinToString(" "))
            },
        )

    override suspend fun revoke(
        token: String,
        hint: String,
    ) {
        val endpoint = config.revocationEndpoint ?: return
        val response =
            try {
                client.submitForm(
                    url = endpoint,
                    formParameters =
                        Parameters.build {
                            append("token", token)
                            append("token_type_hint", hint)
                            append("client_id", config.clientId)
                        },
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                throw AuthException.Transport("Token revocation request failed", e)
            }
        // RFC 7009: a successful revocation responds 200; treat anything else as a
        // best-effort failure the caller may ignore.
        if (response.status.value !in 200..299) {
            throw AuthException.Transport("Token revocation returned HTTP ${response.status.value}")
        }
    }

    private suspend fun tokenRequest(form: Parameters): TokenGrant {
        val response: HttpResponse =
            try {
                client.submitForm(url = config.tokenEndpoint, formParameters = form)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                throw AuthException.Transport("Token endpoint request failed", e)
            }

        val body =
            try {
                response.bodyAsText()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                throw AuthException.Transport("Failed to read token endpoint response", e)
            }

        val status = response.status.value
        if (status !in 200..299) {
            val oauthError = decodeOrNull<OAuthErrorResponse>(body)?.error
            if (oauthError != null) {
                throw AuthException.OAuth(oauthError, decodeOrNull<OAuthErrorResponse>(body)?.errorDescription)
            }
            throw AuthException.Transport("Token endpoint returned HTTP $status")
        }

        val parsed =
            decodeOrNull<TokenResponse>(body)
                ?: throw AuthException.InvalidResponse("Token response was not valid JSON")
        return parsed.toGrantOrThrow()
    }

    private inline fun <reified T> decodeOrNull(body: String): T? =
        try {
            json.decodeFromString<T>(body)
        } catch (e: Throwable) {
            null
        }
}

/** Validates required OAuth fields and converts to a [TokenGrant]. */
private fun TokenResponse.toGrantOrThrow(): TokenGrant {
    val access = accessToken
    if (access.isNullOrEmpty()) {
        throw AuthException.InvalidResponse("Token response missing access_token")
    }
    if (tokenType != null && !tokenType.equals("Bearer", ignoreCase = true)) {
        throw AuthException.InvalidResponse("Unsupported token_type: $tokenType")
    }
    val ttl = expiresIn
    if (ttl == null || ttl <= 0) {
        throw AuthException.InvalidResponse("Token response missing a positive expires_in")
    }
    return TokenGrant(
        accessToken = access,
        refreshToken = refreshToken?.takeIf { it.isNotEmpty() },
        idToken = idToken?.takeIf { it.isNotEmpty() },
        expiresInSeconds = ttl,
    )
}

/**
 * Builds a production [KtorTokenEndpointClient] using the platform default engine
 * (OkHttp on Android, Darwin on Apple). Tests construct the internal constructor with
 * a Ktor `MockEngine`-backed client so no real network is touched.
 */
public fun KtorTokenEndpointClient(
    config: OidcConfig,
    json: Json = defaultAuthJson,
): KtorTokenEndpointClient = KtorTokenEndpointClient(buildTokenHttpClient(defaultHttpClientEngine()), config, json)

/** Creates the form-posting HTTP client (status handled manually, no throw-on-error). */
internal fun buildTokenHttpClient(engine: HttpClientEngine): HttpClient =
    HttpClient(engine) {
        expectSuccess = false
    }
