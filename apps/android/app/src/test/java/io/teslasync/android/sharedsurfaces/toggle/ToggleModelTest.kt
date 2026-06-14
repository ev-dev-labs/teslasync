package io.teslasync.android.sharedsurfaces.toggle

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Toggle surface's pure logic — the native mirror of the geometry the web
 * component computes before it paints its switch (web/src/components/ui/Toggle.tsx): the per-size track / thumb
 * dimensions and the thumb's resting vs slid offset. Because the composable is a thin render layer over
 * [metricsFor] + [thumbOffsetFor], the per-branch assertions here double as the surface's per-state snapshot.
 * Runs in the :android:testReleaseUnitTest gate.
 */
class ToggleModelTest {
    // ── metricsFor: the two web sizes are reproduced 1:1 with the web pixel sizes ────────────────────────

    @Test
    fun smallMetricsMatchTheWebSmSize() {
        // web sm: track h-5 w-9 (20×36), thumb h-3.5 w-3.5 (14), base translate-x-[3px], checked translate-x-4 (16).
        assertEquals(ToggleMetrics(36, 20, 14, 3, 16), metricsFor(ToggleSize.Sm))
    }

    @Test
    fun mediumMetricsMatchTheWebMdSize() {
        // web md: track h-6 w-11 (24×44), thumb h-5 w-5 (20), base translate-x-[3px], checked translate-x-5 (20).
        assertEquals(ToggleMetrics(44, 24, 20, 3, 20), metricsFor(ToggleSize.Md))
    }

    // ── thumbOffsetFor: the per-state snapshot (web base translate + checked ? translate-x-N : 0) ─────────

    @Test
    fun offThumbRestsAtTheInsetForEverySize() {
        assertEquals(3, thumbOffsetFor(metricsFor(ToggleSize.Sm), checked = false))
        assertEquals(3, thumbOffsetFor(metricsFor(ToggleSize.Md), checked = false))
    }

    @Test
    fun onThumbSlidesByTheCheckedOffsetForEverySize() {
        // sm: inset 3 + translate 16 = 19; md: inset 3 + translate 20 = 23.
        assertEquals(19, thumbOffsetFor(metricsFor(ToggleSize.Sm), checked = true))
        assertEquals(23, thumbOffsetFor(metricsFor(ToggleSize.Md), checked = true))
    }

    @Test
    fun theSlidThumbAlwaysStaysWithinTheTrack() {
        // The on-thumb's trailing edge (offset + diameter) must never exceed the track width, for both sizes.
        for (size in ToggleSize.entries) {
            val m = metricsFor(size)
            val trailingEdge = thumbOffsetFor(m, checked = true) + m.thumbDiameterDp
            assertTrue("thumb overflows track for $size", trailingEdge <= m.trackWidthDp)
        }
    }

    // ── size contract: both web sizes are modelled (sm / md) ─────────────────────────────────────────────

    @Test
    fun everySizeFromTheWebPropIsModelled() {
        assertEquals(2, ToggleSize.entries.size)
        assertTrue(ToggleSize.entries.containsAll(listOf(ToggleSize.Sm, ToggleSize.Md)))
    }

    // ── registration / slug contract ─────────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("Toggle", TOGGLE_SLUG)
        assertEquals("Toggle", ToggleRegistration.SLUG)
        assertEquals("toggle", ToggleRegistration.ID)
    }
}
