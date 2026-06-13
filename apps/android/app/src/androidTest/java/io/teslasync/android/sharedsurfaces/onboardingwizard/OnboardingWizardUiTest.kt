package io.teslasync.android.sharedsurfaces.onboardingwizard

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [OnboardingWizardCard] across every branch the web
 * component renders (web/src/components/feedback/OnboardingWizard.tsx): the four ordered steps, the progress-dot
 * counter, the centered hero, and the Next-vs-Get-Started advance branch with the Skip / close affordances.
 * Asserts the localized step copy, the merged TalkBack announcement, the dot counter, and the labelled, clickable
 * Skip / Next / close controls. Also covers the one-shot PII-safe `view.opened` diagnostic on the stateful
 * [OnboardingWizard]. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure
 * [classifyStep] + diagnostics logic.
 */
class OnboardingWizardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun str(id: Int): String = context.getString(id)

    // ── The first step renders the hero, the dot counter, Skip, and Next (not Get Started) ────────────

    @Test
    fun firstStepRendersHeroDotsAndForwardActions() {
        var advanced = false
        var dismissed = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OnboardingWizardCard(stepIndex = 0, onAdvance = { advanced = true }, onDismiss = { dismissed = true })
            }
        }

        compose.onNodeWithText(str(R.string.translation_onboarding_welcome), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(str(R.string.translation_onboarding_desc), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("1 / 4").assertIsDisplayed()

        // Get Started is absent until the final step.
        compose.onAllNodesWithText(str(R.string.translation_tour_finish), useUnmergedTree = true).assertCountEquals(0)

        val next = compose.onNodeWithText(str(R.string.translation_tour_next), useUnmergedTree = true)
        next.assertIsDisplayed().assertHasClickAction()
        next.performClick()
        assertTrue(advanced)

        val skip = compose.onNodeWithText(str(R.string.translation_tour_skip), useUnmergedTree = true)
        skip.assertHasClickAction()
        skip.performClick()
        assertTrue(dismissed)
    }

    // ── The close affordance dismisses (web backdrop / X) ─────────────────────────────────────────────

    @Test
    fun closeAffordanceDismissesTheWizard() {
        var dismissed = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OnboardingWizardCard(stepIndex = 0, onAdvance = {}, onDismiss = { dismissed = true })
            }
        }

        val close = compose.onNodeWithContentDescription(str(R.string.translation_a11y_closeDialog))
        close.assertIsDisplayed().assertHasClickAction()
        close.performClick()
        assertTrue(dismissed)
    }

    // ── Each ordered step renders its localized copy ──────────────────────────────────────────────────

    @Test
    fun connectStepRendersTeslaCopy() {
        setCard(stepIndex = 1)
        compose.onNodeWithText(str(R.string.translation_onboarding_tesla_title), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("2 / 4").assertIsDisplayed()
    }

    @Test
    fun configureStepRendersSettingsCopy() {
        setCard(stepIndex = 2)
        compose
            .onNodeWithText(str(R.string.translation_tour_tours_settings_title), useUnmergedTree = true)
            .assertIsDisplayed()
        compose.onNodeWithContentDescription("3 / 4").assertIsDisplayed()
    }

    // ── The final step swaps Next for Get Started (web `currentStep === steps.length - 1`) ────────────

    @Test
    fun finalStepShowsGetStartedInsteadOfNext() {
        var advanced = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OnboardingWizardCard(stepIndex = 3, onAdvance = { advanced = true }, onDismiss = {})
            }
        }

        compose.onNodeWithText(str(R.string.translation_onboarding_ready), useUnmergedTree = true).assertIsDisplayed()
        compose.onAllNodesWithText(str(R.string.translation_tour_next), useUnmergedTree = true).assertCountEquals(0)

        val finish = compose.onNodeWithText(str(R.string.translation_tour_finish), useUnmergedTree = true)
        finish.assertIsDisplayed().assertHasClickAction()
        finish.performClick()
        assertTrue(advanced)
    }

    // ── Accessibility: the hero exposes the title + description as one merged announcement ────────────

    @Test
    fun heroExposesAMergedSpokenLabel() {
        setCard(stepIndex = 2)
        val expected =
            stepAccessibilityLabel(
                str(R.string.translation_tour_tours_settings_title),
                str(R.string.translation_tour_tours_settings_description),
            )
        compose.onNodeWithContentDescription(expected).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) on the stateful surface ───────────────

    @Test
    fun mountingTheStatefulWizardEmitsViewOpenedOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OnboardingWizard(logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "OnboardingWizard"), fields)
    }

    private fun setCard(stepIndex: Int) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OnboardingWizardCard(stepIndex = stepIndex, onAdvance = {}, onDismiss = {})
            }
        }
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
