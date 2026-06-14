// Instrumented Compose UI + accessibility verification of [WidgetTipCardsContent] across the branches the
// web WidgetTipCards renders: the empty fallback (the localized "No recommendations" message + its content
// description — never a blank box, with an optional caller override), and the cards branch (each tip's
// title, description, and optional impact badge). The compact slice (web `tips.slice(0, 1)`) is exercised
// end-to-end via the pure layout feeding the content. Runs under `connectedAndroidTest` (a device/emulator);
// the offline gate's `testReleaseUnitTest` covers the pure model + diagnostics.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgettipcards

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class WidgetTipCardsUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun emptyContentShowsTheLocalizedNoRecommendationsMessage() {
        setContent { WidgetTipCardsContent(tips = emptyList(), emptyIcon = TeslaGlyphs.Info) }
        // The en catalog value for translation_widget_chargingOptimizer_noRecommendations — never a blank box.
        compose.onNodeWithText(NO_RECOMMENDATIONS, useUnmergedTree = true).assertIsDisplayed()
        // The shared EmptyState exposes the message as a TalkBack content description (a11y label).
        compose.onNodeWithContentDescription(NO_RECOMMENDATIONS).assertIsDisplayed()
    }

    @Test
    fun emptyContentHonoursACallerOverrideMessage() {
        setContent { WidgetTipCardsContent(tips = emptyList(), emptyMessage = NO_ANOMALIES) }
        compose.onNodeWithText(NO_ANOMALIES, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(NO_ANOMALIES).assertIsDisplayed()
    }

    @Test
    fun cardsRenderEachTitleAndDescription() {
        setContent { WidgetTipCardsContent(tips = TIPS) }
        compose.onNodeWithText(TITLE_ONE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(DESCRIPTION_ONE, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(TITLE_TWO, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(DESCRIPTION_TWO, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun cardsRenderTheImpactBadgeLabelAsAnAccessibleNode() {
        setContent { WidgetTipCardsContent(tips = TIPS) }
        // The badge label is a spoken Text node (a11y), exactly as the web `<Badge>{impactLabel}</Badge>`.
        compose.onNodeWithText(LABEL_HIGH, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(LABEL_LOW, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun everyTipRendersItsOwnCard() {
        setContent { WidgetTipCardsContent(tips = TIPS) }
        compose.onAllNodesWithTag(WIDGET_TIP_CARD_TEST_TAG).assertCountEquals(TIPS.size)
    }

    @Test
    fun compactSliceRendersOnlyTheFirstCard() {
        val visible = WidgetTipCardsLayout.visible(TIPS, maxTips = null, compact = true)
        setContent { WidgetTipCardsContent(tips = visible, compact = true) }
        compose.onAllNodesWithTag(WIDGET_TIP_CARD_TEST_TAG).assertCountEquals(COMPACT_CARDS)
        compose.onNodeWithText(TITLE_ONE, useUnmergedTree = true).assertIsDisplayed()
        // The dropped tips (web `tips.slice(0, 1)`) must not be rendered.
        compose.onNodeWithText(TITLE_TWO, useUnmergedTree = true).assertDoesNotExist()
    }

    private fun setContent(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) {
                    content()
                }
            }
        }
    }

    private companion object {
        // en catalog value resolved on-device (translation_widget_chargingOptimizer_noRecommendations).
        const val NO_RECOMMENDATIONS = "No recommendations"
        const val NO_ANOMALIES = "No anomalies"

        const val TITLE_ONE = "Charge to 80% on weekdays"
        const val DESCRIPTION_ONE = "Capping the daily charge limit slows calendar ageing."
        const val TITLE_TWO = "Shift charging to off-peak hours"
        const val DESCRIPTION_TWO = "An overnight schedule cuts cost during peak pricing."
        const val TITLE_THREE = "Precondition while plugged in"
        const val DESCRIPTION_THREE = "Warming on shore power preserves range on cold mornings."
        const val LABEL_HIGH = "High"
        const val LABEL_LOW = "Low"
        const val COMPACT_CARDS = 1

        val TIPS =
            listOf(
                TipItem(
                    id = "1",
                    title = TITLE_ONE,
                    description = DESCRIPTION_ONE,
                    icon = TeslaGlyphs.Info,
                    impact = TipImpact.High,
                    impactLabel = LABEL_HIGH,
                ),
                TipItem(
                    id = "2",
                    title = TITLE_TWO,
                    description = DESCRIPTION_TWO,
                    icon = TeslaGlyphs.Info,
                    impact = TipImpact.Low,
                    impactLabel = LABEL_LOW,
                ),
                TipItem(
                    id = "3",
                    title = TITLE_THREE,
                    description = DESCRIPTION_THREE,
                ),
            )

        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 600.dp
    }
}
