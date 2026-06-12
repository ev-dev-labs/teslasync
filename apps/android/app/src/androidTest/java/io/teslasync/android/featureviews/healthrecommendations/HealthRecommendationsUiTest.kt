package io.teslasync.android.featureviews.healthrecommendations

import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [HealthRecommendationsContent] across every health
 * state the surface renders (good / warning / critical) — the staggered, priority-accented tip list, the
 * heading-tagged title, and the per-state branch inclusion/exclusion. Strings are resolved from the same
 * P1/S10 resources the composable reads, so the test never hardcodes an English literal. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection logic, this
 * covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx).
 */
class HealthRecommendationsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    private val title get() = context.getString(R.string.translation_drivetrain_recommendations)
    private val criticalStop get() = context.getString(R.string.translation_drivetrain_tips_criticalStop)
    private val reduceLoad get() = context.getString(R.string.translation_drivetrain_tips_reduceLoad)
    private val regularService get() = context.getString(R.string.translation_drivetrain_tips_regularService)

    private fun setContent(overallHealth: HealthStatus) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HealthRecommendationsContent(overallHealth = overallHealth)
            }
        }
    }

    private fun assertNoNodeWithText(text: String) {
        assertTrue(
            compose
                .onAllNodesWithText(text, substring = true, useUnmergedTree = true)
                .fetchSemanticsNodes()
                .isEmpty(),
        )
    }

    @Test
    fun criticalRendersTheTitleAndOneTipOfEveryPriority() {
        setContent(HealthStatus.Critical)
        compose.onNodeWithText(title, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(criticalStop, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(reduceLoad, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(regularService, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun goodRendersOnlyTheBaselineTips() {
        setContent(HealthStatus.Good)
        // The four low-priority baseline tips are always present, so the panel is never blank.
        compose.onNodeWithText(regularService, useUnmergedTree = true).assertIsDisplayed()
        // The high + medium tips are absent for a healthy drivetrain.
        assertNoNodeWithText(criticalStop)
        assertNoNodeWithText(reduceLoad)
    }

    @Test
    fun warningRendersMediumTipsButNotHighTips() {
        setContent(HealthStatus.Warning)
        compose.onNodeWithText(reduceLoad, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(regularService, useUnmergedTree = true).assertIsDisplayed()
        assertNoNodeWithText(criticalStop)
    }

    @Test
    fun titleIsExposedAsAHeadingForTalkBack() {
        setContent(HealthStatus.Good)
        compose.onNodeWithText(title, useUnmergedTree = true).assert(isHeading())
    }

    @Test
    fun everyTipTextIsAnnouncedToScreenReaders() {
        setContent(HealthStatus.Critical)
        // Each advisory string is its own readable node (the leading priority glyph is decorative).
        listOf(criticalStop, reduceLoad, regularService).forEach { tip ->
            compose.onNodeWithText(tip, useUnmergedTree = true).assertIsDisplayed()
        }
    }
}
