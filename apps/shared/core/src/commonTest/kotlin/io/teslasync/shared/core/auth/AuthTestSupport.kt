package io.teslasync.shared.core.auth

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.forms.FormDataContent
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.http.formUrlEncode
import io.ktor.http.headersOf
import io.ktor.http.parseQueryString

/** Fixed OIDC config used across the auth tests (no real provider is contacted). */
internal val testOidcConfig: OidcConfig =
    OidcConfig(
        clientId = "teslasync-test",
        redirectUri = "teslasync://oauth/callback",
        authorizationEndpoint = "https://auth.test/application/o/authorize/",
        tokenEndpoint = "https://auth.test/application/o/token/",
        revocationEndpoint = "https://auth.test/application/o/revoke/",
    )

/**
 * In-memory [SecureTokenStore] fake. Records call counts and can be made to fail its
 * [save] so persistence-failure paths are exercised without touching real storage.
 */
internal class InMemorySecureTokenStore(
    initial: TokenSet? = null,
) : SecureTokenStore {
    var stored: TokenSet? = initial
    var saveCount: Int = 0
    var clearCount: Int = 0
    var loadCount: Int = 0
    var failSave: Boolean = false

    override suspend fun load(): TokenSet? {
        loadCount += 1
        return stored
    }

    override suspend fun save(tokens: TokenSet) {
        if (failSave) {
            throw RuntimeException("secure store write failed")
        }
        stored = tokens
        saveCount += 1
    }

    override suspend fun clear() {
        stored = null
        clearCount += 1
    }
}

/**
 * Deterministic [TokenEndpointClient] fake for the [AuthService] tests. Records call
 * counts (so single-flight can be asserted) and lets each test pin the grant returned
 * by an exchange/refresh or inject a failure.
 */
internal class FakeTokenEndpoint : TokenEndpointClient {
    var exchangeCount: Int = 0
    var refreshCount: Int = 0
    var revokeCount: Int = 0
    var lastRevokedToken: String? = null
    var lastVerifier: String? = null
    var lastRefreshToken: String? = null

    var exchangeResult: () -> TokenGrant = { TokenGrant("access-1", "refresh-1", "id-1", 600) }
    var refreshResult: () -> TokenGrant = { TokenGrant("access-fresh", "refresh-2", "id-2", 600) }
    var refreshError: Throwable? = null
    var exchangeError: Throwable? = null

    /** Runs at the start of [refresh] (before the result/error) so tests can force interleaving. */
    var beforeRefresh: suspend () -> Unit = {}

    override suspend fun exchangeAuthorizationCode(
        code: String,
        codeVerifier: String,
    ): TokenGrant {
        exchangeCount += 1
        lastVerifier = codeVerifier
        exchangeError?.let { throw it }
        return exchangeResult()
    }

    override suspend fun refresh(refreshToken: String): TokenGrant {
        refreshCount += 1
        lastRefreshToken = refreshToken
        beforeRefresh()
        refreshError?.let { throw it }
        return refreshResult()
    }

    override suspend fun revoke(
        token: String,
        hint: String,
    ) {
        revokeCount += 1
        lastRevokedToken = token
    }
}

/** Records the form parameters of every request a [MockEngine] token client receives. */
internal class RecordingTokenEngine {
    val requests: MutableList<Parameters> = mutableListOf()

    fun engine(
        status: HttpStatusCode = HttpStatusCode.OK,
        body: () -> String,
    ): MockEngine =
        MockEngine { request ->
            requests += request.formParameters()
            respond(
                content = body(),
                status = status,
                headers = headersOf("Content-Type", "application/json"),
            )
        }

    val last: Parameters get() = requests.last()
}

/** Decodes a `submitForm` request body back into [Parameters] for assertions. */
internal fun HttpRequestData.formParameters(): Parameters {
    val raw = (body as FormDataContent).formData.formUrlEncode()
    return parseQueryString(raw)
}

/** Convenience: build a [TokenSet] with an absolute expiry relative to a fixed clock. */
internal fun tokenSet(
    access: String,
    refresh: String,
    expiresAt: Long,
    id: String? = null,
): TokenSet =
    TokenSet(
        accessToken = access,
        refreshToken = refresh,
        idToken = id,
        expiresAtEpochSeconds = expiresAt,
    )
