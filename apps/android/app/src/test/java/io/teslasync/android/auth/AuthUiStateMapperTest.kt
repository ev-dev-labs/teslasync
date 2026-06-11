package io.teslasync.android.auth

import io.teslasync.shared.core.auth.AuthState
import io.teslasync.shared.core.auth.TokenSet
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * JVM unit tests for the pure [authUiStateOf] mapper — the single source of truth for which auth
 * surface each shared-core state renders, including the two app-side refinements: a server-side
 * invalidation (`SignedOut` after a session) becomes reauth-required, and an expired access token
 * becomes the expired surface. A user-canceled sign-in is not an error.
 */
class AuthUiStateMapperTest {
    private fun tokens(expiresAt: Long): TokenSet = TokenSet("a", "r", null, expiresAt)

    @Test
    fun authenticatingMapsToAuthorizing() {
        assertEquals(
            AuthUiState.Authorizing,
            authUiStateOf(AuthState.Authenticating, hadSession = false, userInitiatedSignOut = false, nowEpochSeconds = 0),
        )
    }

    @Test
    fun signedInWithLiveTokenMapsToAuthenticated() {
        assertEquals(
            AuthUiState.Authenticated,
            authUiStateOf(AuthState.SignedIn(tokens(100)), hadSession = false, userInitiatedSignOut = false, nowEpochSeconds = 50),
        )
    }

    @Test
    fun signedInWithExpiredTokenMapsToExpired() {
        assertEquals(
            AuthUiState.Expired,
            authUiStateOf(AuthState.SignedIn(tokens(100)), hadSession = true, userInitiatedSignOut = false, nowEpochSeconds = 100),
        )
    }

    @Test
    fun refreshingMapsToRefreshing() {
        assertEquals(
            AuthUiState.Refreshing,
            authUiStateOf(AuthState.Refreshing(tokens(100)), hadSession = true, userInitiatedSignOut = false, nowEpochSeconds = 0),
        )
    }

    @Test
    fun signedOutAfterUserSignOutMapsToSignedOut() {
        assertEquals(
            AuthUiState.SignedOut,
            authUiStateOf(AuthState.SignedOut, hadSession = true, userInitiatedSignOut = true, nowEpochSeconds = 0),
        )
    }

    @Test
    fun signedOutAfterServerInvalidationMapsToReauthRequired() {
        assertEquals(
            AuthUiState.ReauthRequired,
            authUiStateOf(AuthState.SignedOut, hadSession = true, userInitiatedSignOut = false, nowEpochSeconds = 0),
        )
    }

    @Test
    fun coldStartSignedOutMapsToSignedOut() {
        assertEquals(
            AuthUiState.SignedOut,
            authUiStateOf(AuthState.SignedOut, hadSession = false, userInitiatedSignOut = false, nowEpochSeconds = 0),
        )
    }

    @Test
    fun errorMapsToErrorSurface() {
        assertEquals(
            AuthUiState.Error("boom"),
            authUiStateOf(AuthState.Error("boom"), hadSession = false, userInitiatedSignOut = false, nowEpochSeconds = 0),
        )
    }

    @Test
    fun userCanceledSignInMapsToSignedOutNotError() {
        assertEquals(
            AuthUiState.SignedOut,
            authUiStateOf(
                AuthState.Error("canceled", AuthCanceledException()),
                hadSession = false,
                userInitiatedSignOut = false,
                nowEpochSeconds = 0,
            ),
        )
    }
}
