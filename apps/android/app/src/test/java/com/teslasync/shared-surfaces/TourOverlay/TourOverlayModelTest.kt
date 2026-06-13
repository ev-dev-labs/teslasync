// Off-device unit tests for the TourOverlay model + spotlight/tooltip geometry + render classifier (the
// :android:testReleaseUnitTest gate). These cover the framework-free core the composable renders: the
// spotlight padding math (web `spotlight`), the width clamp (web `Math.min(360, vw - pad*2)`), the per-
// placement tooltip anchor + edge/bottom-nav clamping (web `getTooltipPosition` / `clampLeft` / `clampTop`),
// the navigation branches (first step hides "Back", last step finishes, the trailing arrow), the active-dot
// reducer, the merged accessibility label, the every-branch surface classification (Hidden vs Visible), and
// the PII-safe `view.opened` diagnostic. The composable is a thin render layer over these, so exercising them
// here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.touroverlay

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TourOverlayModelTest {
    // ── spotlight padding (web spotlight = { left: rect.left - pad, …, width: rect.width + pad*2 }) ──────────

    @Test
    fun spotlightBounds_padsTargetOnEverySide() {
        val target = TourTarget(leftDp = 100f, topDp = 200f, widthDp = 240f, heightDp = 56f)
        val spotlight = spotlightBounds(target, paddingDp = 6f)
        assertEquals(94f, spotlight.leftDp, EPS)
        assertEquals(194f, spotlight.topDp, EPS)
        assertEquals(252f, spotlight.widthDp, EPS)
        assertEquals(68f, spotlight.heightDp, EPS)
    }

    @Test
    fun spotlightBounds_clampsNegativePaddingToZero() {
        val target = TourTarget(leftDp = 10f, topDp = 10f, widthDp = 20f, heightDp = 20f)
        val spotlight = spotlightBounds(target, paddingDp = -5f)
        assertEquals(10f, spotlight.leftDp, EPS)
        assertEquals(20f, spotlight.widthDp, EPS)
    }

    // ── tooltip width clamp (web maxW = Math.min(360, vw - pad*2)) ────────────────────────────────────────────

    @Test
    fun tooltipMaxWidth_capsAt360OnWideViewport() {
        assertEquals(360f, tooltipMaxWidthDp(800f), EPS)
    }

    @Test
    fun tooltipMaxWidth_shrinksToViewportMinusPaddingWhenNarrow() {
        // 320 - 16*2 = 288 < 360.
        assertEquals(288f, tooltipMaxWidthDp(320f), EPS)
    }

    @Test
    fun tooltipMaxWidth_saturatesAtZeroForTinyViewport() {
        assertEquals(0f, tooltipMaxWidthDp(10f), EPS)
    }

    // ── tooltip anchor per placement (web getTooltipPosition switch) ──────────────────────────────────────────

    @Test
    fun tooltipPosition_bottomAnchorsBelowTargetAtTargetLeft() {
        val target = TourTarget(leftDp = 60f, topDp = 100f, widthDp = 200f, heightDp = 50f)
        val position = tooltipPosition(TourPlacement.Bottom, target, VIEWPORT, TOOLTIP)
        assertEquals(60f, position.xDp, EPS)
        // target.bottom (150) + gap (16) = 166.
        assertEquals(166f, position.yDp, EPS)
        assertEquals(360f, position.maxWidthDp, EPS)
    }

    @Test
    fun tooltipPosition_topAnchorsAboveTargetByTooltipHeight() {
        val target = TourTarget(leftDp = 60f, topDp = 400f, widthDp = 200f, heightDp = 50f)
        val position = tooltipPosition(TourPlacement.Top, target, VIEWPORT, TOOLTIP)
        assertEquals(60f, position.xDp, EPS)
        // target.top (400) - gap (16) - tooltip.height (180) = 204.
        assertEquals(204f, position.yDp, EPS)
    }

    @Test
    fun tooltipPosition_rightAnchorsPastTargetRight() {
        val target = TourTarget(leftDp = 40f, topDp = 120f, widthDp = 120f, heightDp = 40f)
        val position = tooltipPosition(TourPlacement.Right, target, VIEWPORT, TOOLTIP)
        // target.right (160) + gap (16) = 176.
        assertEquals(176f, position.xDp, EPS)
        assertEquals(120f, position.yDp, EPS)
    }

    @Test
    fun tooltipPosition_leftClampsToEdgePaddingWhenItWouldOverflow() {
        val target = TourTarget(leftDp = 40f, topDp = 120f, widthDp = 120f, heightDp = 40f)
        val position = tooltipPosition(TourPlacement.Left, target, VIEWPORT, TOOLTIP)
        // target.left (40) - gap (16) - tooltip.width (300) = -276 → clamped up to pad (16).
        assertEquals(16f, position.xDp, EPS)
    }

    @Test
    fun tooltipPosition_clampsTopAboveTheBottomNav() {
        val target = TourTarget(leftDp = 60f, topDp = 760f, widthDp = 200f, heightDp = 50f)
        val position = tooltipPosition(TourPlacement.Bottom, target, SHORT_VIEWPORT, TOOLTIP)
        // ceil = height (800) - bottomNav (72) - tooltip.height (180) = 548; bottom+gap (826) clamps to 548.
        assertEquals(548f, position.yDp, EPS)
    }

    // ── navigation branches (web currentStep gates) ──────────────────────────────────────────────────────────

    @Test
    fun firstStep_hidesBackAffordance() {
        assertTrue(isFirstStep(0))
        assertFalse(showBackAffordance(0))
        assertTrue(showBackAffordance(1))
    }

    @Test
    fun lastStep_isDetectedAndDropsForwardArrow() {
        assertTrue(isLastStep(3, totalSteps = 4))
        assertFalse(isLastStep(2, totalSteps = 4))
        assertFalse(showForwardArrow(3, totalSteps = 4))
        assertTrue(showForwardArrow(2, totalSteps = 4))
    }

    @Test
    fun stepNumber_isOneBased() {
        assertEquals(1, stepNumber(0))
        assertEquals(4, stepNumber(3))
    }

    // ── progress dots (web i === currentStep) ────────────────────────────────────────────────────────────────

    @Test
    fun dotState_isActiveOnlyOnCurrentStep() {
        assertEquals(TourDotState.Active, dotStateFor(index = 2, currentStep = 2))
        assertEquals(TourDotState.Inactive, dotStateFor(index = 1, currentStep = 2))
        assertEquals(TourDotState.Inactive, dotStateFor(index = 3, currentStep = 2))
    }

    // ── accessibility label (merged title + description) ─────────────────────────────────────────────────────

    @Test
    fun accessibilityLabel_joinsTitleAndDescription() {
        assertEquals("Battery. Track your pack health.", tourAccessibilityLabel("Battery", "Track your pack health."))
    }

    @Test
    fun accessibilityLabel_dropsBlankParts() {
        assertEquals("Battery", tourAccessibilityLabel("  Battery  ", "   "))
    }

    // ── cursor clamp ─────────────────────────────────────────────────────────────────────────────────────────

    @Test
    fun clampStep_keepsCursorInRange() {
        assertEquals(0, clampStep(-3, totalSteps = 4))
        assertEquals(3, clampStep(9, totalSteps = 4))
        assertEquals(2, clampStep(2, totalSteps = 4))
        assertEquals(0, clampStep(2, totalSteps = 0))
    }

    // ── surface classification (Hidden vs Visible, every branch) ─────────────────────────────────────────────

    @Test
    fun classify_nullTargetIsHidden() {
        assertTrue(classifyTour(target = null, step = STEP, currentStep = 0, totalSteps = 4) is TourSurface.Hidden)
    }

    @Test
    fun classify_firstStepVisibleWithoutBackAndWithArrow() {
        val surface = classifyTour(TARGET, STEP, currentStep = 0, totalSteps = 4)
        assertTrue(surface is TourSurface.Visible)
        surface as TourSurface.Visible
        assertEquals(1, surface.stepNumber)
        assertFalse(surface.showBack)
        assertFalse(surface.isLast)
        assertTrue(surface.showForwardArrow)
        // spotlight padded around the target.
        assertEquals(TARGET.leftDp - TOUR_SPOTLIGHT_PADDING_DP, surface.spotlight.leftDp, EPS)
    }

    @Test
    fun classify_middleStepVisibleWithBackAndArrow() {
        val surface = classifyTour(TARGET, STEP, currentStep = 1, totalSteps = 4) as TourSurface.Visible
        assertTrue(surface.showBack)
        assertFalse(surface.isLast)
        assertTrue(surface.showForwardArrow)
    }

    @Test
    fun classify_lastStepVisibleWithBackNoArrowAndFinish() {
        val surface = classifyTour(TARGET, STEP, currentStep = 3, totalSteps = 4) as TourSurface.Visible
        assertTrue(surface.showBack)
        assertTrue(surface.isLast)
        assertFalse(surface.showForwardArrow)
        assertEquals(4, surface.stepNumber)
    }

    @Test
    fun classify_clampsOutOfRangeCursorAndFloorsTotal() {
        val surface = classifyTour(TARGET, STEP, currentStep = 99, totalSteps = 0) as TourSurface.Visible
        assertEquals(1, surface.totalSteps)
        assertEquals(0, surface.currentStep)
        assertTrue(surface.isLast)
        assertFalse(surface.showBack)
    }

    // ── diagnostics (P1/S11): view.opened carries only the slug ──────────────────────────────────────────────

    @Test
    fun recordViewOpened_emitsViewOpenedWithSlugOnly() {
        val logger = RecordingLogger()
        TourOverlayDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.first()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "TourOverlay"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }

    private companion object {
        const val EPS = 0.001f

        // A viewport roomy enough that the clean per-placement anchor tests aren't pulled in by the edge clamp,
        // so each asserts the anchor formula in isolation (web clampLeft/clampTop are exercised separately).
        val VIEWPORT = TourViewport(widthDp = 1200f, heightDp = 1600f)

        // A short viewport that forces the bottom-nav vertical clamp (web `vh - bottomNav - tooltipHeight`).
        val SHORT_VIEWPORT = TourViewport(widthDp = 1200f, heightDp = 800f)
        val TOOLTIP = TourSize(widthDp = 300f, heightDp = 180f)
        val TARGET = TourTarget(leftDp = 60f, topDp = 200f, widthDp = 240f, heightDp = 56f)
        val STEP = TourStepContent(title = "Battery", description = "Track your pack health.", placement = TourPlacement.Bottom)
    }
}
