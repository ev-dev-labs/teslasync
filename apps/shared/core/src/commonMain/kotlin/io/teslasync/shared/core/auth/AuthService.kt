package io.teslasync.shared.core.auth

import io.teslasync.shared.core.net.TokenProvider
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.cancellation.CancellationException
import kotlin.time.Clock

/**
 * The platform-agnostic authentication core: OIDC Authorization-Code-with-PKCE
 * against Authentik (ADR-008). It owns all crypto and token logic — building the
 * authorize request, exchanging the code, refreshing and revoking tokens — and
 * persists credentials through an injected [SecureTokenStore]. The interactive
 * browser round-trip is delegated to an [AuthBrowser]; the TeslaSync API plumbing is
 * fed via [asTokenProvider].
 *
 * All token-mutating operations (sign-in, refresh, sign-out, restore) are serialized
 * by a single [mutex] so a refresh cannot resurrect a session a concurrent sign-out
 * just cleared, and concurrent 401s collapse into one refresh (single-flight).
 *
 * @param tokenClient talks to the provider token/revocation endpoints.
 * @param store secure persistence for the [TokenSet].
 * @param config the OIDC public-client configuration.
 * @param browser platform seam for the authorize redirect round-trip.
 * @param nowEpochSeconds clock seam (injectable for deterministic tests).
 * @param proactiveRefreshSkewSeconds refresh this many seconds before access-token
 *   expiry on the next [TokenProvider.token] read.
 */
public class AuthService(
    private val tokenClient: TokenEndpointClient,
    private val store: SecureTokenStore,
    private val config: OidcConfig,
    private val browser: AuthBrowser,
    private val nowEpochSeconds: () -> Long = { Clock.System.now().epochSeconds },
    private val proactiveRefreshSkewSeconds: Long = 60,
) {
    private val mutex = Mutex()
    private val mutableState = MutableStateFlow<AuthState>(AuthState.SignedOut)
    private var tokens: TokenSet? = null

    /** Observable session state. */
    public val state: StateFlow<AuthState> = mutableState.asStateFlow()

    /** The current access token if signed in (no refresh), else `null`. */
    public val currentAccessToken: String? get() = tokens?.accessToken

    /**
     * Rehydrates session state from the secure store on startup. Sets [AuthState] to
     * [AuthState.SignedIn] when a token set is present, otherwise [AuthState.SignedOut].
     */
    public suspend fun restore() {
        mutex.withLock {
            val stored = store.load()
            tokens = stored
            mutableState.value = stored?.let { AuthState.SignedIn(it) } ?: AuthState.SignedOut
        }
    }

    /**
     * Runs the full interactive sign-in: generates PKCE + `state`/`nonce`, builds the
     * authorize URL, delegates the browser round-trip, validates the callback, and
     * exchanges the code for tokens (persisted before they become current). On any
     * failure the state becomes [AuthState.Error] and a `Result.failure` is returned.
     */
    public suspend fun signIn(): Result<TokenSet> {
        mutableState.value = AuthState.Authenticating
        return try {
            val pkce = generatePkce()
            val expectedState = randomUrlToken()
            val nonce = randomUrlToken()
            val authorizeUrl = buildAuthorizeUrl(config, pkce, expectedState, nonce)

            val redirect = browser.authorize(authorizeUrl)
            val parsed = parseRedirect(redirect.callbackUri, config)
            if (parsed.state != expectedState) {
                throw AuthException.StateMismatch()
            }

            val grant = tokenClient.exchangeAuthorizationCode(parsed.code, pkce.verifier)
            val tokenSet = grant.toTokenSet(previousRefresh = null, now = nowEpochSeconds())
            commit(tokenSet)
            Result.success(tokenSet)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            mutableState.value = AuthState.Error(e.message ?: "Sign-in failed", e)
            Result.failure(e)
        }
    }

    /**
     * Revokes the refresh token (best-effort) and clears all local credentials,
     * ending in [AuthState.SignedOut]. Serialized with refresh so an in-flight refresh
     * cannot re-establish the session afterwards.
     */
    public suspend fun signOut() {
        mutex.withLock {
            val current = tokens
            if (current != null) {
                runCatching { tokenClient.revoke(current.refreshToken, "refresh_token") }
            }
            tokens = null
            runCatching { store.clear() }
            mutableState.value = AuthState.SignedOut
        }
    }

    /**
     * Adapts this service to the S4 [TokenProvider] seam: attaches the current access
     * token (refreshing proactively when it is near expiry) and performs a
     * single-flight refresh-and-retry on a 401.
     */
    public fun asTokenProvider(): TokenProvider =
        object : TokenProvider {
            override suspend fun token(): String? {
                val current = tokens ?: return null
                if (current.isExpiringWithin(proactiveRefreshSkewSeconds, nowEpochSeconds())) {
                    refreshLocked(current.accessToken)
                }
                return tokens?.accessToken
            }

            override suspend fun onUnauthorized(failedToken: String?): Boolean = refreshLocked(failedToken)
        }

    /** Persists then promotes [tokenSet] to current; a persistence failure signs out. */
    private suspend fun commit(tokenSet: TokenSet) {
        mutex.withLock {
            try {
                store.save(tokenSet)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                tokens = null
                runCatching { store.clear() }
                mutableState.value = AuthState.SignedOut
                throw AuthException.Transport("Failed to persist tokens", e)
            }
            tokens = tokenSet
            mutableState.value = AuthState.SignedIn(tokenSet)
        }
    }

    /**
     * Single-flight refresh. [failedToken] is the access token whose use triggered
     * the refresh (the 401'd bearer, or the near-expiry token). Under the lock, if the
     * current token already differs from [failedToken] another caller refreshed first,
     * so the request can simply be replayed (`true`) without a second network call.
     *
     * Returns `true` when a valid token is now available (refreshed or already-fresh),
     * `false` otherwise. An `invalid_grant` wipes the session; transient transport
     * failures keep the existing tokens so a later attempt can retry.
     */
    private suspend fun refreshLocked(failedToken: String?): Boolean =
        mutex.withLock {
            val current = tokens ?: return@withLock false
            if (failedToken != null && current.accessToken != failedToken) {
                return@withLock true
            }

            mutableState.value = AuthState.Refreshing(current)
            try {
                val grant = tokenClient.refresh(current.refreshToken)
                val refreshed = grant.toTokenSet(previousRefresh = current.refreshToken, now = nowEpochSeconds())
                try {
                    store.save(refreshed)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Throwable) {
                    tokens = null
                    runCatching { store.clear() }
                    mutableState.value = AuthState.SignedOut
                    return@withLock false
                }
                tokens = refreshed
                mutableState.value = AuthState.SignedIn(refreshed)
                true
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthException.OAuth) {
                if (e.isInvalidGrant) {
                    tokens = null
                    runCatching { store.clear() }
                    mutableState.value = AuthState.SignedOut
                } else {
                    // A non-fatal OAuth error: keep the session and let a later call retry.
                    mutableState.value = AuthState.SignedIn(current)
                }
                false
            } catch (e: Throwable) {
                // Transport/timeout/decode failure: keep credentials, stay signed in.
                mutableState.value = AuthState.SignedIn(current)
                false
            }
        }
}

/**
 * Converts a validated [TokenGrant] to an absolute-expiry [TokenSet], falling back to
 * [previousRefresh] when the provider did not return a rotated refresh token.
 */
internal fun TokenGrant.toTokenSet(
    previousRefresh: String?,
    now: Long,
): TokenSet {
    val refresh =
        refreshToken ?: previousRefresh
            ?: throw AuthException.InvalidResponse("Token grant did not include a refresh token")
    return TokenSet(
        accessToken = accessToken,
        refreshToken = refresh,
        idToken = idToken,
        expiresAtEpochSeconds = now + expiresInSeconds,
    )
}
