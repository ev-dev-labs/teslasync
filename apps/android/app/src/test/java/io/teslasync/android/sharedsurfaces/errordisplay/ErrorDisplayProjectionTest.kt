// Covers the framework-free [ErrorDisplayProjection] + [toErrorSnapshot] — every branch the web
// ErrorDisplay renders (web/src/components/feedback/ErrorDisplay.tsx): the no-failure → null case, the 404 /
// 401·403 / 5xx / offline / network branch precedence, the per-branch glyph, the per-branch CTA gating
// (Back-to-list needs a list href, Sign-in always shows, retry is gated + disabled while offline), and the
// assertive-vs-polite announcement. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.errordisplay

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ErrorDisplayProjectionTest {
    private fun failure(
        httpStatus: Int? = null,
        transportFailure: Boolean = false,
        online: Boolean = true,
    ) = ErrorSnapshot(present = true, httpStatus = httpStatus, transportFailure = transportFailure, online = online)

    @Test
    fun renderReturnsNullWhenThereIsNoFailure() {
        assertNull(
            "no error must render nothing (web `if (!error) return null`)",
            ErrorDisplayProjection.render(ErrorSnapshot.none(), hasListHref = true, retryable = true),
        )
    }

    @Test
    fun notFoundBranchForA404() {
        assertEquals(ErrorBranch.NotFound, ErrorDisplayProjection.branchFor(failure(httpStatus = 404)))
        assertEquals(ErrorGlyph.FileQuestion, ErrorDisplayProjection.glyphFor(ErrorBranch.NotFound))
    }

    @Test
    fun unauthorizedBranchForA401AndA403() {
        assertEquals(ErrorBranch.Unauthorized, ErrorDisplayProjection.branchFor(failure(httpStatus = 401)))
        assertEquals(ErrorBranch.Unauthorized, ErrorDisplayProjection.branchFor(failure(httpStatus = 403)))
        assertEquals(ErrorGlyph.Lock, ErrorDisplayProjection.glyphFor(ErrorBranch.Unauthorized))
    }

    @Test
    fun serverErrorBranchForFiveHundreds() {
        assertEquals(ErrorBranch.ServerError, ErrorDisplayProjection.branchFor(failure(httpStatus = 500)))
        assertEquals(ErrorBranch.ServerError, ErrorDisplayProjection.branchFor(failure(httpStatus = 503)))
        assertEquals(ErrorGlyph.Server, ErrorDisplayProjection.glyphFor(ErrorBranch.ServerError))
    }

    @Test
    fun offlineBranchForTransportFailureOrLostConnectivityOrZeroStatus() {
        assertEquals(
            "a transport failure is the offline surface",
            ErrorBranch.Offline,
            ErrorDisplayProjection.branchFor(failure(transportFailure = true)),
        )
        assertEquals(
            "lost connectivity is the offline surface (web !online)",
            ErrorBranch.Offline,
            ErrorDisplayProjection.branchFor(failure(httpStatus = 418, online = false)),
        )
        assertEquals(
            "status 0 is the offline surface (web status === 0)",
            ErrorBranch.Offline,
            ErrorDisplayProjection.branchFor(failure(httpStatus = 0)),
        )
        assertEquals(ErrorGlyph.WifiOff, ErrorDisplayProjection.glyphFor(ErrorBranch.Offline))
    }

    @Test
    fun networkBranchForAReachableButFailedRequest() {
        val render = ErrorDisplayProjection.render(failure(httpStatus = null, online = true), hasListHref = false, retryable = true)
        assertEquals(ErrorBranch.Network, render?.branch)
        assertEquals(ErrorGlyph.AlertCircle, ErrorDisplayProjection.glyphFor(ErrorBranch.Network))
    }

    @Test
    fun notFoundOffersBackToListOnlyWhenAListHrefExists() {
        val withHref = ErrorDisplayProjection.render(failure(httpStatus = 404), hasListHref = true, retryable = true)
        assertEquals(ErrorAction(ErrorActionKind.BackToList, enabled = true), withHref?.action)

        val withoutHref = ErrorDisplayProjection.render(failure(httpStatus = 404), hasListHref = false, retryable = true)
        assertNull("no list href ⇒ no Back-to-list CTA (web `listHref ?`)", withoutHref?.action)
    }

    @Test
    fun unauthorizedAlwaysOffersSignIn() {
        val render = ErrorDisplayProjection.render(failure(httpStatus = 401), hasListHref = false, retryable = false)
        assertEquals(ErrorAction(ErrorActionKind.SignIn, enabled = true), render?.action)
    }

    @Test
    fun serverAndNetworkOfferRetryOnlyWhenRetryable() {
        val server = ErrorDisplayProjection.render(failure(httpStatus = 500), hasListHref = false, retryable = true)
        assertEquals(ErrorAction(ErrorActionKind.Retry, enabled = true), server?.action)

        val serverNoRetry = ErrorDisplayProjection.render(failure(httpStatus = 500), hasListHref = false, retryable = false)
        assertNull(serverNoRetry?.action)

        val network = ErrorDisplayProjection.render(failure(httpStatus = null), hasListHref = false, retryable = true)
        assertEquals(ErrorAction(ErrorActionKind.Retry, enabled = true), network?.action)
    }

    @Test
    fun offlineOffersADisabledRetryWhenOnline() {
        val render = ErrorDisplayProjection.render(failure(transportFailure = true), hasListHref = false, retryable = true)
        assertEquals(ErrorAction(ErrorActionKind.RetryWhenOnline, enabled = false), render?.action)
    }

    @Test
    fun onlyOfflineAnnouncesPolitely() {
        val offline = ErrorDisplayProjection.render(failure(transportFailure = true), hasListHref = false, retryable = true)
        assertFalse("offline is a polite status surface (web role=status)", offline?.assertive ?: true)

        val network = ErrorDisplayProjection.render(failure(httpStatus = null), hasListHref = false, retryable = true)
        assertTrue("network is an assertive alert (web role=alert)", network?.assertive ?: false)
    }

    @Test
    fun toErrorSnapshotFoldsHttpStatusAndTransportSignals() {
        val http: UiState<List<String>> =
            UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 404)
        val httpSnap = http.toErrorSnapshot(online = true)
        assertTrue(httpSnap.present)
        assertEquals(404, httpSnap.httpStatus)
        assertFalse("an HTTP failure is not a transport failure", httpSnap.transportFailure)

        val network: UiState<List<String>> = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network)
        val networkSnap = network.toErrorSnapshot(online = false)
        assertTrue(networkSnap.present)
        assertNull(networkSnap.httpStatus)
        assertTrue("a network failure folds to a transport failure", networkSnap.transportFailure)
        assertFalse(networkSnap.online)

        val healthy: UiState<List<String>> = UiState(phase = UiPhase.Content, data = listOf("row"))
        assertFalse("a successful feed has no failure to display", healthy.toErrorSnapshot(online = true).present)
    }
}
