package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthBrowser
import io.teslasync.shared.core.auth.AuthException
import io.teslasync.shared.core.auth.AuthService
import io.teslasync.shared.core.auth.OidcConfig
import io.teslasync.shared.core.auth.RedirectResult
import io.teslasync.shared.core.auth.SecureTokenStore
import io.teslasync.shared.core.auth.TokenEndpointClient
import io.teslasync.shared.core.auth.TokenGrant
import io.teslasync.shared.core.auth.TokenSet
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the app wires the REAL shared-core `AuthService` correctly through the lens A4 owns: the
 * secure-storage seam and the networking token provider. The token endpoint's successful grants use
 * an internal constructor (so the rotation happy-path is covered by the shared `:core` tests); here
 * a fake store (the public [TokenSet] round-trips) and a fake endpoint that fails refresh exercise:
 *
 *  - a restored session attaches its bearer through `asTokenProvider().token()`;
 *  - a 401 triggers exactly one refresh attempt and a transient failure keeps the session;
 *  - the single-flight collapse replays without a network call when the credential already rotated;
 *  - sign-out revokes and clears secure storage so no token survives.
 *
 * No real crypto, storage, browser, or network is touched.
 */
class AuthServiceWiringTest {
    @Test
    fun restoredTokenIsAttachedAndSignOutRevokesAndClearsStorage() =
        runTest {
            val store = InMemoryTokenStore(TokenSet("access-1", "refresh-1", "id-1", FAR_FUTURE))
            val endpoint = FailingRefreshEndpoint()
            val service = AuthService(endpoint, store, OIDC, UnusedBrowser(), nowEpochSeconds = { 0L })
            service.restore()
            val provider = service.asTokenProvider()

            assertEquals("access-1", provider.token())

            service.signOut()

            assertEquals(1, endpoint.revokeCount)
            assertEquals(1, store.clearCount)
            assertNull(provider.token())
        }

    @Test
    fun unauthorizedAttemptsExactlyOneRefreshAndKeepsSessionOnTransientFailure() =
        runTest {
            val store = InMemoryTokenStore(TokenSet("access-1", "refresh-1", null, FAR_FUTURE))
            val endpoint = FailingRefreshEndpoint()
            val service = AuthService(endpoint, store, OIDC, UnusedBrowser(), nowEpochSeconds = { 0L })
            service.restore()
            val provider = service.asTokenProvider()

            val replay = provider.onUnauthorized("access-1")

            assertFalse("a transient refresh failure must not replay", replay)
            assertEquals("exactly one refresh attempt per 401", 1, endpoint.refreshCount)
            assertEquals("the session is preserved on a transient failure", "access-1", provider.token())
        }

    @Test
    fun unauthorizedWithAlreadyRotatedCredentialReplaysWithoutRefreshing() =
        runTest {
            val store = InMemoryTokenStore(TokenSet("access-1", "refresh-1", null, FAR_FUTURE))
            val endpoint = FailingRefreshEndpoint()
            val service = AuthService(endpoint, store, OIDC, UnusedBrowser(), nowEpochSeconds = { 0L })
            service.restore()
            val provider = service.asTokenProvider()

            // The token attached to the failed attempt is already stale (another caller refreshed):
            // the provider should replay without a second network round-trip (single-flight collapse).
            val replay = provider.onUnauthorized("an-older-token")

            assertTrue(replay)
            assertEquals(0, endpoint.refreshCount)
        }

    private class InMemoryTokenStore(
        initial: TokenSet?,
    ) : SecureTokenStore {
        private var stored: TokenSet? = initial
        var clearCount = 0

        override suspend fun load(): TokenSet? = stored

        override suspend fun save(tokens: TokenSet) {
            stored = tokens
        }

        override suspend fun clear() {
            stored = null
            clearCount += 1
        }
    }

    private class FailingRefreshEndpoint : TokenEndpointClient {
        var refreshCount = 0
        var revokeCount = 0

        override suspend fun exchangeAuthorizationCode(
            code: String,
            codeVerifier: String,
        ): TokenGrant = error("exchange is unused in this wiring test")

        override suspend fun refresh(refreshToken: String): TokenGrant {
            refreshCount += 1
            throw AuthException.Transport("refresh failed")
        }

        override suspend fun revoke(
            token: String,
            hint: String,
        ) {
            revokeCount += 1
        }
    }

    private class UnusedBrowser : AuthBrowser {
        override suspend fun authorize(authorizeUrl: String): RedirectResult = error("the browser is unused in this wiring test")
    }

    private companion object {
        const val FAR_FUTURE = 9_999_999_999L
        val OIDC =
            OidcConfig(
                clientId = "teslasync-android",
                redirectUri = "io.teslasync.android://oauth2redirect",
                authorizationEndpoint = "https://auth.test/application/o/authorize/",
                tokenEndpoint = "https://auth.test/application/o/token/",
                revocationEndpoint = "https://auth.test/application/o/revoke/",
            )
    }
}
