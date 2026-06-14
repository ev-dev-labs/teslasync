package io.teslasync.android.sharedsurfaces.resourcespanel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ResourcesPanel's pure logic — the native mirror of the web component's
 * `percent == null ? 'normal' : percent >= 90 ? 'critical' : percent >= 70 ? 'warn' : 'normal'` thresholds and
 * its bar arithmetic (`width: max(0, min(100, percent))%`, `aria-valuenow = Math.round(percent)`) from
 * web/src/components/status/ResourcesPanel.tsx. Because the composable is a thin render layer over
 * [ResourcesPanelModel.projectRow], the assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ResourcesPanelModelTest {
    private val floatTolerance = 1e-6f

    // ── severityFor: the web normal / warn / critical threshold ladder ──────────────────────────────────────

    @Test
    fun nullPercentIsNormal() {
        // A row with no bar defaults to normal (web `percent == null ? 'normal'`).
        assertEquals(ResourceSeverity.Normal, ResourcesPanelModel.severityFor(null))
    }

    @Test
    fun belowWarnThresholdIsNormal() {
        assertEquals(ResourceSeverity.Normal, ResourcesPanelModel.severityFor(0.0))
        assertEquals(ResourceSeverity.Normal, ResourcesPanelModel.severityFor(69.999))
    }

    @Test
    fun atAndAboveWarnButBelowCriticalIsWarn() {
        // The threshold is inclusive (web `percent >= 70`).
        assertEquals(ResourceSeverity.Warn, ResourcesPanelModel.severityFor(70.0))
        assertEquals(ResourceSeverity.Warn, ResourcesPanelModel.severityFor(89.999))
    }

    @Test
    fun atAndAboveCriticalIsCritical() {
        // The threshold is inclusive (web `percent >= 90`).
        assertEquals(ResourceSeverity.Critical, ResourcesPanelModel.severityFor(90.0))
        assertEquals(ResourceSeverity.Critical, ResourcesPanelModel.severityFor(100.0))
        assertEquals(ResourceSeverity.Critical, ResourcesPanelModel.severityFor(150.0))
    }

    @Test
    fun nonFinitePercentFoldsToNormal() {
        // NaN/Infinity compare false against both thresholds, exactly as they do in JS.
        assertEquals(ResourceSeverity.Normal, ResourcesPanelModel.severityFor(Double.NaN))
        assertEquals(ResourceSeverity.Critical, ResourcesPanelModel.severityFor(Double.POSITIVE_INFINITY))
        assertEquals(ResourceSeverity.Normal, ResourcesPanelModel.severityFor(Double.NEGATIVE_INFINITY))
    }

    // ── tone projections: web barColor (always status-coloured) vs textColor (normal stays primary) ──────────

    @Test
    fun barToneFollowsSeverityGreenAmberRed() {
        assertEquals(BarTone.Success, ResourceSeverity.Normal.barTone)
        assertEquals(BarTone.Warning, ResourceSeverity.Warn.barTone)
        assertEquals(BarTone.Danger, ResourceSeverity.Critical.barTone)
    }

    @Test
    fun valueToneKeepsNormalPrimaryButColoursWarnAndCritical() {
        // The one place the value tone diverges from the bar: a normal value is primary text, not green.
        assertEquals(ValueTone.Primary, ResourceSeverity.Normal.valueTone)
        assertEquals(ValueTone.Warning, ResourceSeverity.Warn.valueTone)
        assertEquals(ValueTone.Danger, ResourceSeverity.Critical.valueTone)
    }

    // ── barFraction: web max(0, min(100, percent)) / 100, clamped to a 0f..1f fill ───────────────────────────

    @Test
    fun barFractionIsTheClampedFill() {
        assertEquals(0f, ResourcesPanelModel.barFraction(0.0), floatTolerance)
        assertEquals(0.5f, ResourcesPanelModel.barFraction(50.0), floatTolerance)
        assertEquals(1f, ResourcesPanelModel.barFraction(100.0), floatTolerance)
    }

    @Test
    fun barFractionClampsOutOfRangePercents() {
        // Web `Math.max(0, Math.min(100, percent))`: over-100 saturates at full, negatives at empty.
        assertEquals(1f, ResourcesPanelModel.barFraction(150.0), floatTolerance)
        assertEquals(0f, ResourcesPanelModel.barFraction(-10.0), floatTolerance)
    }

    @Test
    fun barFractionFoldsNonFiniteToEmpty() {
        // Native-safety guard so a NaN never becomes a broken NaN% width.
        assertEquals(0f, ResourcesPanelModel.barFraction(Double.NaN), floatTolerance)
        assertEquals(0f, ResourcesPanelModel.barFraction(Double.POSITIVE_INFINITY), floatTolerance)
    }

    // ── barValueNow: web aria-valuenow = Math.round(percent), deliberately NOT clamped ───────────────────────

    @Test
    fun barValueNowRoundsToNearestInteger() {
        assertEquals(49, ResourcesPanelModel.barValueNow(49.4))
        assertEquals(50, ResourcesPanelModel.barValueNow(49.6))
    }

    @Test
    fun barValueNowRoundsTiesTowardPositiveInfinityLikeMathRound() {
        // Kotlin roundToInt matches JS Math.round on ties (toward +inf).
        assertEquals(76, ResourcesPanelModel.barValueNow(75.5))
        assertEquals(-75, ResourcesPanelModel.barValueNow(-75.5))
    }

    @Test
    fun barValueNowIsNotClamped() {
        // The web reports the true rounded value even past 100 (only the bar WIDTH is clamped).
        assertEquals(150, ResourcesPanelModel.barValueNow(150.0))
    }

    @Test
    fun barValueNowFoldsNonFiniteToZero() {
        assertEquals(0, ResourcesPanelModel.barValueNow(Double.NaN))
        assertEquals(0, ResourcesPanelModel.barValueNow(Double.POSITIVE_INFINITY))
    }

    // ── projectRow: the single "data adapter" the composable consumes (raw percent → render projection) ──────

    @Test
    fun projectRowWithoutPercentHasNoBar() {
        val projection = ResourcesPanelModel.projectRow(null)
        assertEquals(ResourceSeverity.Normal, projection.severity)
        assertFalse(projection.hasBar)
        assertEquals(0f, projection.barFraction, floatTolerance)
        assertEquals(0, projection.barValueNow)
    }

    @Test
    fun projectRowNormalRowHasGreenBarAndPrimaryValue() {
        val projection = ResourcesPanelModel.projectRow(50.0)
        assertEquals(ResourceSeverity.Normal, projection.severity)
        assertTrue(projection.hasBar)
        assertEquals(0.5f, projection.barFraction, floatTolerance)
        assertEquals(50, projection.barValueNow)
        assertEquals(BarTone.Success, projection.severity.barTone)
        assertEquals(ValueTone.Primary, projection.severity.valueTone)
    }

    @Test
    fun projectRowWarnRow() {
        val projection = ResourcesPanelModel.projectRow(74.0)
        assertEquals(ResourceSeverity.Warn, projection.severity)
        assertTrue(projection.hasBar)
        assertEquals(0.74f, projection.barFraction, floatTolerance)
        assertEquals(74, projection.barValueNow)
    }

    @Test
    fun projectRowCriticalRow() {
        val projection = ResourcesPanelModel.projectRow(92.0)
        assertEquals(ResourceSeverity.Critical, projection.severity)
        assertTrue(projection.hasBar)
        assertEquals(0.92f, projection.barFraction, floatTolerance)
        assertEquals(92, projection.barValueNow)
    }

    @Test
    fun projectRowOverHundredClampsTheBarButNotTheValue() {
        // Demonstrates the two distinct web derivations: the fill saturates at 1f, aria-valuenow stays 120.
        val projection = ResourcesPanelModel.projectRow(120.0)
        assertEquals(ResourceSeverity.Critical, projection.severity)
        assertTrue(projection.hasBar)
        assertEquals(1f, projection.barFraction, floatTolerance)
        assertEquals(120, projection.barValueNow)
    }

    @Test
    fun projectRowNonFinitePercentStillHasASafeEmptyBar() {
        // hasBar follows `percent != null`, so a non-finite value still shows a (safely empty) bar.
        val projection = ResourcesPanelModel.projectRow(Double.NaN)
        assertEquals(ResourceSeverity.Normal, projection.severity)
        assertTrue(projection.hasBar)
        assertEquals(0f, projection.barFraction, floatTolerance)
        assertEquals(0, projection.barValueNow)
    }
}
