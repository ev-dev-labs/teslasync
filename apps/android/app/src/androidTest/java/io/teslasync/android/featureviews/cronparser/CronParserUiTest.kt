package io.teslasync.android.featureviews.cronparser

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [CronParserContent] across every state the surface
 * renders: the empty/idle input (just the card, field, and presets), an invalid expression (the conditional
 * blocks stay hidden), and a valid expression (description + next-runs appear). Also verifies a preset tap
 * fills the field and that the interactive controls expose accessible labels. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure logic, this covers render
 * + a11y. Mirrors the web spec (web/src/features/admin/components/devtools/tools/CronParser.tsx).
 */
class CronParserUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        CronParserStrings(
            title = "Cron Parser",
            toolDescription = "Cron Parser Desc",
            expressionLabel = "Cron Expression",
            descriptionLabel = "Description",
            nextRunsLabel = "Next Runs",
            everyMinute = "Every Minute",
            everyHour = "Every Hour",
            everyDay = "Every Day",
            everyWeek = "Every Week",
            everyMonth = "Every Month",
        )

    private fun setContent(initialExpression: String = "") {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CronParserContent(
                    strings = strings,
                    locale = Locale.US,
                    zoneId = ZoneId.of("UTC"),
                    initialExpression = initialExpression,
                )
            }
        }
    }

    @Test
    fun emptyStateShowsCardFieldAndPresetsButNoConditionalBlocks() {
        setContent(initialExpression = "")
        compose.onNodeWithText("Cron Parser").assertIsDisplayed()
        compose.onNodeWithText("Cron Expression").assertIsDisplayed()
        compose.onNodeWithText("Every Minute").assertIsDisplayed()
        compose.onNodeWithText("Every Month").assertIsDisplayed()
        compose.onNodeWithText("Next Runs").assertDoesNotExist()
    }

    @Test
    fun invalidExpressionKeepsConditionalBlocksHidden() {
        setContent(initialExpression = "* * *")
        compose.onNodeWithText("Cron Parser").assertIsDisplayed()
        compose.onNodeWithText("Next Runs").assertDoesNotExist()
    }

    @Test
    fun validExpressionShowsDescriptionAndNextRuns() {
        setContent(initialExpression = "30 14 * * *")
        compose.onNodeWithText("At 14:30").assertIsDisplayed()
        compose.onNodeWithText("Description").assertIsDisplayed()
        compose.onNodeWithText("Next Runs").assertIsDisplayed()
    }

    @Test
    fun tappingAPresetFillsTheExpressionAndDescribesIt() {
        setContent(initialExpression = "")
        compose.onNodeWithText("Every Day").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("0 0 * * *").assertIsDisplayed()
        compose.onNodeWithText("At 00:00").assertIsDisplayed()
        compose.onNodeWithText("Next Runs").assertIsDisplayed()
    }

    @Test
    fun interactiveControlsExposeAccessibleLabels() {
        setContent(initialExpression = "")
        // The expression field's label and every preset button carry a discoverable accessible name.
        compose.onNodeWithText("Cron Expression").assertIsDisplayed()
        compose.onNodeWithText("Every Minute").assertIsDisplayed()
        compose.onNodeWithText("Every Hour").assertIsDisplayed()
        compose.onNodeWithText("Every Day").assertIsDisplayed()
        compose.onNodeWithText("Every Week").assertIsDisplayed()
        compose.onNodeWithText("Every Month").assertIsDisplayed()
    }
}
