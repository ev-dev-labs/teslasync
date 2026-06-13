// Off-device unit coverage for the DraftRestorePrompt surface's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the prompt-mandated registration slug, the cached → projection
// adapter ([DraftRestoreProjection.project]) across every state (loading / content / empty / error / stale /
// offline), the newest-first ordering the web list renders, the relative "Saved {{when}}" age bucketing
// (web `formatRelativeTime`), and the classified [QueryErrorKind] recovery mapping. No Compose / Android /
// HTTP — runs in :android:testReleaseUnitTest. Reference values are the data + behaviour the web
// `DraftRestorePrompt` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.draftrestoreprompt

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DraftRestorePromptModelTest {
    private companion object {
        const val NOW = 1_700_000_000_000L
        const val MINUTE = 60_000L
        const val HOUR = 60L * MINUTE
        const val DAY = 24L * HOUR

        val NEWER = DraftRecord(storageKey = "k-new", route = "/a/new", label = "Newer", savedAtEpochMs = NOW - MINUTE)
        val OLDER = DraftRecord(storageKey = "k-old", route = "/b/new", label = "Older", savedAtEpochMs = NOW - DAY)

        const val HTTP_SERVER_ERROR = 500
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_NOT_FOUND = 404
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("DraftRestorePrompt", DraftRestorePromptRegistration.SLUG)
        assertEquals("view.opened", DraftRestorePromptRegistration.EVENT_VIEW_OPENED)
        assertEquals("surface", DraftRestorePromptRegistration.SURFACE_KEY)
    }

    // ── cached → projection adapter across every state ────────────────────────────────

    @Test
    fun loadingStateProjectsLoadingAndShowsTheCard() {
        val display = DraftRestoreProjection.project(UiState.loading())
        assertEquals(DraftRestorePhase.Loading, display.phase)
        assertEquals(0, display.count)
        assertTrue("loading card is shown so the region is never blank", display.showCard)
        assertFalse(display.canRetry)
    }

    @Test
    fun contentStateSortsDraftsNewestFirst() {
        val state = UiState(phase = UiPhase.Content, data = listOf(OLDER, NEWER), fetchedAt = NOW)
        val display = DraftRestoreProjection.project(state)
        assertEquals(DraftRestorePhase.Content, display.phase)
        assertEquals(2, display.count)
        assertEquals(listOf(NEWER, OLDER), display.drafts)
        assertTrue(display.showCard)
        assertFalse(display.showFreshnessChip)
    }

    @Test
    fun emptyStateProjectsEmptyAndHidesTheCard() {
        val state = UiState(phase = UiPhase.Empty, data = emptyList<DraftRecord>(), fetchedAt = NOW)
        val display = DraftRestoreProjection.project(state)
        assertEquals(DraftRestorePhase.Empty, display.phase)
        assertEquals(0, display.count)
        // The web returns null when there are no drafts; the friendly empty state lives in the review modal.
        assertFalse(display.showCard)
    }

    @Test
    fun hardErrorStateProjectsErrorWithRetry() {
        val state =
            UiState<List<DraftRecord>>(
                phase = UiPhase.Error,
                errorKind = ErrorKind.Http,
                httpStatus = HTTP_SERVER_ERROR,
            )
        val display = DraftRestoreProjection.project(state)
        assertEquals(DraftRestorePhase.Error, display.phase)
        assertTrue(display.canRetry)
        assertFalse(display.showCard)
    }

    @Test
    fun staleStateFlagsTheFreshnessChipWithoutAnError() {
        val state =
            UiState(
                phase = UiPhase.Content,
                data = listOf(NEWER),
                stale = true,
                refreshing = true,
                fetchedAt = NOW - HOUR,
            )
        val display = DraftRestoreProjection.project(state)
        assertEquals(DraftRestorePhase.Content, display.phase)
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.refreshing)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun offlineStateKeepsCachedDraftsAndFlagsOffline() {
        val state =
            UiState(
                phase = UiPhase.Content,
                data = listOf(NEWER),
                stale = true,
                errorKind = ErrorKind.Network,
                fetchedAt = NOW - HOUR,
            )
        val display = DraftRestoreProjection.project(state)
        assertEquals(DraftRestorePhase.Content, display.phase)
        assertTrue("a failed refresh over cached drafts is offline, not plain stale", display.offline)
        assertFalse(display.stale)
        assertTrue(display.showFreshnessChip)
        assertEquals(1, display.count)
    }

    // ── relative age bucketing (web `formatRelativeTime`) ─────────────────────────────

    @Test
    fun savedAgeBucketsByElapsedTime() {
        assertEquals(DraftSavedAge.JustNow, DraftRestoreProjection.savedAge(NOW - 30_000L, NOW))
        assertEquals(DraftSavedAge.Minutes(5), DraftRestoreProjection.savedAge(NOW - 5L * MINUTE, NOW))
        assertEquals(DraftSavedAge.Minutes(1), DraftRestoreProjection.savedAge(NOW - 90_000L, NOW))
        assertEquals(DraftSavedAge.Hours(3), DraftRestoreProjection.savedAge(NOW - 3L * HOUR, NOW))
        assertEquals(DraftSavedAge.Days(2), DraftRestoreProjection.savedAge(NOW - 2L * DAY, NOW))
    }

    @Test
    fun savedAgeClampsAFutureStampToJustNow() {
        assertEquals(DraftSavedAge.JustNow, DraftRestoreProjection.savedAge(NOW + 10_000L, NOW))
    }

    @Test
    fun savedAgeNeverReportsZeroDays() {
        // A draft just over a day old is "1 day ago", never "0 days ago".
        assertEquals(DraftSavedAge.Days(1), DraftRestoreProjection.savedAge(NOW - (DAY + HOUR), NOW))
    }

    // ── classified query-error recovery mapping ───────────────────────────────────────

    @Test
    fun queryErrorKindMapsHttpStatuses() {
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, HTTP_SERVER_ERROR))
    }

    @Test
    fun queryErrorKindMapsTransportFailures() {
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Decode, null))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown, null))
    }

    private fun kindFor(
        errorKind: ErrorKind,
        httpStatus: Int?,
    ): QueryErrorKind =
        DraftRestoreProjection.queryErrorKind(
            DraftRestoreDisplay(phase = DraftRestorePhase.Error, errorKind = errorKind, httpStatus = httpStatus),
        )
}
