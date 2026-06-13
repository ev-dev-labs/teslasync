package io.teslasync.android.sharedsurfaces.reloadprompt

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Exercises the pure [ReloadPromptProjection] + [ReloadCountdown] off-device (the `testReleaseUnitTest` gate),
 * pinning the parity decisions the web component makes before returning JSX
 * (web/src/components/feedback/ReloadPrompt.tsx): the `needRefresh` visible/empty branch, the three-second
 * auto-reload countdown, the dismiss-keeps-banner behaviour, the cache-then-network freshness fold, and the
 * classified error bucketing.
 */
class ReloadPromptProjectionTest {
    private fun availabilityState(
        phase: UiPhase,
        version: String? = null,
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
        httpStatus: Int? = null,
    ): UiState<ReloadAvailability> =
        UiState(
            phase = phase,
            data = version?.let { ReloadAvailability(updateAvailable = phase == UiPhase.Content, version = it) },
            stale = stale,
            errorKind = errorKind,
            httpStatus = httpStatus,
        )

    @Test
    fun phaseForMapsEveryDataLayerPhase() {
        assertEquals(ReloadPromptPhase.Loading, ReloadPromptProjection.phaseFor(UiPhase.Loading))
        assertEquals(ReloadPromptPhase.Available, ReloadPromptProjection.phaseFor(UiPhase.Content))
        assertEquals(ReloadPromptPhase.UpToDate, ReloadPromptProjection.phaseFor(UiPhase.Empty))
        assertEquals(ReloadPromptPhase.Error, ReloadPromptProjection.phaseFor(UiPhase.Error))
    }

    @Test
    fun countdownDecrementsThenTriggersReloadAtOne() {
        assertEquals(ReloadCountdown.Tick(2, reload = false), ReloadCountdown.next(3))
        assertEquals(ReloadCountdown.Tick(1, reload = false), ReloadCountdown.next(2))
        assertEquals(ReloadCountdown.Tick(0, reload = true), ReloadCountdown.next(1))
        assertEquals(ReloadCountdown.Tick(0, reload = true), ReloadCountdown.next(0))
    }

    @Test
    fun availableContentArmsTheBannerWithCountdown() {
        val display =
            ReloadPromptProjection.project(
                availabilityState(UiPhase.Content, version = "0.2.0"),
                countdownSeconds = 3,
                autoReloadArmed = true,
                dismissed = false,
            )
        assertEquals(ReloadPromptPhase.Available, display.phase)
        assertEquals("0.2.0", display.version)
        assertTrue(display.autoReloadArmed)
        assertTrue(display.showCountdown)
        assertTrue(display.showLater)
    }

    @Test
    fun dismissDisarmsButKeepsTheBanner() {
        val display =
            ReloadPromptProjection.project(
                availabilityState(UiPhase.Content, version = "0.2.0"),
                countdownSeconds = 3,
                autoReloadArmed = true,
                dismissed = true,
            )
        assertEquals(ReloadPromptPhase.Available, display.phase)
        assertFalse(display.autoReloadArmed)
        assertFalse(display.showCountdown)
        assertFalse(display.showLater)
    }

    @Test
    fun emptyMapsToUpToDateWithNoCountdown() {
        val display =
            ReloadPromptProjection.project(
                availabilityState(UiPhase.Empty),
                countdownSeconds = 3,
                autoReloadArmed = false,
                dismissed = false,
            )
        assertEquals(ReloadPromptPhase.UpToDate, display.phase)
        assertFalse(display.showCountdown)
        assertFalse(display.showFreshnessChip)
    }

    @Test
    fun staleCacheFlagsStaleNotOffline() {
        val display =
            ReloadPromptProjection.project(
                availabilityState(UiPhase.Content, version = "0.2.0", stale = true).copy(refreshing = true),
                countdownSeconds = 3,
                autoReloadArmed = false,
                dismissed = false,
            )
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun cachedAfterErrorFlagsOffline() {
        val display =
            ReloadPromptProjection.project(
                availabilityState(UiPhase.Empty, stale = true, errorKind = ErrorKind.Network)
                    .copy(fetchedAt = STAMP, data = ReloadAvailability(updateAvailable = false, version = "0.1.0")),
                countdownSeconds = 3,
                autoReloadArmed = false,
                dismissed = false,
            )
        assertTrue(display.offline)
        assertFalse(display.stale)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun errorMapsToErrorPhaseWithRetry() {
        val display =
            ReloadPromptProjection.project(
                availabilityState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
                countdownSeconds = 3,
                autoReloadArmed = false,
                dismissed = false,
            )
        assertEquals(ReloadPromptPhase.Error, display.phase)
        assertTrue(display.canRetry)
    }

    @Test
    fun queryErrorKindBucketsEveryFailure() {
        assertEquals(QueryErrorKind.Waiting, queryKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, queryKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Network, queryKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.Unauthorized, queryKind(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.NotFound, queryKind(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.ServerError, queryKind(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.ServerError, queryKind(ErrorKind.Unknown, null))
    }

    @Test
    fun contentDescriptionReflectsEveryState() {
        val strings = strings()
        val available =
            ReloadPromptDisplay(phase = ReloadPromptPhase.Available, autoReloadArmed = true)
        assertEquals(
            "New version available. Reloading in 3s",
            ReloadPromptProjection.contentDescription(available, strings, "Reloading in 3s"),
        )
        val dismissed =
            ReloadPromptDisplay(phase = ReloadPromptPhase.Available, autoReloadArmed = false, dismissed = true)
        assertEquals("New version available", ReloadPromptProjection.contentDescription(dismissed, strings, "ignored"))
        assertEquals(
            strings.loadingLabel,
            ReloadPromptProjection.contentDescription(ReloadPromptDisplay(ReloadPromptPhase.Loading), strings, ""),
        )
        assertEquals(
            strings.upToDate,
            ReloadPromptProjection.contentDescription(ReloadPromptDisplay(ReloadPromptPhase.UpToDate), strings, ""),
        )
    }

    private fun queryKind(
        errorKind: ErrorKind,
        httpStatus: Int?,
    ): QueryErrorKind =
        ReloadPromptProjection.queryErrorKind(
            ReloadPromptDisplay(phase = ReloadPromptPhase.Error, errorKind = errorKind, httpStatus = httpStatus),
        )

    private fun strings(): ReloadPromptStrings =
        ReloadPromptStrings(
            title = "New version available",
            later = "Later",
            reloadNow = "Reload Now",
            upToDate = "Up to date",
            loadingLabel = "Loading",
            staleLabel = "Stale",
            offlineLabel = "Offline",
        )

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_NOT_FOUND = 404
        const val HTTP_SERVER_ERROR = 503
    }
}
