package io.teslasync.android.sharedsurfaces.impersonationbanner

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ImpersonationBanner's pure logic — the native analogue of the web component's
 * render derivation (web/src/components/feedback/ImpersonationBanner.tsx): the mode mapping, the `formatRemaining`
 * port, the RFC3339 expiry parse + the `remaining > 1000 ? endsIn : expired` countdown rule, the lifecycle
 * surface selection that folds the bound cache-then-network feed, and the merged a11y announcement. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ImpersonationBannerProjectionTest {
    // ── Mode classification (web useImpersonationStatus union) ───────────────────────────────────────────

    @Test
    fun modeFromRawMapsKnownValuesAndFoldsUnknownToInactive() {
        assertEquals(ImpersonationMode.Active, ImpersonationMode.fromRaw("active"))
        assertEquals(ImpersonationMode.Open, ImpersonationMode.fromRaw("open"))
        assertEquals(ImpersonationMode.Inactive, ImpersonationMode.fromRaw("inactive"))
        assertEquals(ImpersonationMode.Inactive, ImpersonationMode.fromRaw(null))
        assertEquals(ImpersonationMode.Inactive, ImpersonationMode.fromRaw("nonsense"))
    }

    @Test
    fun fromStatusProjectsEachDiscriminatedStatus() {
        val active =
            ImpersonationBannerView.fromStatus(
                ImpersonationStatus.Active(originalAdmin = "admin", target = "alice", expiresAt = EXPIRES),
            )
        assertEquals(ImpersonationMode.Active, active.mode)
        assertEquals("alice", active.target)
        assertEquals("admin", active.originalAdmin)
        assertEquals(EXPIRES, active.expiresAt)

        assertEquals(ImpersonationMode.Open, ImpersonationBannerView.fromStatus(ImpersonationStatus.Open).mode)
        assertEquals(ImpersonationMode.Inactive, ImpersonationBannerView.fromStatus(ImpersonationStatus.Inactive).mode)
    }

    // ── formatRemaining (verbatim web port) ──────────────────────────────────────────────────────────────

    @Test
    fun formatRemainingMatchesTheWebBucketsAndZeroPadding() {
        // hours → "HHh MMm" with a zero-padded minute
        assertEquals("2h 05m", ImpersonationBannerProjection.formatRemaining(ms(hours = 2, minutes = 5, seconds = 9)))
        // minutes → "MMm SSs" with a zero-padded second
        assertEquals("5m 03s", ImpersonationBannerProjection.formatRemaining(ms(minutes = 5, seconds = 3)))
        // seconds only → "SSs"
        assertEquals("45s", ImpersonationBannerProjection.formatRemaining(ms(seconds = 45)))
        // floor + clamp at zero for a negative remaining
        assertEquals("0s", ImpersonationBannerProjection.formatRemaining(-1_500L))
    }

    // ── parseExpiryMillis (web Date.parse + Number.isFinite) ──────────────────────────────────────────────

    @Test
    fun parseExpiryMillisParsesRfc3339AndRejectsBlankOrGarbage() {
        assertEquals(1_767_225_925_000L, ImpersonationBannerProjection.parseExpiryMillis("2026-01-01T00:05:25Z"))
        assertNull(ImpersonationBannerProjection.parseExpiryMillis(""))
        assertNull(ImpersonationBannerProjection.parseExpiryMillis("   "))
        assertNull(ImpersonationBannerProjection.parseExpiryMillis("not-a-timestamp"))
    }

    @Test
    fun parseExpiryMillisHonoursAnExplicitOffset() {
        // 00:05:25+02:00 == the prior day's 22:05:25Z; both forms must resolve to the same instant.
        assertEquals(
            ImpersonationBannerProjection.parseExpiryMillis("2026-01-01T00:05:25+02:00"),
            ImpersonationBannerProjection.parseExpiryMillis("2025-12-31T22:05:25Z"),
        )
    }

    // ── countdownFor (web remaining > 1000 ? endsIn : expired) ─────────────────────────────────────────────

    @Test
    fun countdownIsNoneWhenThereIsNoExpiry() {
        assertEquals(BannerCountdown.None, ImpersonationBannerProjection.countdownFor(null, NOW))
    }

    @Test
    fun countdownIsRemainingWhenMoreThanOneSecondIsLeft() {
        val countdown = ImpersonationBannerProjection.countdownFor(NOW + 90_000L, NOW)
        assertEquals(BannerCountdown.Remaining("1m 30s"), countdown)
    }

    @Test
    fun countdownIsExpiredAtOrBelowTheOneSecondThreshold() {
        assertEquals(BannerCountdown.Expired, ImpersonationBannerProjection.countdownFor(NOW + 1_000L, NOW))
        assertEquals(BannerCountdown.Expired, ImpersonationBannerProjection.countdownFor(NOW - 5_000L, NOW))
    }

    // ── Surface selection across every lifecycle state ─────────────────────────────────────────────────────

    @Test
    fun firstLoadIsLoadingSurface() {
        assertEquals(ImpersonationBannerSurface.Loading, project(UiState.loading()).surface)
    }

    @Test
    fun hardFailureWithNoCacheIsErrorSurface() {
        val state = UiState<ImpersonationBannerView>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(ImpersonationBannerSurface.Error, project(state).surface)
    }

    @Test
    fun activeSessionIsActiveSurfaceWithTargetAndCountdown() {
        val model = project(activeState(), nowMillis = NOW)
        assertEquals(ImpersonationBannerSurface.Active, model.surface)
        assertEquals("alice", model.target)
        assertEquals(BannerCountdown.Remaining("5m 25s"), model.countdown)
        assertTrue(model.isActiveBanner)
        assertFalse(model.showFreshnessChip)
    }

    @Test
    fun inactiveAndOpenModesAreHidden() {
        assertEquals(ImpersonationBannerSurface.Hidden, project(contentState(ImpersonationMode.Inactive)).surface)
        assertEquals(ImpersonationBannerSurface.Hidden, project(contentState(ImpersonationMode.Open)).surface)
    }

    @Test
    fun nullDataResolvesToHidden() {
        assertEquals(ImpersonationBannerSurface.Hidden, project(UiState(UiPhase.Empty)).surface)
    }

    @Test
    fun staleButOnlineActiveSessionIsStaleSurface() {
        val model = project(activeState(stale = true), nowMillis = NOW)
        assertEquals(ImpersonationBannerSurface.Stale, model.surface)
        assertTrue(model.showFreshnessChip)
        assertEquals(BannerCountdown.Remaining("5m 25s"), model.countdown)
    }

    @Test
    fun cachedActiveSessionAfterAFailedRefreshIsOfflineSurface() {
        val model = project(activeState(stale = true, errorKind = ErrorKind.Network), nowMillis = NOW)
        assertEquals(ImpersonationBannerSurface.Offline, model.surface)
        assertTrue(model.showFreshnessChip)
    }

    @Test
    fun countdownIsSuppressedForNonActiveSurfaces() {
        assertEquals(BannerCountdown.None, project(UiState.loading()).countdown)
        assertEquals(BannerCountdown.None, project(contentState(ImpersonationMode.Inactive)).countdown)
    }

    @Test
    fun endingFlagIsCarriedThroughToTheModel() {
        assertTrue(project(activeState(), ending = true).ending)
        assertFalse(project(activeState(), ending = false).ending)
    }

    // ── Accessibility announcement ─────────────────────────────────────────────────────────────────────────

    @Test
    fun accessibilityLabelMergesTitleBodyAndCountdown() {
        assertEquals(
            "Impersonating alice. You are viewing as another subject. Expires in 5m 25s",
            ImpersonationBannerProjection.accessibilityLabel(
                "Impersonating alice",
                "You are viewing as another subject.",
                "Expires in 5m 25s",
            ),
        )
    }

    @Test
    fun accessibilityLabelOmitsAnAbsentCountdown() {
        assertEquals(
            "Impersonating alice. You are viewing as another subject.",
            ImpersonationBannerProjection.accessibilityLabel(
                "Impersonating alice",
                "You are viewing as another subject.",
                null,
            ),
        )
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────

    private fun project(
        state: UiState<ImpersonationBannerView>,
        nowMillis: Long = NOW,
        ending: Boolean = false,
    ): ImpersonationBannerModel = ImpersonationBannerProjection.project(state, nowMillis, ending)

    private fun contentState(mode: ImpersonationMode): UiState<ImpersonationBannerView> =
        UiState(phase = UiPhase.Content, data = ImpersonationBannerView(mode))

    private fun activeState(
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<ImpersonationBannerView> =
        UiState(
            phase = UiPhase.Content,
            data = ImpersonationBannerView(ImpersonationMode.Active, target = "alice", expiresAt = EXPIRES),
            stale = stale,
            errorKind = errorKind,
            fetchedAt = NOW,
        )

    private fun ms(
        hours: Long = 0,
        minutes: Long = 0,
        seconds: Long = 0,
    ): Long = ((hours * 3_600L) + (minutes * 60L) + seconds) * 1_000L

    private companion object {
        const val EXPIRES = "2026-01-01T00:05:25Z"

        // 325s before EXPIRES, so the active countdown is exactly 5m 25s.
        const val NOW = 1_767_225_600_000L
    }
}
