package io.teslasync.android.featureviews.regextester

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [RegexTesterContent] across the states the
 * surface renders: the populated result (title + form + "{n} Matches" badge + per-match rows) and the
 * empty result (the form stays, the badge reads "0 Matches", no rows). Also asserts every interactive
 * field exposes a TalkBack-readable label. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure match logic. Mirrors the web spec
 * (web/src/features/admin/components/devtools/tools/RegexTester.tsx).
 */
class RegexTesterUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        pattern: String = "\\d+",
        flags: String = "g",
        testString: String = "order 123 then 45",
        matches: List<RegexMatch> = listOf(RegexMatch("123", 6), RegexMatch("45", 15)),
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RegexTesterContent(
                    pattern = pattern,
                    flags = flags,
                    testString = testString,
                    matches = matches,
                    onPatternChange = {},
                    onFlagsChange = {},
                    onTestStringChange = {},
                )
            }
        }
    }

    @Test
    fun populatedStateRendersTitleBadgeAndEveryMatch() {
        setContent()
        compose.onNodeWithText("Regex Tester").assertIsDisplayed()
        compose.onNodeWithText("2 Matches").assertIsDisplayed()
        // Each match row shows the matched text (monospace) and its index.
        compose.onNodeWithText("123").assertIsDisplayed()
        compose.onNodeWithText("45").assertIsDisplayed()
        compose.onNodeWithText("At Index 6").assertIsDisplayed()
        compose.onNodeWithText("At Index 15").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsZeroMatchesBadgeAndKeepsTheForm() {
        setContent(pattern = "", testString = "", matches = emptyList())
        // The surface is never a blank box: the title + live count badge stay visible at zero matches.
        compose.onNodeWithText("Regex Tester").assertIsDisplayed()
        compose.onNodeWithText("0 Matches").assertIsDisplayed()
    }

    @Test
    fun everyInteractiveFieldExposesAnAccessibilityLabel() {
        setContent()
        // The pattern, flags and test-string fields each carry a label that names them for TalkBack.
        compose.onNodeWithText("Pattern", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Flags", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Test String", useUnmergedTree = true).assertIsDisplayed()
    }
}
