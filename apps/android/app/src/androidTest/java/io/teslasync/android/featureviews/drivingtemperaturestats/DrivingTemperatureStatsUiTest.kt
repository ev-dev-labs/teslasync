package io.teslasync.android.featureviews.drivingtemperaturestats

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [DrivingTemperatureStatsContent] across every
 * branch the web component renders (resolved six-card grid / loading skeleton / empty), plus the "single
 * absent reading" contract (a wholly-absent side renders the em-dash, never a blank card). Asserts the
 * rendered title, labels, values, and unit subtitles are exposed to TalkBack, that the loading grid carries
 * an accessible "Loading" announcement, and that no card label leaks while loading. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection.
 */
class DrivingTemperatureStatsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        DrivingTemperatureStatsStrings(
            title = "Temperature Stats",
            insideMin = "Inside Min",
            insideAvg = "Inside Avg",
            insideMax = "Inside Max",
            outsideMin = "Outside Min",
            outsideAvg = "Outside Avg",
            outsideMax = "Outside Max",
            noData = "No temperature stats",
            loadingLabel = "Loading",
        )

    private val resolved =
        DrivingTemperatureStatsDisplay(
            loading = false,
            hasData = true,
            unitLabel = "\u00B0C",
            insideMin = "18.5",
            insideAvg = "21.0",
            insideMax = "24.3",
            outsideMin = "9.1",
            outsideAvg = "14.6",
            outsideMax = "22.8",
        )

    private fun setContent(display: DrivingTemperatureStatsDisplay) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    DrivingTemperatureStatsContent(display = display, strings = strings)
                }
            }
        }
    }

    @Test
    fun contentShowsTitleEveryLabelValueAndUnit() {
        setContent(resolved)
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // Every card label is rendered (TalkBack reads each tile's label) — accessibility coverage.
        listOf(
            strings.insideMin,
            strings.insideAvg,
            strings.insideMax,
            strings.outsideMin,
            strings.outsideAvg,
            strings.outsideMax,
        ).forEach { compose.onNodeWithText(it).assertIsDisplayed() }
        // A sample of the formatted values, and the six unit subtitles (web `subtitle={tempUnit}`).
        compose.onNodeWithText("18.5").assertIsDisplayed()
        compose.onNodeWithText("22.8").assertIsDisplayed()
        compose.onAllNodesWithText("\u00B0C").assertCountEquals(6)
    }

    @Test
    fun loadingAnnouncesLoadingAndHidesCardLabels() {
        setContent(resolved.copy(loading = true))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        // The skeleton grid is announced as a single "Loading" region, not six empty boxes.
        compose.onNodeWithContentDescription(strings.loadingLabel).assertIsDisplayed()
        // No card label leaks while loading.
        compose.onNodeWithText(strings.insideMin).assertDoesNotExist()
    }

    @Test
    fun emptyShowsAccessibleNoDataMessage() {
        setContent(resolved.copy(hasData = false))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText(strings.noData).assertIsDisplayed()
        compose.onNodeWithText(strings.insideMin).assertDoesNotExist()
    }

    @Test
    fun absentReadingRendersDashesNeverBlankCards() {
        // A wholly-absent ambient reading: the three Outside cards show the em-dash and stay present (the
        // cards never collapse to a blank box), while the cabin cards still show their values.
        setContent(
            resolved.copy(
                outsideMin = EM_DASH,
                outsideAvg = EM_DASH,
                outsideMax = EM_DASH,
            ),
        )
        compose.onNodeWithText(strings.outsideMin).assertIsDisplayed()
        compose.onNodeWithText("18.5").assertIsDisplayed()
        compose.onAllNodesWithText(EM_DASH).assertCountEquals(3)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 400.dp
        val HOST_HEIGHT = 800.dp
    }
}
