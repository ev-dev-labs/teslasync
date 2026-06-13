// Off-device unit coverage for the Popover modal/dialog's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the [PopoverProjection] geometry ported from the web component's
// `useLayoutEffect` `compute()` (web/src/components/ui/Popover.tsx): the side auto-flip on overflow (and the
// "don't flip into a tighter space" guard), the per-side vertical placement, the start / end / center cross-axis
// alignment, the horizontal viewport clamp (right-overflow then left-margin), the vertical viewport clamp, the
// registry identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.popover

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PopoverModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- resolveSide: the web overflow auto-flip + "no tighter flip" guard --------------------------

    @Test
    fun resolveSide_keepsBottomWhenItFits() {
        // spaceBelow = 800 - 230 - 6 - 8 = 556, content 60 fits -> stays Bottom.
        val side =
            PopoverProjection.resolveSide(
                requestedSide = PopoverSide.Bottom,
                anchor = PopoverRect(left = 100, top = 200, right = 180, bottom = 230),
                contentHeight = 60,
                viewportHeight = 800,
                sideOffset = 6,
            )
        assertEquals(PopoverSide.Bottom, side)
    }

    @Test
    fun resolveSide_flipsBottomToTopWhenBelowOverflowsAndAboveHasMoreRoom() {
        // spaceBelow = 800 - 790 - 6 - 8 = -4, spaceAbove = 760 - 6 - 8 = 746; content 60 overflows below.
        val side =
            PopoverProjection.resolveSide(
                requestedSide = PopoverSide.Bottom,
                anchor = PopoverRect(left = 500, top = 760, right = 580, bottom = 790),
                contentHeight = 60,
                viewportHeight = 800,
                sideOffset = 6,
            )
        assertEquals(PopoverSide.Top, side)
    }

    @Test
    fun resolveSide_keepsBottomWhenAboveIsNotRoomier() {
        // Both overflow, but spaceAbove (-4) <= spaceBelow (46): the web guard keeps the requested side.
        val side =
            PopoverProjection.resolveSide(
                requestedSide = PopoverSide.Bottom,
                anchor = PopoverRect(left = 0, top = 10, right = 80, bottom = 40),
                contentHeight = 200,
                viewportHeight = 100,
                sideOffset = 6,
            )
        assertEquals(PopoverSide.Bottom, side)
    }

    @Test
    fun resolveSide_keepsTopWhenItFits() {
        // spaceAbove = 400 - 6 - 8 = 386, content 60 fits -> stays Top.
        val side =
            PopoverProjection.resolveSide(
                requestedSide = PopoverSide.Top,
                anchor = PopoverRect(left = 100, top = 400, right = 180, bottom = 430),
                contentHeight = 60,
                viewportHeight = 800,
                sideOffset = 6,
            )
        assertEquals(PopoverSide.Top, side)
    }

    @Test
    fun resolveSide_flipsTopToBottomWhenAboveOverflowsAndBelowHasMoreRoom() {
        // spaceAbove = 20 - 6 - 8 = 6, spaceBelow = 800 - 50 - 6 - 8 = 736; content 200 overflows above.
        val side =
            PopoverProjection.resolveSide(
                requestedSide = PopoverSide.Top,
                anchor = PopoverRect(left = 0, top = 20, right = 80, bottom = 50),
                contentHeight = 200,
                viewportHeight = 800,
                sideOffset = 6,
            )
        assertEquals(PopoverSide.Bottom, side)
    }

    // ---- resolve: per-side vertical placement (web `top = a.bottom + sideOffset` | `a.top - sideOffset - c.height`)

    @Test
    fun resolve_bottomSidePlacesContentBelowAnchorWithOffset() {
        val placement =
            PopoverProjection.resolve(
                anchor = PopoverRect(left = 100, top = 200, right = 180, bottom = 230),
                content = PopoverSize(width = 120, height = 60),
                viewport = PopoverSize(width = 1000, height = 800),
                options = PopoverOptions(side = PopoverSide.Bottom, align = PopoverAlign.Start, sideOffset = 6),
            )
        assertEquals(PopoverSide.Bottom, placement.resolvedSide)
        assertEquals(236, placement.y) // 230 + 6
        assertEquals(100, placement.x) // align start -> anchor.left
    }

    @Test
    fun resolve_flippedTopSidePlacesContentAboveAnchor() {
        val placement =
            PopoverProjection.resolve(
                anchor = PopoverRect(left = 500, top = 760, right = 580, bottom = 790),
                content = PopoverSize(width = 120, height = 60),
                viewport = PopoverSize(width = 1000, height = 800),
                options = PopoverOptions(side = PopoverSide.Bottom, align = PopoverAlign.Start, sideOffset = 6),
            )
        assertEquals(PopoverSide.Top, placement.resolvedSide)
        assertEquals(694, placement.y) // 760 - 6 - 60
    }

    // ---- resolve: cross-axis alignment (web `align` start | end | center) ---------------------------

    @Test
    fun resolve_alignStartPinsLeadingEdges() {
        assertEquals(300, alignedLeft(PopoverAlign.Start))
    }

    @Test
    fun resolve_alignEndPinsTrailingEdges() {
        assertEquals(260, alignedLeft(PopoverAlign.End)) // 380 - 120
    }

    @Test
    fun resolve_alignCenterCentersContentOverAnchor() {
        // anchor.left 300 + anchor.width/2 (40) - content.width/2 (60) = 280.
        assertEquals(280, alignedLeft(PopoverAlign.Center))
    }

    private fun alignedLeft(align: PopoverAlign): Int =
        PopoverProjection
            .resolve(
                anchor = PopoverRect(left = 300, top = 200, right = 380, bottom = 230),
                content = PopoverSize(width = 120, height = 40),
                viewport = PopoverSize(width = 1000, height = 800),
                options = PopoverOptions(side = PopoverSide.Bottom, align = align, sideOffset = 6),
            ).x

    // ---- resolve: horizontal viewport clamp (web right-overflow then left-margin) -------------------

    @Test
    fun resolve_clampsContentInsideRightEdge() {
        val placement =
            PopoverProjection.resolve(
                anchor = PopoverRect(left = 950, top = 200, right = 990, bottom = 230),
                content = PopoverSize(width = 120, height = 40),
                viewport = PopoverSize(width = 1000, height = 800),
                options = PopoverOptions(side = PopoverSide.Bottom, align = PopoverAlign.Start, sideOffset = 6),
            )
        assertEquals(872, placement.x) // 1000 - 120 - 8
    }

    @Test
    fun resolve_clampsContentToLeftMargin() {
        // align End would push left to 40 - 120 = -80; clamp to the 8 px margin.
        val placement =
            PopoverProjection.resolve(
                anchor = PopoverRect(left = 0, top = 200, right = 40, bottom = 230),
                content = PopoverSize(width = 120, height = 40),
                viewport = PopoverSize(width = 1000, height = 800),
                options = PopoverOptions(side = PopoverSide.Bottom, align = PopoverAlign.End, sideOffset = 6),
            )
        assertEquals(PopoverProjection.MARGIN_PX, placement.x)
    }

    // ---- resolve: vertical viewport clamp (web rare both-sides-overflow) -----------------------------

    @Test
    fun resolve_clampsContentInsideBottomEdge() {
        // Bottom kept (spaceAbove -4 <= spaceBelow 146), top 46, content 180 overflows -> 200 - 180 - 8 = 12.
        val placement =
            PopoverProjection.resolve(
                anchor = PopoverRect(left = 0, top = 10, right = 80, bottom = 40),
                content = PopoverSize(width = 60, height = 180),
                viewport = PopoverSize(width = 1000, height = 200),
                options = PopoverOptions(side = PopoverSide.Bottom, align = PopoverAlign.Start, sideOffset = 6),
            )
        assertEquals(PopoverSide.Bottom, placement.resolvedSide)
        assertEquals(12, placement.y)
    }

    @Test
    fun resolve_clampsContentToTopMarginWhenTallerThanViewport() {
        // Content taller than the viewport: the bottom clamp would go negative, so the top margin wins.
        val placement =
            PopoverProjection.resolve(
                anchor = PopoverRect(left = 0, top = 10, right = 80, bottom = 40),
                content = PopoverSize(width = 60, height = 200),
                viewport = PopoverSize(width = 1000, height = 200),
                options = PopoverOptions(side = PopoverSide.Bottom, align = PopoverAlign.Start, sideOffset = 6),
            )
        assertEquals(PopoverProjection.MARGIN_PX, placement.y)
    }

    @Test
    fun resolve_usesDefaultSideOffsetWhenOmitted() {
        val placement =
            PopoverProjection.resolve(
                anchor = PopoverRect(left = 100, top = 200, right = 180, bottom = 230),
                content = PopoverSize(width = 80, height = 40),
                viewport = PopoverSize(width = 1000, height = 800),
            )
        // Defaults: side Bottom, align Start, sideOffset 6 -> top = 230 + 6.
        assertEquals(PopoverSide.Bottom, placement.resolvedSide)
        assertEquals(230 + PopoverProjection.DEFAULT_SIDE_OFFSET_PX, placement.y)
        assertEquals(100, placement.x)
    }

    // ---- Registry + diagnostics ---------------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("popover", PopoverRegistration.ID)
        assertEquals("Popover", PopoverRegistration.SLUG)
    }

    @Test
    fun recordPopoverOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordPopoverOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "Popover"), fields)
        // The diagnostic must carry no anchor coordinates — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
