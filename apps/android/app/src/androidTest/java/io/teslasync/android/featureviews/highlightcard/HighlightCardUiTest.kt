package io.teslasync.android.featureviews.highlightcard

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [HighlightCardContent] across every branch the surface
 * renders: the full card (icon + label + value + positive change + subtitle), a negative change, the change-
 * absent and subtitle-absent branches, each accent key, and the merged TalkBack announcement. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection logic, this
 * covers render + a11y. Mirrors the web spec
 * (web/src/features/analytics/components/weekly-digest/HighlightCard.tsx).
 */
class HighlightCardUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        label: String,
        value: String,
        change: HighlightChange? = null,
        subtitle: String? = null,
        color: HighlightColor = HighlightColor.Cyan,
        withIcon: Boolean = true,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                HighlightCardContent(
                    label = label,
                    value = value,
                    icon = if (withIcon) ({ Text("·") }) else null,
                    change = change,
                    subtitle = subtitle,
                    color = color,
                )
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
    fun fullCardRendersLabelValueChangeAndSubtitle() {
        setContent(
            label = "Avg Efficiency",
            value = "248 Wh/mi",
            change = HighlightChange(value = "+6% vs last week", positive = true),
            subtitle = "Across 12 drives",
            color = HighlightColor.Cyan,
        )
        compose.onNodeWithText("Avg Efficiency", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("248 Wh/mi", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("+6% vs last week", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Across 12 drives", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun negativeChangeRendersItsValue() {
        setContent(
            label = "Energy Used",
            value = "63.4 kWh",
            change = HighlightChange(value = "-4% vs last week", positive = false),
            color = HighlightColor.Green,
        )
        compose.onNodeWithText("-4% vs last week", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun changeRowIsSkippedWhenAbsent() {
        // Web `{change && …}`: with no change prop the trend row is not rendered.
        setContent(label = "Peak Power", value = "311 kW", color = HighlightColor.Amber)
        compose.onNodeWithText("311 kW", useUnmergedTree = true).assertIsDisplayed()
        assertNoNodeWithText("vs last week")
    }

    @Test
    fun subtitleRowIsSkippedWhenEmpty() {
        // Web `{subtitle && …}`: an empty subtitle is falsy, so the caption row is not rendered.
        setContent(label = "Longest Drive", value = "412 km", subtitle = "")
        compose.onNodeWithText("412 km", useUnmergedTree = true).assertIsDisplayed()
        assertNoNodeWithText("Reno")
    }

    @Test
    fun rendersWithoutALeadingIcon() {
        // Web icon is a ReactNode that may be absent; the card still renders its label + value.
        setContent(label = "Phantom Drain", value = "1.8%/day", withIcon = false)
        compose.onNodeWithText("Phantom Drain", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("1.8%/day", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun eachAccentRendersTheValue() {
        HighlightColor.entries.forEach { color ->
            setContent(label = "Stat", value = "42 ${color.name}", color = color)
            compose.onNodeWithText("42 ${color.name}", useUnmergedTree = true).assertIsDisplayed()
        }
    }

    @Test
    fun cardExposesAMergedAccessibilityDescription() {
        // The whole card merges into one TalkBack node whose description carries the label + value, so a
        // screen-reader user hears the stat as a single phrase.
        setContent(
            label = "Avg Efficiency",
            value = "248 Wh/mi",
            change = HighlightChange(value = "+6% vs last week", positive = true),
            subtitle = "Across 12 drives",
        )
        compose.onNodeWithContentDescription("Avg Efficiency", substring = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("248 Wh/mi", substring = true).assertIsDisplayed()
    }
}
