// Off-device verification of the CookieConsentBanner pure adapter — the native mirror of every decision the web
// component makes before rendering (or returning null) (web/src/components/feedback/CookieConsentBanner.tsx),
// folded onto the wired Settings gate (ADR-013): the loading / error / prompt / resolved phases, the
// requireConsent ?? false default, the already-decided resolved copy, and the TTL-stale vs offline freshness
// chips. Because the composable is a thin render layer over [CookieConsentBannerProjection], the per-branch
// assertions here double as the surface's state "snapshot". Runs in the :app:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.cookieconsentbanner

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CookieConsentBannerProjectionTest {
    private val stamp = 1_700_000_000_000L

    private fun content(
        requireConsent: Boolean,
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<Boolean> =
        UiState(
            phase = UiPhase.Content,
            data = requireConsent,
            fetchedAt = stamp,
            stale = stale,
            errorKind = errorKind,
        )

    // ── loading: the gate is loading with nothing cached → the loading surface (web hidden during load) ──────

    @Test
    fun loadingRequirementIsTheLoadingPhase() {
        val r = CookieConsentBannerProjection.render(UiState.loading(), ConsentDecision.Unknown, showDetails = false)
        assertEquals(CookieConsentPhase.Loading, r.phase)
        assertTrue(r.showLoading)
        assertFalse(r.showPrompt)
        assertFalse(r.showStaleChip)
        assertFalse(r.showOfflineChip)
    }

    @Test
    fun loadingSeedHelperIsTheLoadingSurface() {
        val r = CookieConsentBannerProjection.loading()
        assertEquals(CookieConsentPhase.Loading, r.phase)
        assertEquals(ConsentDecision.Unknown, r.consent)
    }

    // ── error: a hard fetch failure with no cache → the error surface + retry (web hides; platform shows) ────

    @Test
    fun errorRequirementWithNoCacheIsTheErrorPhase() {
        val errored =
            UiState<Boolean>(phase = UiPhase.Error, data = null, errorKind = ErrorKind.Network)
        val r = CookieConsentBannerProjection.render(errored, ConsentDecision.Unknown, showDetails = false)
        assertEquals(CookieConsentPhase.Error, r.phase)
        assertTrue(r.showError)
        assertEquals(ErrorKind.Network, r.errorKind)
        assertFalse(r.showPrompt)
    }

    // ── prompt: requireConsent && unknown → the active banner (the web's only rendered state) ───────────────

    @Test
    fun requireConsentAndUnknownIsThePrompt() {
        val r = CookieConsentBannerProjection.render(content(requireConsent = true), ConsentDecision.Unknown, showDetails = false)
        assertEquals(CookieConsentPhase.Prompt, r.phase)
        assertTrue(r.showPrompt)
        assertTrue(r.requireConsent)
        assertFalse("an unexpanded prompt hides the details block", r.showDetailsBlock)
    }

    @Test
    fun expandedPromptShowsTheDetailsBlockButResolvedNeverDoes() {
        val prompt = CookieConsentBannerProjection.render(content(requireConsent = true), ConsentDecision.Unknown, showDetails = true)
        assertTrue("an expanded prompt shows the details block", prompt.showDetailsBlock)

        val resolved = CookieConsentBannerProjection.render(content(requireConsent = false), ConsentDecision.Unknown, showDetails = true)
        assertFalse("the resolved surface never shows the prompt-only details block", resolved.showDetailsBlock)
    }

    // ── resolved: consent off OR already decided → the recorded-state panel (the native web `return null`) ───

    @Test
    fun consentNotRequiredIsResolvedNotRequiredEvenWhenUnknown() {
        val r = CookieConsentBannerProjection.render(content(requireConsent = false), ConsentDecision.Unknown, showDetails = false)
        assertEquals(CookieConsentPhase.Resolved, r.phase)
        assertEquals(ResolvedReason.NotRequired, r.resolvedReason)
        assertFalse(r.requireConsent)
    }

    @Test
    fun requireConsentButAcceptedIsResolvedAccepted() {
        val r = CookieConsentBannerProjection.render(content(requireConsent = true), ConsentDecision.Accepted, showDetails = false)
        assertEquals(CookieConsentPhase.Resolved, r.phase)
        assertEquals(ResolvedReason.Accepted, r.resolvedReason)
    }

    @Test
    fun requireConsentButDeclinedIsResolvedDeclined() {
        val r = CookieConsentBannerProjection.render(content(requireConsent = true), ConsentDecision.Declined, showDetails = false)
        assertEquals(CookieConsentPhase.Resolved, r.phase)
        assertEquals(ResolvedReason.Declined, r.resolvedReason)
    }

    // ── stale vs offline: a TTL-stale gate shows the Stale chip; a cache-after-failure shows offline + retry ─

    @Test
    fun ttlStaleRequirementShowsStaleChipNotOffline() {
        val staleGate = content(requireConsent = true, stale = true)
        val r = CookieConsentBannerProjection.render(staleGate, ConsentDecision.Unknown, showDetails = false)
        assertTrue("a TTL-stale gate shows the stale chip", r.showStaleChip)
        assertFalse("a TTL-stale gate is not offline", r.showOfflineChip)
        assertTrue("the last-known prompt is still rendered", r.showPrompt)
    }

    @Test
    fun offlineRequirementShowsOfflineChipAndRetainsTheLastKnownPrompt() {
        val offline = content(requireConsent = true, stale = true, errorKind = ErrorKind.Network)
        val r = CookieConsentBannerProjection.render(offline, ConsentDecision.Unknown, showDetails = false)
        assertTrue("a cache-after-failure gate shows the offline chip", r.showOfflineChip)
        assertFalse("offline is distinct from the TTL-stale chip", r.showStaleChip)
        assertTrue("the last-known prompt stays visible while offline", r.showPrompt)
        assertTrue(r.requireConsent)
    }

    @Test
    fun freshContentShowsNoFreshnessChips() {
        val r = CookieConsentBannerProjection.render(content(requireConsent = true), ConsentDecision.Unknown, showDetails = false)
        assertFalse(r.showStaleChip)
        assertFalse(r.showOfflineChip)
    }
}
