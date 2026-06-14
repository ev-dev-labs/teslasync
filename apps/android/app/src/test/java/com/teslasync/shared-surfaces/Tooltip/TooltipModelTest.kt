// Off-device unit coverage for the Tooltip surface's pure model (P3 acceptance: adapter + per-state +
// a11y/diagnostics tests). Exercises the registration slug + test tags, the four sides + RTL mirroring, the
// reveal fold (web `:hover` / `:focus-within` / tap), the four-side popup geometry (with gap, RTL mirror, and
// window clamping), the `aria-describedby` join that mirrors the web `[existing, id].filter(Boolean).join(' ')`,
// the single-line vs multiline body helpers, the reduced-motion reveal duration, and the PII-safe diagnostics.
// No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the
// behaviour the web source (web/src/components/ui/Tooltip.tsx) produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tooltip

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TooltipModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────────────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("tooltip", TooltipRegistration.ID)
        assertEquals("Tooltip", TooltipRegistration.SLUG)
        assertEquals("tooltip-trigger", TooltipRegistration.TRIGGER_TEST_TAG)
        assertEquals("tooltip-body", TooltipRegistration.TOOLTIP_TEST_TAG)
    }

    // ── side: four sides, default top; RTL mirrors left/right and leaves top/bottom alone ─────────────────

    @Test
    fun sideCoversAllFourSidesInOrder() {
        assertEquals(
            listOf(TooltipSide.Top, TooltipSide.Bottom, TooltipSide.Left, TooltipSide.Right),
            TooltipSide.entries.toList(),
        )
    }

    @Test
    fun physicalSidePassesThroughUnderLtr() {
        TooltipSide.entries.forEach { side ->
            assertEquals(side, resolvePhysicalSide(side, isRtl = false))
        }
    }

    @Test
    fun physicalSideMirrorsLeftRightUnderRtl() {
        assertEquals(TooltipSide.Right, resolvePhysicalSide(TooltipSide.Left, isRtl = true))
        assertEquals(TooltipSide.Left, resolvePhysicalSide(TooltipSide.Right, isRtl = true))
        // Top / bottom are unaffected by reading direction.
        assertEquals(TooltipSide.Top, resolvePhysicalSide(TooltipSide.Top, isRtl = true))
        assertEquals(TooltipSide.Bottom, resolvePhysicalSide(TooltipSide.Bottom, isRtl = true))
    }

    // ── reveal: web `:hover` OR `:focus-within` OR tap reveals; all idle stays hidden ─────────────────────

    @Test
    fun revealIsHiddenWhenEveryInputIsIdle() {
        assertEquals(TooltipReveal.Hidden, tooltipRevealFor(hovered = false, focused = false, pressed = false))
    }

    @Test
    fun anySingleInputRevealsTheTooltip() {
        assertEquals(TooltipReveal.Revealed, tooltipRevealFor(hovered = true, focused = false, pressed = false))
        assertEquals(TooltipReveal.Revealed, tooltipRevealFor(hovered = false, focused = true, pressed = false))
        assertEquals(TooltipReveal.Revealed, tooltipRevealFor(hovered = false, focused = false, pressed = true))
        assertEquals(TooltipReveal.Revealed, tooltipRevealFor(hovered = true, focused = true, pressed = true))
    }

    // ── placement geometry: top / bottom / left / right, gap, RTL mirror, window clamp ────────────────────

    private fun offset(
        side: TooltipSide,
        isRtl: Boolean = false,
    ): TooltipOffset =
        tooltipPopupOffset(
            side = side,
            anchorLeft = 100,
            anchorTop = 200,
            anchorWidth = 40,
            anchorHeight = 40,
            popupWidth = 120,
            popupHeight = 60,
            windowWidth = 1000,
            windowHeight = 2000,
            gap = 8,
            isRtl = isRtl,
        )

    @Test
    fun topSideCentresAboveTheAnchorWithGap() {
        // centerX 120 − popupW/2 60 = 60 ; anchorTop 200 − popupH 60 − gap 8 = 132.
        assertEquals(TooltipOffset(60, 132), offset(TooltipSide.Top))
    }

    @Test
    fun bottomSideCentresBelowTheAnchorWithGap() {
        // centerX 60 ; anchorBottom 240 + gap 8 = 248.
        assertEquals(TooltipOffset(60, 248), offset(TooltipSide.Bottom))
    }

    @Test
    fun rightSideSitsToTheRightCentredVertically() {
        // anchorRight 140 + gap 8 = 148 ; centerY 220 − popupH/2 30 = 190.
        assertEquals(TooltipOffset(148, 190), offset(TooltipSide.Right))
    }

    @Test
    fun leftSideClampsIntoTheWindowWhenItWouldSpillOffScreen() {
        // anchorLeft 100 − popupW 120 − gap 8 = −28 → clamped to 0 ; centerY 190.
        assertEquals(TooltipOffset(0, 190), offset(TooltipSide.Left))
    }

    @Test
    fun rtlMirrorsLeftAndRightSide() {
        // Under RTL a "left" request resolves to the physical right, and vice versa.
        assertEquals(offset(TooltipSide.Right), offset(TooltipSide.Left, isRtl = true))
        assertEquals(offset(TooltipSide.Left), offset(TooltipSide.Right, isRtl = true))
    }

    @Test
    fun horizontalOverflowIsClampedToTheWindowRightEdge() {
        // Anchor near the right edge: centerX 1000 − popupW/2 60 = 940, clamped to windowW 1000 − popupW 120 = 880.
        val result =
            tooltipPopupOffset(
                side = TooltipSide.Top,
                anchorLeft = 980,
                anchorTop = 500,
                anchorWidth = 40,
                anchorHeight = 40,
                popupWidth = 120,
                popupHeight = 60,
                windowWidth = 1000,
                windowHeight = 2000,
                gap = 8,
                isRtl = false,
            )
        assertEquals(880, result.x)
    }

    @Test
    fun verticalOverflowIsClampedToTheTopEdge() {
        // Top placement against a near-top anchor would go negative; it is clamped to 0.
        val result =
            tooltipPopupOffset(
                side = TooltipSide.Top,
                anchorLeft = 100,
                anchorTop = 10,
                anchorWidth = 40,
                anchorHeight = 40,
                popupWidth = 120,
                popupHeight = 60,
                windowWidth = 1000,
                windowHeight = 2000,
                gap = 8,
                isRtl = false,
            )
        assertEquals(0, result.y)
    }

    // ── aria-describedby join: web `[existing, id].filter(Boolean).join(' ')` ──────────────────────────────

    @Test
    fun describedByIsJustTheTooltipIdWhenNoExistingDescription() {
        assertEquals("tooltip-3", joinAriaDescribedBy(existing = null, tooltipId = "tooltip-3"))
    }

    @Test
    fun describedByDropsAnEmptyOrBlankExistingDescription() {
        // Web `filter(Boolean)` removes the falsy empty string; a whitespace-only value is treated the same.
        assertEquals("tooltip-3", joinAriaDescribedBy(existing = "", tooltipId = "tooltip-3"))
        assertEquals("tooltip-3", joinAriaDescribedBy(existing = "   ", tooltipId = "tooltip-3"))
    }

    @Test
    fun describedByPreservesAnExistingDescriptionAndAppendsTheTooltipId() {
        assertEquals("field-desc tooltip-3", joinAriaDescribedBy(existing = "field-desc", tooltipId = "tooltip-3"))
    }

    // ── multiline body: web `whitespace-nowrap` vs `whitespace-normal max-w-[260px]` ──────────────────────

    @Test
    fun maxWidthIsCappedOnlyWhenMultiline() {
        assertEquals(260, TOOLTIP_MAX_WIDTH_DP)
        assertEquals(260, tooltipMaxWidthDp(multiline = true))
        assertNull(tooltipMaxWidthDp(multiline = false))
    }

    @Test
    fun wrappingAndLineCountFollowTheMultilineFlag() {
        assertTrue(tooltipWraps(multiline = true))
        assertFalse(tooltipWraps(multiline = false))
        assertEquals(Int.MAX_VALUE, tooltipMaxLines(multiline = true))
        assertEquals(1, tooltipMaxLines(multiline = false))
    }

    // ── reduced motion: web `motion-reduce:transition-none` collapses the reveal duration to 0 ────────────

    @Test
    fun revealDurationCollapsesUnderReducedMotion() {
        assertEquals(0, tooltipRevealMillis(reduceMotion = true, baseMs = 150))
    }

    @Test
    fun revealDurationIsTheRequestedBaseWhenMotionIsAllowed() {
        assertEquals(150, tooltipRevealMillis(reduceMotion = false, baseMs = 150))
    }

    @Test
    fun revealDurationFoldsANegativeRequestToZero() {
        assertEquals(0, tooltipRevealMillis(reduceMotion = false, baseMs = -5))
    }

    // ── diagnostics: one PII-safe view.opened (slug only) ─────────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val logger = RecordingLogger()
        recordTooltipOpened(logger)
        assertEquals(1, logger.records.size)
        assertEquals(LogLevel.Info, logger.records[0].level)
        assertEquals("view.opened", logger.records[0].event)
        // Only the surface slug — no tooltip content or trigger label can leak through the diagnostic.
        assertEquals(mapOf("surface" to "Tooltip"), logger.records[0].fields)
    }
}
