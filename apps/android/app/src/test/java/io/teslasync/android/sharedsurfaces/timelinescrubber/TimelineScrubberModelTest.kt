package io.teslasync.android.sharedsurfaces.timelinescrubber

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the TimelineScrubber's pure logic — the native mirror of every value the web
 * component derives from its props (web/src/components/data-display/TimelineScrubber.tsx): the 0..1 clamp, the
 * `aria-valuetext` / preview m:ss clock with its non-finite / non-positive duration guard, the pointer→fraction
 * mapping, the integer-percent rounding, the cluster-count badge gate, the marker color-family table, and the
 * accessible-label join. Because the composable is a thin render layer over these reducers, the per-branch
 * assertions here double as the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class TimelineScrubberModelTest {
    // ── clampFraction (web `Math.max(0, Math.min(1, value))`) ────────────────────────────────────────

    @Test
    fun clampDoubleConstrainsToUnitRangeAndFoldsNaNToZero() {
        assertEquals(0.0, clampFraction(-0.5), 0.0)
        assertEquals(1.0, clampFraction(1.4), 0.0)
        assertEquals(0.37, clampFraction(0.37), 0.0)
        assertEquals(0.0, clampFraction(Double.NaN), 0.0)
    }

    @Test
    fun clampFloatConstrainsToUnitRangeAndFoldsNaNToZero() {
        assertEquals(0f, clampFraction(-2f), 0f)
        assertEquals(1f, clampFraction(9f), 0f)
        assertEquals(0.5f, clampFraction(0.5f), 0f)
        assertEquals(0f, clampFraction(Float.NaN), 0f)
    }

    // ── percentOf (web `Math.round(fraction * 100)`) ─────────────────────────────────────────────────

    @Test
    fun percentRoundsHalfUpAndClamps() {
        assertEquals(0, percentOf(0.0))
        assertEquals(100, percentOf(1.0))
        assertEquals(100, percentOf(1.7))
        assertEquals(43, percentOf(0.425))
        assertEquals(42, percentOf(0.424))
    }

    // ── fractionAt (web `positionAtClientX`) ─────────────────────────────────────────────────────────

    @Test
    fun fractionAtMapsPixelsToUnitRangeAndGuardsWidth() {
        assertEquals(0.5f, fractionAt(50f, 100), 0f)
        assertEquals(1f, fractionAt(140f, 100), 0f)
        assertEquals(0f, fractionAt(-10f, 100), 0f)
        // A non-positive width (unmeasured track) is the web `rect.width <= 0` guard → 0.
        assertEquals(0f, fractionAt(50f, 0), 0f)
    }

    // ── formatClock (web `${m}:${String(sec).padStart(2, '0')}`) ─────────────────────────────────────

    @Test
    fun formatClockZeroPadsSecondsAndCountsMinutes() {
        assertEquals("0:00", formatClock(0))
        assertEquals("0:05", formatClock(5))
        assertEquals("1:00", formatClock(60))
        assertEquals("2:05", formatClock(125))
        assertEquals("10:09", formatClock(609))
        // Defensive: a negative count collapses to 0 rather than rendering a negative clock.
        assertEquals("0:00", formatClock(-3))
    }

    // ── ariaValueText (web `aria-valuetext`) ─────────────────────────────────────────────────────────

    @Test
    fun ariaValueTextRendersTheClockForTheCurrentPlayhead() {
        // 1830s drive at 40% → round(732) → 12:12.
        assertEquals("12:12", ariaValueText(1_830.0, 0.4f))
        assertEquals("0:00", ariaValueText(1_830.0, 0.0f))
    }

    @Test
    fun ariaValueTextIsNullWhenDurationIsUnusable() {
        // Web `if (!Number.isFinite(duration) || duration <= 0) return undefined`.
        assertNull(ariaValueText(0.0, 0.5f))
        assertNull(ariaValueText(-10.0, 0.5f))
        assertNull(ariaValueText(Double.NaN, 0.5f))
        assertNull(ariaValueText(Double.POSITIVE_INFINITY, 0.5f))
    }

    @Test
    fun ariaValueTextClampsProgressBeforeFormatting() {
        assertEquals("0:00", ariaValueText(600.0, -1.0f))
        assertEquals("10:00", ariaValueText(600.0, 2.0f))
    }

    // ── previewClock (web `previewTimeStr`) ──────────────────────────────────────────────────────────

    @Test
    fun previewClockMatchesAriaSemantics() {
        assertEquals("6:00", previewClock(1_200.0, 0.3f))
        assertNull(previewClock(0.0, 0.3f))
        assertNull(previewClock(Double.NaN, 0.3f))
    }

    // ── showCountBadge (web `count != null && count > 1`) ────────────────────────────────────────────

    @Test
    fun countBadgeShowsOnlyForClustersOfMoreThanOne() {
        assertFalse(showCountBadge(null))
        assertFalse(showCountBadge(0))
        assertFalse(showCountBadge(1))
        assertTrue(showCountBadge(2))
        assertTrue(showCountBadge(17))
    }

    // ── markerStyle (web `MARKER_COLORS`) ────────────────────────────────────────────────────────────

    @Test
    fun markerStyleMapsEveryKindToItsBrandFamily() {
        assertEquals(MarkerStyle(MarkerTone.Battery, lighten = false), markerStyle(TimelineMarkerKind.Start))
        assertEquals(MarkerStyle(MarkerTone.Battery, lighten = true), markerStyle(TimelineMarkerKind.ChargeStart))
        assertEquals(MarkerStyle(MarkerTone.Danger, lighten = false), markerStyle(TimelineMarkerKind.Stop))
        assertEquals(MarkerStyle(MarkerTone.Danger, lighten = true), markerStyle(TimelineMarkerKind.LowSoc))
        assertEquals(MarkerStyle(MarkerTone.Energy, lighten = false), markerStyle(TimelineMarkerKind.FastSegment))
        assertEquals(MarkerStyle(MarkerTone.Energy, lighten = true), markerStyle(TimelineMarkerKind.ChargeStop))
        assertEquals(MarkerStyle(MarkerTone.Regen, lighten = true), markerStyle(TimelineMarkerKind.RegenPeak))
        assertEquals(MarkerStyle(MarkerTone.Neutral, lighten = false), markerStyle(TimelineMarkerKind.Event))
    }

    @Test
    fun everyKindHasAStyleAndTheTwoSameFamilyPairsAreDistinguishedByLighten() {
        // No kind falls through to a missing style, and the within-family pairs differ only by `lighten`,
        // reproducing the web 400-vs-300 shade relationship.
        TimelineMarkerKind.entries.forEach { kind -> markerStyle(kind) }
        assertEquals(markerStyle(TimelineMarkerKind.Start).tone, markerStyle(TimelineMarkerKind.ChargeStart).tone)
        assertFalse(markerStyle(TimelineMarkerKind.Start).lighten)
        assertTrue(markerStyle(TimelineMarkerKind.ChargeStart).lighten)
    }

    // ── markerAccessibleLabel (web `${label} ${t('replay.markers.atPercent')}`) ──────────────────────

    @Test
    fun accessibleLabelJoinsTheNameWithTheLocalizedPositionPhrase() {
        assertEquals("Fast segment at 40%", markerAccessibleLabel("Fast segment", "at 40%"))
        assertEquals("Charge start at 0%", markerAccessibleLabel("Charge start", "at 0%"))
    }

    // ── constants pinned to the web contract ─────────────────────────────────────────────────────────

    @Test
    fun scrubIntervalMatchesTheWebThrottle() {
        assertEquals(50L, SCRUB_INTERVAL_MS)
    }
}
