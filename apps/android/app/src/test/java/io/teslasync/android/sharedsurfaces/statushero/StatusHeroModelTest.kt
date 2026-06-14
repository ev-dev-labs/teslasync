package io.teslasync.android.sharedsurfaces.statushero

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Off-device verification of the StatusHero's pure logic — the native mirror of the web component's
 * `STATUS_CONFIG[status]` lookup (web/src/components/status/StatusHero.tsx): every one of the five status
 * tiers maps to the right render tone + glyph, and the CTA prop carries the expected defaults. Because the
 * composable is a thin render layer over [projectStatus], the per-status assertions here double as the
 * surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class StatusHeroModelTest {
    // ── projectStatus: the web STATUS_CONFIG icon + colour-family table ────────────────────────────────────

    @Test
    fun projectStatusMapsHealthyToSuccessCheckCircle() {
        assertEquals(
            StatusHeroProjection(HeroStatus.Healthy, StatusTone.Success, StatusGlyphKind.CheckCircle),
            projectStatus(HeroStatus.Healthy),
        )
    }

    @Test
    fun projectStatusMapsDegradedToWarningAlertTriangle() {
        assertEquals(
            StatusHeroProjection(HeroStatus.Degraded, StatusTone.Warning, StatusGlyphKind.AlertTriangle),
            projectStatus(HeroStatus.Degraded),
        )
    }

    @Test
    fun projectStatusMapsUnhealthyToDangerXCircle() {
        assertEquals(
            StatusHeroProjection(HeroStatus.Unhealthy, StatusTone.Danger, StatusGlyphKind.XCircle),
            projectStatus(HeroStatus.Unhealthy),
        )
    }

    @Test
    fun projectStatusMapsUnknownToNeutralHelpCircle() {
        // unknown is the cold-start / not-yet-known tier — a muted help glyph, never a hidden panel.
        assertEquals(
            StatusHeroProjection(HeroStatus.Unknown, StatusTone.Neutral, StatusGlyphKind.HelpCircle),
            projectStatus(HeroStatus.Unknown),
        )
    }

    @Test
    fun projectStatusMapsMaintenanceToInfoWrench() {
        assertEquals(
            StatusHeroProjection(HeroStatus.Maintenance, StatusTone.Info, StatusGlyphKind.Wrench),
            projectStatus(HeroStatus.Maintenance),
        )
    }

    // ── Completeness: every HeroStatus projects (no missing branch) and is self-describing ─────────────────

    @Test
    fun everyStatusProjectsToItselfWithAToneAndGlyph() {
        // The web union has exactly five members; the native enum must cover them all with a stable projection.
        assertEquals(5, HeroStatus.entries.size)
        HeroStatus.entries.forEach { status ->
            val projection = projectStatus(status)
            assertEquals(status, projection.status)
        }
    }

    @Test
    fun distinctStatusesYieldDistinctGlyphs() {
        // Each tier has its own glyph (web CheckCircle / AlertTriangle / XCircle / HelpCircle / Wrench).
        val glyphs = HeroStatus.entries.map { projectStatus(it).glyph }.toSet()
        assertEquals(HeroStatus.entries.size, glyphs.size)
    }

    // ── StatusHeroCta: the web cta prop defaults ───────────────────────────────────────────────────────────

    @Test
    fun ctaDefaultsToNotLoading() {
        val cta = StatusHeroCta(label = "Run health check", onClick = {})
        assertFalse("a freshly built CTA is not in flight (web cta.loading is optional)", cta.loading)
        assertEquals("Run health check", cta.label)
    }
}
