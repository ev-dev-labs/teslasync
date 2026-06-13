package io.teslasync.android.sharedsurfaces.range

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [RangeContent] across every state the web component
 * renders plus the settings document's lifecycle: the formatted value + label, the ideal-range label, the
 * em-dash empty branch (web `meters == null`), the loading skeleton, the classified error + retry, and the
 * stale / offline freshness chips. Asserts the rendered i18n strings and the TalkBack content description on
 * the value region. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the logic, this
 * covers the render.
 */
class RangeUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        RangeStrings(
            ratedRange = "Rated Range",
            idealRange = "Ideal Range",
            noRange = "No range data",
            loadingLabel = "Loading",
            staleLabel = "Stale",
            offlineLabel = "Offline",
            title = "Range",
        )

    private fun setContent(
        display: RangeDisplay,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangeContent(display = display, strings = strings, onRetry = onRetry)
            }
        }
    }

    @Test
    fun contentShowsRatedLabelAndValue() {
        setContent(
            RangeDisplay(
                phase = RangePhase.Content,
                rangeType = PreferredRangeType.Rated,
                valueText = "300 km",
            ),
        )
        compose.onNodeWithText("Rated Range").assertIsDisplayed()
        compose.onNodeWithText("300 km").assertIsDisplayed()
    }

    @Test
    fun idealContentShowsIdealLabel() {
        setContent(
            RangeDisplay(
                phase = RangePhase.Content,
                rangeType = PreferredRangeType.Ideal,
                valueText = "186 mi",
            ),
        )
        compose.onNodeWithText("Ideal Range").assertIsDisplayed()
        compose.onNodeWithText("186 mi").assertIsDisplayed()
    }

    @Test
    fun emptyShowsEmDashAndNoRangeCaption() {
        setContent(RangeDisplay(phase = RangePhase.Empty, rangeType = PreferredRangeType.Rated))
        compose.onNodeWithText("\u2014").assertIsDisplayed()
        compose.onNodeWithText("No range data").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(RangeDisplay(phase = RangePhase.Loading, rangeType = PreferredRangeType.Rated))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            display =
                RangeDisplay(
                    phase = RangePhase.Error,
                    rangeType = PreferredRangeType.Rated,
                    errorKind = ErrorKind.Http,
                    httpStatus = 503,
                ),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleShowsStaleChip() {
        setContent(
            RangeDisplay(
                phase = RangePhase.Content,
                rangeType = PreferredRangeType.Rated,
                valueText = "300 km",
                stale = true,
            ),
        )
        compose.onNodeWithText("Stale").assertIsDisplayed()
        compose.onNodeWithText("300 km").assertIsDisplayed()
    }

    @Test
    fun offlineShowsOfflineChip() {
        setContent(
            RangeDisplay(
                phase = RangePhase.Content,
                rangeType = PreferredRangeType.Rated,
                valueText = "300 km",
                offline = true,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }

    @Test
    fun valueRegionExposesSpokenLabel() {
        setContent(
            RangeDisplay(
                phase = RangePhase.Content,
                rangeType = PreferredRangeType.Rated,
                valueText = "300 km",
            ),
        )
        compose.onNodeWithContentDescription("Rated Range: 300 km", substring = true).assertIsDisplayed()
    }
}
