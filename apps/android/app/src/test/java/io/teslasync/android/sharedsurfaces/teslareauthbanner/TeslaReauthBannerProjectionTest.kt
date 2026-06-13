package io.teslasync.android.sharedsurfaces.teslareauthbanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TeslaReauthBanner pure adapter — the native mirror of the only decision the web
 * `TeslaReauthBanner` makes before rendering (web/src/components/feedback/TeslaReauthBanner.tsx): `if (!visible)
 * return null` for the dormant branch versus the visible warning banner. Because the composable is a thin render
 * layer over [TeslaReauthBannerProjection], the per-branch assertions here double as the surface's state "snapshot".
 * Runs in the :android:testReleaseUnitTest gate.
 */
class TeslaReauthBannerProjectionTest {
    // ── render: the visible branch (web `visible === true`) ────────────────────────────────────────────────

    @Test
    fun visibleRendersTheBanner() {
        val r = TeslaReauthBannerProjection.render(visible = true)
        assertTrue("a visible grant-down surface shows the banner", r.showBanner)
        assertFalse("a visible surface is not dormant", r.dormant)
        assertEquals(TeslaReauthRender.Visible, r)
    }

    // ── render: the dormant branch (web `if (!visible) return null`) ───────────────────────────────────────

    @Test
    fun hiddenRendersNothing() {
        val r = TeslaReauthBannerProjection.render(visible = false)
        assertFalse("a hidden surface contributes no banner", r.showBanner)
        assertTrue("a hidden surface is dormant", r.dormant)
        assertEquals(TeslaReauthRender.Hidden, r)
    }

    // ── visibilityAfter: the event → visible rule (web's two event handlers) ───────────────────────────────

    @Test
    fun expiredEventShowsAndRecoveredEventHides() {
        assertTrue("expired shows the banner (web setVisible(true))", TeslaReauthBannerProjection.visibilityAfter(TeslaReauthEvent.Expired))
        assertFalse(
            "recovered hides the banner (web setVisible(false))",
            TeslaReauthBannerProjection.visibilityAfter(TeslaReauthEvent.Recovered),
        )
    }

    @Test
    fun renderConstantsMatchTheirFlags() {
        assertTrue(TeslaReauthRender.Visible.showBanner)
        assertFalse(TeslaReauthRender.Hidden.showBanner)
    }

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("TeslaReauthBanner", TeslaReauthBannerRegistration.SLUG)
        assertEquals("tesla-reauth-banner", TeslaReauthBannerRegistration.ID)
    }
}
