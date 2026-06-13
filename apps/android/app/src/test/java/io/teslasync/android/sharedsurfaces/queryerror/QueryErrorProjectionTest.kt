// Framework-free unit tests for the QueryError model + projection — the native parity contract for
// web/src/components/feedback/QueryError.tsx. Covers every branch the web component derives (waiting / 404 /
// 401-403 / 5xx / network online / network offline), the no-error null case, the offline-only auto-retry
// predicate, and the failure-from-UiState bridge. No Compose, no Android: runs in :app:testReleaseUnitTest.

package io.teslasync.android.sharedsurfaces.queryerror

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class QueryErrorProjectionTest {
    private fun failure(
        status: Int?,
        transientWaiting: Boolean = false,
    ) = QueryErrorFailure(httpStatus = status, transientWaiting = transientWaiting)

    @Test
    fun aNullFailureProjectsToNothing() {
        // Web `if (!error) return null` — the only non-rendered state, an honest no-error, not a hidden error.
        assertNull(projectQueryError(null, online = true))
        assertNull(projectQueryError(null, online = false))
    }

    @Test
    fun transientWaitingTakesPrecedenceOverEveryStatus() {
        val render = projectQueryError(failure(status = 500, transientWaiting = true), online = true)!!
        assertEquals(QueryErrorKind.Waiting, render.branch)
        assertTrue("waiting announces politely (web role=status)", render.polite)
    }

    @Test
    fun aNotFoundFailureMapsToTheNotFoundBranch() {
        val render = projectQueryError(failure(status = 404), online = true)!!
        assertEquals(QueryErrorKind.NotFound, render.branch)
        assertFalse(render.polite)
        assertTrue(render.retryEnabled)
    }

    @Test
    fun unauthorizedAndForbiddenMapToTheSignInBranch() {
        assertEquals(QueryErrorKind.Unauthorized, projectQueryError(failure(401), online = true)!!.branch)
        assertEquals(QueryErrorKind.Unauthorized, projectQueryError(failure(403), online = true)!!.branch)
    }

    @Test
    fun serverErrorsMapToTheServerErrorBranch() {
        assertEquals(QueryErrorKind.ServerError, projectQueryError(failure(500), online = true)!!.branch)
        assertEquals(QueryErrorKind.ServerError, projectQueryError(failure(503), online = true)!!.branch)
    }

    @Test
    fun aStatuslessFailureWhileOnlineIsTheCantReachServerBranch() {
        val render = projectQueryError(failure(status = null), online = true)!!
        assertEquals(QueryErrorKind.Network, render.branch)
        assertTrue("an online network failure keeps Retry enabled", render.retryEnabled)
        assertFalse("the online network failure is an assertive alert", render.polite)
    }

    @Test
    fun aStatuslessFailureWhileOfflineIsTheOfflineBranch() {
        val render = projectQueryError(failure(status = null), online = false)!!
        assertEquals(QueryErrorKind.Offline, render.branch)
        assertFalse("offline disables Retry until reconnect (web disabled={isOffline})", render.retryEnabled)
        assertTrue("offline announces politely (web role=status)", render.polite)
    }

    @Test
    fun theExplicitOfflineStatusIsAlwaysTheOfflineBranch() {
        // Web treats `status === 0` as offline regardless of navigator.onLine.
        val render = projectQueryError(failure(status = QueryErrorFailure.OFFLINE_STATUS), online = true)!!
        assertEquals(QueryErrorKind.Offline, render.branch)
        assertFalse(render.retryEnabled)
    }

    @Test
    fun autoRetryArmsOnlyForAStatuslessNonTransientFailure() {
        // Web effect guard: error present, status === undefined, not a transient wait.
        assertTrue(armsAutoRetryOnReconnect(failure(status = null)))
        assertFalse("a null failure never auto-retries", armsAutoRetryOnReconnect(null))
        assertFalse("a 5xx never recovers from a mere online event", armsAutoRetryOnReconnect(failure(500)))
        assertFalse("the explicit offline status carries a status, so no auto-retry", armsAutoRetryOnReconnect(failure(0)))
        assertFalse("a transient wait owns its own retry", armsAutoRetryOnReconnect(failure(null, transientWaiting = true)))
    }

    @Test
    fun failureFromUiStateCarriesTheHttpStatus() {
        val state = UiState<Unit>(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 404)
        val failure = QueryErrorFailure.fromUiState(state)
        assertEquals(404, failure.httpStatus)
        assertFalse(failure.transientWaiting)
    }

    @Test
    fun failureFromUiStateClassifiesCircuitOpenAndRateLimitAsTransientWaiting() {
        val breakerOpen = QueryErrorFailure.fromUiState(UiState<Unit>(phase = UiPhase.Error, errorKind = ErrorKind.CircuitOpen))
        assertTrue("an open breaker is a transient wait", breakerOpen.transientWaiting)

        val rateLimited = QueryErrorFailure.fromUiState(UiState<Unit>(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 429))
        assertTrue("a 429 is a transient wait", rateLimited.transientWaiting)
    }

    @Test
    fun theRegistrationSlugIsTheSurfaceContract() {
        assertEquals("QueryError", QueryErrorRegistration.SLUG)
        assertEquals("query-error", QueryErrorRegistration.ID)
    }
}
