package io.teslasync.shared.core.auth

import io.ktor.http.Url
import io.teslasync.shared.core.net.runTestBlocking
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A browser that echoes the request `state` back with a fixed authorization code. */
private fun echoingBrowser(code: String = "the-code"): AuthBrowser =
    AuthBrowser { authorizeUrl ->
        val state = Url(authorizeUrl).parameters["state"]
        RedirectResult("${testOidcConfig.redirectUri}?code=$code&state=$state")
    }

/** A browser that should never be invoked (used by refresh-only tests). */
private val unusedBrowser = AuthBrowser { error("browser must not be used in this test") }

private fun service(
    tokenClient: TokenEndpointClient,
    store: SecureTokenStore,
    browser: AuthBrowser = unusedBrowser,
    now: Long = 1_000,
    skew: Long = 60,
): AuthService =
    AuthService(
        tokenClient = tokenClient,
        store = store,
        config = testOidcConfig,
        browser = browser,
        nowEpochSeconds = { now },
        proactiveRefreshSkewSeconds = skew,
    )

class AuthServiceTest {
    @Test
    fun signInExchangesTheCodeAndPersistsTokens() =
        runTestBlocking {
            val fake = FakeTokenEndpoint()
            val store = InMemorySecureTokenStore()
            val svc = service(fake, store, browser = echoingBrowser())

            val result = svc.signIn()

            assertTrue(result.isSuccess)
            assertEquals(1, fake.exchangeCount)
            assertEquals("access-1", svc.currentAccessToken)
            // Tokens were persisted before becoming current and the verifier was carried.
            assertEquals(1, store.saveCount)
            assertEquals("access-1", store.stored?.accessToken)
            assertTrue(fake.lastVerifier?.isNotEmpty() == true)
            val state = assertIs<AuthState.SignedIn>(svc.state.value)
            assertEquals(1_600, state.tokens.expiresAtEpochSeconds)
        }

    @Test
    fun signInFailsAndEntersErrorOnAStateMismatch() =
        runTestBlocking {
            val fake = FakeTokenEndpoint()
            val store = InMemorySecureTokenStore()
            val tamperingBrowser =
                AuthBrowser { RedirectResult("${testOidcConfig.redirectUri}?code=c&state=wrong") }
            val svc = service(fake, store, browser = tamperingBrowser)

            val result = svc.signIn()

            assertTrue(result.isFailure)
            assertIs<AuthException.StateMismatch>(result.exceptionOrNull())
            assertEquals(0, fake.exchangeCount)
            assertNull(svc.currentAccessToken)
            assertIs<AuthState.Error>(svc.state.value)
        }

    @Test
    fun restoreRehydratesSignedInStateFromTheStore() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("a", "r", expiresAt = 9_999))
            val svc = service(FakeTokenEndpoint(), store)

            svc.restore()

            assertEquals("a", svc.currentAccessToken)
            assertIs<AuthState.SignedIn>(svc.state.value)
        }

    @Test
    fun restoreLeavesSignedOutWhenNothingIsStored() =
        runTestBlocking {
            val svc = service(FakeTokenEndpoint(), InMemorySecureTokenStore())

            svc.restore()

            assertNull(svc.currentAccessToken)
            assertIs<AuthState.SignedOut>(svc.state.value)
        }

    @Test
    fun tokenProviderRefreshesProactivelyWhenNearExpiry() =
        runTestBlocking {
            // Expires at 1_030; now is 1_000; 60s skew → considered expiring.
            val store = InMemorySecureTokenStore(tokenSet("stale", "r1", expiresAt = 1_030))
            val fake = FakeTokenEndpoint().apply { refreshResult = { TokenGrant("fresh", "r2", null, 600) } }
            val svc = service(fake, store)
            svc.restore()

            val token = svc.asTokenProvider().token()

            assertEquals("fresh", token)
            assertEquals(1, fake.refreshCount)
            assertEquals("fresh", store.stored?.accessToken)
        }

    @Test
    fun tokenProviderDoesNotRefreshWhenTheTokenIsFresh() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("good", "r1", expiresAt = 100_000))
            val fake = FakeTokenEndpoint()
            val svc = service(fake, store)
            svc.restore()

            val token = svc.asTokenProvider().token()

            assertEquals("good", token)
            assertEquals(0, fake.refreshCount)
        }

    @Test
    fun onUnauthorizedRefreshesOnceAndReportsSuccess() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("stale", "r1", expiresAt = 100_000))
            val fake = FakeTokenEndpoint().apply { refreshResult = { TokenGrant("fresh", "r2", null, 600) } }
            val svc = service(fake, store)
            svc.restore()

            val ok = svc.asTokenProvider().onUnauthorized("stale")

            assertTrue(ok)
            assertEquals(1, fake.refreshCount)
            assertEquals("fresh", svc.currentAccessToken)
            // The rotated refresh token was carried into the new set.
            assertEquals("r2", store.stored?.refreshToken)
        }

    @Test
    fun concurrentUnauthorizedCallsShareASingleRefresh() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("stale", "r1", expiresAt = 100_000))
            val fake =
                FakeTokenEndpoint().apply {
                    // Yield while holding the refresh lock so all callers pile up first.
                    beforeRefresh = { yield() }
                    refreshResult = { TokenGrant("fresh", "r2", null, 600) }
                }
            val svc = service(fake, store)
            svc.restore()
            val provider = svc.asTokenProvider()

            val results = MutableList(5) { false }
            coroutineScope {
                repeat(5) { i ->
                    launch { results[i] = provider.onUnauthorized("stale") }
                }
            }

            assertTrue(results.all { it })
            // Exactly one network refresh despite five concurrent 401s.
            assertEquals(1, fake.refreshCount)
            assertEquals("fresh", svc.currentAccessToken)
        }

    @Test
    fun invalidGrantOnRefreshWipesTheSession() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("stale", "r1", expiresAt = 100_000))
            val fake = FakeTokenEndpoint().apply { refreshError = AuthException.OAuth("invalid_grant") }
            val svc = service(fake, store)
            svc.restore()

            val ok = svc.asTokenProvider().onUnauthorized("stale")

            assertFalse(ok)
            assertNull(svc.currentAccessToken)
            assertNull(store.stored)
            assertTrue(store.clearCount >= 1)
            assertIs<AuthState.SignedOut>(svc.state.value)
        }

    @Test
    fun transientRefreshFailureKeepsTheSession() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("stale", "r1", expiresAt = 100_000))
            val fake = FakeTokenEndpoint().apply { refreshError = AuthException.Transport("network down") }
            val svc = service(fake, store)
            svc.restore()

            val ok = svc.asTokenProvider().onUnauthorized("stale")

            assertFalse(ok)
            // Credentials are retained so a later attempt can recover.
            assertEquals("stale", svc.currentAccessToken)
            assertEquals(tokenSet("stale", "r1", expiresAt = 100_000), store.stored)
            assertIs<AuthState.SignedIn>(svc.state.value)
        }

    @Test
    fun aPersistenceFailureDuringRefreshSignsOut() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("stale", "r1", expiresAt = 100_000))
            val fake = FakeTokenEndpoint()
            val svc = service(fake, store)
            svc.restore()
            store.failSave = true

            val ok = svc.asTokenProvider().onUnauthorized("stale")

            assertFalse(ok)
            assertNull(svc.currentAccessToken)
            assertIs<AuthState.SignedOut>(svc.state.value)
        }

    @Test
    fun signOutRevokesAndClearsCredentials() =
        runTestBlocking {
            val store = InMemorySecureTokenStore(tokenSet("a", "the-refresh", expiresAt = 100_000))
            val fake = FakeTokenEndpoint()
            val svc = service(fake, store)
            svc.restore()

            svc.signOut()

            assertEquals(1, fake.revokeCount)
            assertEquals("the-refresh", fake.lastRevokedToken)
            assertNull(svc.currentAccessToken)
            assertNull(store.stored)
            assertIs<AuthState.SignedOut>(svc.state.value)
        }

    @Test
    fun onUnauthorizedWithNoSessionReportsFailure() =
        runTestBlocking {
            val svc = service(FakeTokenEndpoint(), InMemorySecureTokenStore())

            val ok = svc.asTokenProvider().onUnauthorized("anything")

            assertFalse(ok)
            assertIs<AuthState.SignedOut>(svc.state.value)
        }
}
