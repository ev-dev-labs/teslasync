package io.teslasync.android.sharedsurfaces.onboardingwizard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the OnboardingWizard's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/feedback/OnboardingWizard.tsx): the ordered step taxonomy, the cursor clamp,
 * forward navigation, the Next-vs-Get-Started advance branch, and the merged TalkBack announcement. Because the
 * composable is a thin render layer over [classifyStep], the per-step assertions here double as the surface's
 * per-state snapshot. Runs in the :app:testReleaseUnitTest gate.
 */
class OnboardingWizardModelTest {
    // ── step taxonomy (web `steps` array) ─────────────────────────────────────────────────────────────

    @Test
    fun stepCountAndAccentOrderMirrorTheWebStepsArray() {
        assertEquals(4, ONBOARDING_WIZARD_STEP_COUNT)
        assertEquals(ONBOARDING_WIZARD_STEP_COUNT, onboardingStepAccents.size)
        assertEquals(
            listOf(
                OnboardingStepAccent.Welcome,
                OnboardingStepAccent.Connect,
                OnboardingStepAccent.Configure,
                OnboardingStepAccent.Ready,
            ),
            onboardingStepAccents,
        )
    }

    // ── clampStepIndex: a stale saved cursor can never index out of bounds ────────────────────────────

    @Test
    fun clampStepIndexKeepsTheCursorInRange() {
        assertEquals(0, clampStepIndex(-3))
        assertEquals(0, clampStepIndex(0))
        assertEquals(2, clampStepIndex(2))
        assertEquals(3, clampStepIndex(3))
        assertEquals(3, clampStepIndex(99))
        assertEquals(0, clampStepIndex(1, total = 0))
    }

    // ── nextStepIndex: forward-only walk that stops at the final step ─────────────────────────────────

    @Test
    fun nextStepIndexAdvancesAndClampsAtTheLastStep() {
        assertEquals(1, nextStepIndex(0))
        assertEquals(2, nextStepIndex(1))
        assertEquals(3, nextStepIndex(2))
        assertEquals(3, nextStepIndex(3))
        assertEquals(3, nextStepIndex(99))
    }

    // ── classifyStep: the per-state snapshot (every ordered step) ─────────────────────────────────────

    @Test
    fun classifyStepProjectsEachOrderedStep() {
        val welcome = classifyStep(0)
        assertEquals(0, welcome.stepIndex)
        assertEquals(OnboardingStepAccent.Welcome, welcome.accent)
        assertEquals(1, welcome.stepNumber)
        assertEquals(4, welcome.stepTotal)
        assertFalse(welcome.isLast)

        assertEquals(OnboardingStepAccent.Connect, classifyStep(1).accent)
        assertEquals(OnboardingStepAccent.Configure, classifyStep(2).accent)

        val ready = classifyStep(3)
        assertEquals(OnboardingStepAccent.Ready, ready.accent)
        assertEquals(4, ready.stepNumber)
        assertTrue("the final step shows Get Started, not Next", ready.isLast)
    }

    @Test
    fun classifyStepClampsAnOutOfRangeCursor() {
        assertEquals(0, classifyStep(-5).stepIndex)
        assertEquals(OnboardingStepAccent.Welcome, classifyStep(-5).accent)
        assertEquals(3, classifyStep(42).stepIndex)
        assertTrue(classifyStep(42).isLast)
    }

    @Test
    fun isLastStepIsTrueOnlyForTheFinalStep() {
        assertFalse(isLastStep(0))
        assertFalse(isLastStep(2))
        assertTrue(isLastStep(3))
        assertTrue("an over-range cursor clamps onto the final step", isLastStep(99))
    }

    // ── accessibility label (merged TalkBack announcement) ────────────────────────────────────────────

    @Test
    fun accessibilityLabelMergesTitleAndDescription() {
        assertEquals(
            "Welcome to TeslaSync. Your fleet dashboard.",
            stepAccessibilityLabel("Welcome to TeslaSync", "Your fleet dashboard."),
        )
    }

    @Test
    fun accessibilityLabelSkipsABlankPart() {
        assertEquals("Body only", stepAccessibilityLabel("   ", "Body only"))
        assertEquals("Title only", stepAccessibilityLabel("Title only", "  "))
        assertEquals("", stepAccessibilityLabel("  ", "  "))
    }
}
