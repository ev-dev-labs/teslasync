package io.teslasync.android.sharedsurfaces.spinner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Spinner's pure logic — the native mirror of every derivation the web
 * component performs (web/src/components/feedback/Spinner.tsx): the `sizeMap` scale, the SVG bolt outline,
 * and the `boltDraw` @keyframes timeline (strike-in -> fill -> hold -> fade-and-retreat) plus its reduced-motion
 * short-circuit. Because the surface is purely presentational each projected [BoltFrame] is exactly what the
 * thin composable draws, so these assertions double as the per-state "snapshot". Runs in the
 * :android:testReleaseUnitTest gate.
 */
class SpinnerProjectionTest {
    private val tolerance = 1e-4f

    // ── Size scale (web `sizeMap` sm / md / lg) ─────────────────────────────────────

    @Test
    fun sizeScaleMatchesTheWebSizeMap() {
        assertEquals(24, SpinnerSize.Sm.boxDp)
        assertEquals(48, SpinnerSize.Md.boxDp)
        assertEquals(80, SpinnerSize.Lg.boxDp)

        assertEquals(22f, SpinnerSize.Sm.strokeViewport, tolerance)
        assertEquals(14f, SpinnerSize.Md.strokeViewport, tolerance)
        assertEquals(10f, SpinnerSize.Lg.strokeViewport, tolerance)
    }

    @Test
    fun strokeWidthScalesTheViewportStrokeOutOfTheBox() {
        // web `stroke` lives in the 200-unit viewBox; on-screen width = strokeViewport * boxPx / 200.
        assertEquals(14f, SpinnerProjection.strokeWidthPx(SpinnerSize.Md, boxPx = 200f), tolerance)
        assertEquals(3.36f, SpinnerProjection.strokeWidthPx(SpinnerSize.Md, boxPx = 48f), tolerance)
        assertEquals(4f, SpinnerProjection.strokeWidthPx(SpinnerSize.Lg, boxPx = 80f), tolerance)
        assertEquals(2.64f, SpinnerProjection.strokeWidthPx(SpinnerSize.Sm, boxPx = 24f), tolerance)
    }

    // ── Bolt outline (decode of `M112 30L62 108h34L78 170l58-82h-34z`) ───────────────

    @Test
    fun boltOutlineDecodesEveryAbsoluteAndRelativeSegment() {
        val outline = SpinnerProjection.BOLT_OUTLINE
        assertEquals(6, outline.size)
        assertEquals(BoltVertex(112f, 30f), outline[0]) // M112 30
        assertEquals(BoltVertex(62f, 108f), outline[1]) // L62 108
        assertEquals(BoltVertex(96f, 108f), outline[2]) // h34 -> 62 + 34
        assertEquals(BoltVertex(78f, 170f), outline[3]) // L78 170
        assertEquals(BoltVertex(136f, 88f), outline[4]) // l58 -82 -> 78 + 58, 170 - 82
        assertEquals(BoltVertex(102f, 88f), outline[5]) // h-34 -> 136 - 34
    }

    @Test
    fun viewboxMatchesTheWebSvg() {
        assertEquals(200f, SpinnerProjection.VIEWBOX, tolerance)
    }

    // ── Keyframe timeline — each frame doubles as a per-state snapshot ───────────────

    @Test
    fun frameAtZeroIsTheFaintEmptyStart() {
        // web 0%: stroke-dashoffset 100 (nothing drawn), fill-opacity 0, opacity 0.15.
        assertFrame(SpinnerProjection.frameAt(0f), drawStart = 0f, drawEnd = 0f, fill = 0f, opacity = 0.15f)
    }

    @Test
    fun frameAtThirtyIsTheFullyStruckInOutline() {
        // web 30%: stroke-dashoffset 0 (fully drawn), still unfilled, fully opaque.
        assertFrame(SpinnerProjection.frameAt(0.30f), drawStart = 0f, drawEnd = 1f, fill = 0f, opacity = 1f)
    }

    @Test
    fun frameAtFiftyFiveIsTheFilledSolidBolt() {
        // web 55%: drawn + filled + fully opaque.
        assertFrame(SpinnerProjection.frameAt(0.55f), drawStart = 0f, drawEnd = 1f, fill = 1f, opacity = 1f)
    }

    @Test
    fun frameAtEightyIsTheHeldFrameBeginningToDim() {
        // web 80%: drawn + filled, opacity easing down to 0.9.
        assertFrame(SpinnerProjection.frameAt(0.80f), drawStart = 0f, drawEnd = 1f, fill = 1f, opacity = 0.90f)
    }

    @Test
    fun frameAtOneIsTheRetreatedFadedOut() {
        // web 100%: stroke-dashoffset -100 (retreated to nothing), fill 0, opacity 0.
        assertFrame(SpinnerProjection.frameAt(1f), drawStart = 1f, drawEnd = 1f, fill = 0f, opacity = 0f)
    }

    @Test
    fun frameInterpolatesLinearlyBetweenKeyframes() {
        // Half-way through the strike-in (0 -> 0.30): the outline is half-drawn, opacity half-risen.
        assertFrame(SpinnerProjection.frameAt(0.15f), drawStart = 0f, drawEnd = 0.5f, fill = 0f, opacity = 0.575f)
        // Half-way through the fade (0.80 -> 1.0): the stroke half-retreats, fill + opacity half-drop.
        assertFrame(SpinnerProjection.frameAt(0.90f), drawStart = 0.5f, drawEnd = 1f, fill = 0.5f, opacity = 0.45f)
    }

    @Test
    fun frameClampsOutOfRangeAndNonFiniteProgressToTheTimelineEnds() {
        assertFrame(SpinnerProjection.frameAt(-0.5f), drawStart = 0f, drawEnd = 0f, fill = 0f, opacity = 0.15f)
        assertFrame(SpinnerProjection.frameAt(2f), drawStart = 1f, drawEnd = 1f, fill = 0f, opacity = 0f)
        assertFrame(SpinnerProjection.frameAt(Float.NaN), drawStart = 0f, drawEnd = 0f, fill = 0f, opacity = 0.15f)
    }

    @Test
    fun staticFrameIsTheFullyFilledReducedMotionBolt() {
        // web reduce branch: fully drawn, filled, opaque — no draw cycle.
        assertFrame(SpinnerProjection.STATIC_FRAME, drawStart = 0f, drawEnd = 1f, fill = 1f, opacity = 1f)
    }

    // ── Label + accessibility (web `{label && …}` / `aria-label={label ?? 'Loading'}`) ─

    @Test
    fun visibleLabelFollowsWebTruthiness() {
        assertFalse(SpinnerProjection.hasVisibleLabel(null))
        assertFalse(SpinnerProjection.hasVisibleLabel(""))
        assertTrue(SpinnerProjection.hasVisibleLabel("Loading dashboard"))
    }

    @Test
    fun accessibleNameMirrorsTheNullCoalescingFallback() {
        assertEquals("Loading", SpinnerProjection.accessibleLabel(null, "Loading"))
        assertEquals("Battery health", SpinnerProjection.accessibleLabel("Battery health", "Loading"))
        // web `??` only falls back on null/undefined, so a supplied (even empty) label is kept verbatim.
        assertEquals("", SpinnerProjection.accessibleLabel("", "Loading"))
    }

    // ── Segment emptiness contract (the renderer paints nothing for an empty reveal) ──

    @Test
    fun firstAndLastFramesProduceAnEmptyReveal() {
        // drawEnd <= drawStart -> no visible segment -> the composable paints nothing (never a blank box: the
        // host page owns the surrounding chrome while this faint instant passes).
        val start = SpinnerProjection.frameAt(0f)
        assertTrue(start.drawEnd <= start.drawStart)
        val end = SpinnerProjection.frameAt(1f)
        assertTrue(end.drawEnd <= end.drawStart)
        // A mid-strike frame DOES reveal a segment.
        val mid = SpinnerProjection.frameAt(0.15f)
        assertTrue(mid.drawEnd > mid.drawStart)
    }

    @Test
    fun diagnosticsSlugIsTheSurfaceName() {
        assertEquals("Spinner", SpinnerDiagnostics.SLUG)
    }

    @Test
    fun unmappedSizeNeverLeaksANullScale() {
        // Every enum entry resolves a positive box + stroke (guards a future size addition).
        SpinnerSize.entries.forEach { size ->
            assertTrue(size.boxDp > 0)
            assertTrue(size.strokeViewport > 0f)
        }
        assertNull(SpinnerSize.entries.firstOrNull { it.boxDp <= 0 })
    }

    private fun assertFrame(
        frame: BoltFrame,
        drawStart: Float,
        drawEnd: Float,
        fill: Float,
        opacity: Float,
    ) {
        assertEquals(drawStart, frame.drawStart, tolerance)
        assertEquals(drawEnd, frame.drawEnd, tolerance)
        assertEquals(fill, frame.fillOpacity, tolerance)
        assertEquals(opacity, frame.opacity, tolerance)
    }
}
