package io.teslasync.android.sharedsurfaces.ailimitbanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AiLimitBanner's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/ai/AiLimitBanner.tsx): the `bannerLevel` → variant selection, the
 * `reason` → title/description taxonomy (including the shared token / feature-id buckets and the generic
 * fallback), the once-per-second countdown reducer, and the conditional "Use baseline" / "Retry" / countdown
 * affordances. Because the composable is a thin render layer over [classify] + the reducers, the per-branch
 * assertions here double as the surface's per-state snapshot. Runs in the :app:testReleaseUnitTest gate.
 */
class AiLimitBannerModelTest {
    // ── bannerLevel → severity (web `variant` selection) ────────────────────────────────────────────

    @Test
    fun bannerLevelFromWireParsesKnownLevelsAndFallsBackToNone() {
        assertEquals(BannerLevel.Warn, bannerLevelFromWire("warn"))
        assertEquals(BannerLevel.Critical, bannerLevelFromWire("critical"))
        assertEquals(BannerLevel.None, bannerLevelFromWire(""))
        assertEquals(BannerLevel.None, bannerLevelFromWire(null))
        assertEquals(BannerLevel.None, bannerLevelFromWire("something-new"))
    }

    @Test
    fun severityForMirrorsTheWebVariantSelection() {
        // Web: critical -> danger, warn -> warning, '' -> info.
        assertEquals(BannerSeverity.Danger, severityFor(BannerLevel.Critical))
        assertEquals(BannerSeverity.Warning, severityFor(BannerLevel.Warn))
        assertEquals(BannerSeverity.Info, severityFor(BannerLevel.None))
    }

    // ── reason → copy bucket (web `titleForReason` / `descriptionForReason`) ─────────────────────────

    @Test
    fun reasonCopyMapsEveryKnownReason() {
        assertEquals(LimitReasonCopy.CostCap, reasonCopy("cost_cap"))
        assertEquals(LimitReasonCopy.CostCapUnavailable, reasonCopy("cost_cap_unavailable"))
        assertEquals(LimitReasonCopy.SettingsUnavailable, reasonCopy("settings_unavailable"))
        assertEquals(LimitReasonCopy.Burst, reasonCopy("burst"))
        assertEquals(LimitReasonCopy.PerMinute, reasonCopy("per_minute"))
        assertEquals(LimitReasonCopy.PerDay, reasonCopy("per_day"))
        assertEquals(LimitReasonCopy.ProviderUnavailable, reasonCopy("provider_unavailable"))
    }

    @Test
    fun reasonCopyFoldsTheSharedTokenAndFeatureIdBuckets() {
        // Web: input_tokens & output_tokens share one bucket; missing/unknown_feature_id share another.
        assertEquals(LimitReasonCopy.Tokens, reasonCopy("input_tokens"))
        assertEquals(LimitReasonCopy.Tokens, reasonCopy("output_tokens"))
        assertEquals(LimitReasonCopy.FeatureMisconfigured, reasonCopy("missing_feature_id"))
        assertEquals(LimitReasonCopy.FeatureMisconfigured, reasonCopy("unknown_feature_id"))
    }

    @Test
    fun reasonCopyFallsBackToGenericForUnknownReasons() {
        // Web `default:` branch — a forward-compatible client renders the generic copy.
        assertEquals(LimitReasonCopy.Generic, reasonCopy(""))
        assertEquals(LimitReasonCopy.Generic, reasonCopy("brand_new_reason"))
        assertEquals(LimitReasonCopy.Generic, reasonCopy("COST_CAP")) // case-sensitive, like the web switch
    }

    // ── countdown reducer (web `setSecondsLeft` + `retryReady`) ──────────────────────────────────────

    @Test
    fun clampRetrySecondsTreatsNegativeAsReady() {
        assertEquals(0, clampRetrySeconds(-1))
        assertEquals(0, clampRetrySeconds(0))
        assertEquals(42, clampRetrySeconds(42))
    }

    @Test
    fun decrementSecondsCountsDownAndSaturatesAtZero() {
        // Web `(s) => (s > 0 ? s - 1 : 0)` run once per second.
        var s = 3
        val observed = mutableListOf<Int>()
        repeat(5) {
            s = decrementSeconds(s)
            observed += s
        }
        assertEquals(listOf(2, 1, 0, 0, 0), observed)
    }

    @Test
    fun isRetryReadyMatchesTheWebGate() {
        assertTrue(isRetryReady(0))
        assertTrue(isRetryReady(-3))
        assertFalse(isRetryReady(1))
    }

    // ── resolveActions (web conditional renders) ────────────────────────────────────────────────────

    @Test
    fun resolveActionsShowsCountdownOnlyWhileTimerRuns() {
        assertTrue(resolveActions(5, baselineAvailable = true, hasRetry = true, hasBaseline = true).showCountdown)
        assertFalse(resolveActions(0, baselineAvailable = true, hasRetry = true, hasBaseline = true).showCountdown)
    }

    @Test
    fun resolveActionsGatesRetryOnReadinessAndHandler() {
        // Retry: web `onRetry && retryReady`.
        assertFalse("counting down hides retry", resolveActions(5, true, hasRetry = true, hasBaseline = false).showRetry)
        assertTrue("ready + handler shows retry", resolveActions(0, true, hasRetry = true, hasBaseline = false).showRetry)
        assertFalse("no handler hides retry", resolveActions(0, true, hasRetry = false, hasBaseline = false).showRetry)
    }

    @Test
    fun resolveActionsGatesBaselineOnAvailabilityAndHandler() {
        // Use baseline: web `onUseBaseline && info.baselineAvailable`.
        assertTrue(resolveActions(0, baselineAvailable = true, hasRetry = false, hasBaseline = true).showBaseline)
        assertFalse(resolveActions(0, baselineAvailable = false, hasRetry = false, hasBaseline = true).showBaseline)
        assertFalse(resolveActions(0, baselineAvailable = true, hasRetry = false, hasBaseline = false).showBaseline)
    }

    // ── classify: the per-state snapshot ─────────────────────────────────────────────────────────────

    @Test
    fun classifyHidesWhenInfoIsNull() {
        // Web `if (!info) return null`.
        assertEquals(BannerSurface.Hidden, classify(null, secondsLeft = 0, hasRetry = true, hasBaseline = true))
    }

    @Test
    fun classifyActiveCarriesSeverityReasonAndClampedCountdown() {
        val info = AiLimitInfo("per_day", retryAfterS = 60, bannerLevel = BannerLevel.Critical, baselineAvailable = true)
        val surface = classify(info, secondsLeft = 12, hasRetry = true, hasBaseline = true)
        assertTrue(surface is BannerSurface.Active)
        surface as BannerSurface.Active
        assertEquals(BannerSeverity.Danger, surface.severity)
        assertEquals(LimitReasonCopy.PerDay, surface.reason)
        assertEquals(12, surface.secondsLeft)
        assertTrue(surface.actions.showCountdown)
        assertFalse("retry hidden while counting down", surface.actions.showRetry)
        assertTrue(surface.actions.showBaseline)
    }

    @Test
    fun classifyClampsNegativeCountdownToReady() {
        val info = AiLimitInfo("burst", retryAfterS = 0, bannerLevel = BannerLevel.Warn, baselineAvailable = false)
        val surface = classify(info, secondsLeft = -5, hasRetry = true, hasBaseline = true) as BannerSurface.Active
        assertEquals(0, surface.secondsLeft)
        assertFalse(surface.actions.showCountdown)
        assertTrue("retry ready once the countdown is done", surface.actions.showRetry)
        assertFalse("baseline hidden when unavailable", surface.actions.showBaseline)
    }

    @Test
    fun classifyTransitionsFromCountingDownToRetryReady() {
        val info = AiLimitInfo("provider_unavailable", retryAfterS = 1, bannerLevel = BannerLevel.None, baselineAvailable = true)
        val counting = classify(info, secondsLeft = 1, hasRetry = true, hasBaseline = false) as BannerSurface.Active
        val ready = classify(info, secondsLeft = 0, hasRetry = true, hasBaseline = false) as BannerSurface.Active
        assertEquals(BannerSeverity.Info, counting.severity)
        assertTrue(counting.actions.showCountdown)
        assertFalse(counting.actions.showRetry)
        assertFalse(ready.actions.showCountdown)
        assertTrue(ready.actions.showRetry)
    }

    // ── accessibility label (TalkBack announcement) ──────────────────────────────────────────────────

    @Test
    fun accessibilityLabelMergesTitleAndDescription() {
        val label = bannerAccessibilityLabel("Daily cost cap reached", "You have reached your daily limit.", null)
        assertEquals("Daily cost cap reached. You have reached your daily limit.", label)
    }

    @Test
    fun accessibilityLabelAppendsCountdownWhenPresent() {
        val label = bannerAccessibilityLabel("Helix rate limit hit", "The window resets shortly.", "Try again in 9s")
        assertTrue(label.startsWith("Helix rate limit hit. The window resets shortly."))
        assertTrue("the live countdown is announced", label.endsWith("Try again in 9s"))
    }

    @Test
    fun accessibilityLabelIgnoresBlankCountdown() {
        val label = bannerAccessibilityLabel("Title", "Body", "   ")
        assertEquals("Title. Body", label)
    }
}
