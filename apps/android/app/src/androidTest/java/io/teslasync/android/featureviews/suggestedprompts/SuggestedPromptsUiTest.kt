package io.teslasync.android.featureviews.suggestedprompts

import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [SuggestedPromptsContent] across the states the surface
 * renders: the populated four-chip strip (the web `getChatSuggestions().map(...)`), the pick callback each chip
 * fires (web `onClick={() => onPick(text)}`), the per-chip accessibility (every chip is a focusable button with
 * a click action + its suggestion text as its accessible name), the strip's accessible region label (web
 * `<ul aria-label>`), and the defensive empty state (never a blank box). The offline gate's `testReleaseUnitTest`
 * covers the pure catalogue + diagnostics; this covers render + a11y. Mirrors the web spec
 * (web/src/features/system/components/chatbot/SuggestedPrompts.tsx).
 */
class SuggestedPromptsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val fleetYesterday = "What did my fleet do yesterday?"
    private val chargingCost30d = "Charging cost last 30 days"
    private val socDropping = "Why is my SoC dropping faster this week?"
    private val efficientDrive = "Show me the most efficient drive this month"
    private val regionLabel = "Suggested prompts"
    private val noData = "No data available"

    private fun setContent(
        suggestions: List<ChatSuggestion> = SuggestedPromptsProjection.suggestions,
        onPick: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SuggestedPromptsContent(onPick = onPick, suggestions = suggestions)
            }
        }
    }

    @Test
    fun contentRendersAllFourSuggestionChips() {
        setContent()
        compose.onNodeWithText(fleetYesterday).assertIsDisplayed()
        compose.onNodeWithText(chargingCost30d).assertIsDisplayed()
        compose.onNodeWithText(socDropping).assertIsDisplayed()
        compose.onNodeWithText(efficientDrive).assertIsDisplayed()
    }

    @Test
    fun tappingChipsInvokesOnPickWithTheChipText() {
        val picked = mutableListOf<String>()
        setContent(onPick = { picked += it })

        compose.onNodeWithText(fleetYesterday).performClick()
        compose.onNodeWithText(chargingCost30d).performClick()
        compose.onNodeWithText(socDropping).performClick()
        compose.onNodeWithText(efficientDrive).performClick()

        assertEquals(
            listOf(fleetYesterday, chargingCost30d, socDropping, efficientDrive),
            picked,
        )
    }

    @Test
    fun everyChipIsAnAccessibleButtonWithAClickAction() {
        setContent()
        // Each chip is a focusable button carrying its suggestion text + a click action (web ghost `<Button>`).
        compose.onNodeWithText(fleetYesterday).assertHasClickAction()
        compose.onNodeWithText(chargingCost30d).assertHasClickAction()
        compose.onNodeWithText(socDropping).assertHasClickAction()
        compose.onNodeWithText(efficientDrive).assertHasClickAction()
    }

    @Test
    fun stripExposesItsAccessibleRegionLabel() {
        setContent()
        // Web `<ul aria-label="Suggested prompts">` → the strip container's accessible name.
        compose.onNodeWithContentDescription(regionLabel, useUnmergedTree = true).assertExists()
    }

    @Test
    fun emptyShowsFriendlyNoDataMessageNotABlankBox() {
        setContent(suggestions = emptyList())
        compose.onNodeWithText(noData).assertIsDisplayed()
    }
}
