package io.teslasync.android.dashboardwidgets.speedprofile

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the Speed Profile surface: each state from the web source (content /
 * empty / error / stale + the compact summary layout) renders its copy on a device, the summary-stat
 * cells expose accessible labels, the refresh + retry controls expose accessible names, and the compact
 * layout drops the Peak Freq chip. The framework-free logic is covered by the no-device
 * [SpeedProfileWidgetTest]; this is the connectedAndroidTest surface gate.
 */
class SpeedProfileWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val prefs = SpeedProfilePrefs.DEFAULT
    private val standard = SpeedProfileRegistration.DEFAULT_SIZE
    private val compact = SpeedProfileSize(cols = 1, rows = 4)

    private val snapshot =
        SpeedProfileSnapshot(
            distribution =
                listOf(
                    SpeedProfileBucket("0-15", 30, 0.0),
                    SpeedProfileBucket("15-30", 70, 0.0),
                ),
            optimalSpeedMps = 13.4,
        )

    @Test
    fun loadingShowsSkeletonAndNoCopy() {
        rule.setContent {
            TeslaSyncTheme {
                SpeedProfileWidget(state = UiState.loading(), prefs = prefs, size = standard)
            }
        }
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
        rule.onNodeWithText("No speed data").assertDoesNotExist()
    }

    @Test
    fun standardContentShowsTitleAndEveryStatLabel() {
        rule.setContent {
            TeslaSyncTheme {
                SpeedProfileWidget(
                    state = UiState(phase = UiPhase.Content, data = snapshot, fetchedAt = 1L),
                    prefs = prefs,
                    size = standard,
                )
            }
        }
        rule.onNodeWithText("Speed Profile").assertIsDisplayed()
        rule.onNodeWithContentDescription("Most Common", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Peak Freq", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Sweet Spot", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentExposesRefreshAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                SpeedProfileWidget(
                    state = UiState(phase = UiPhase.Content, data = snapshot, fetchedAt = 1L),
                    prefs = prefs,
                    size = standard,
                )
            }
        }
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                SpeedProfileWidget(
                    state = UiState(phase = UiPhase.Empty, data = SpeedProfileSnapshot.EMPTY, fetchedAt = 1L),
                    prefs = prefs,
                    size = standard,
                )
            }
        }
        rule.onNodeWithText("No speed data").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                SpeedProfileWidget(
                    state = UiState<SpeedProfileSnapshot>(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                    prefs = prefs,
                    size = standard,
                    onRetry = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleContentStillRendersStats() {
        rule.setContent {
            TeslaSyncTheme {
                SpeedProfileWidget(
                    state = UiState(phase = UiPhase.Content, data = snapshot, fetchedAt = 1L, stale = true),
                    prefs = prefs,
                    size = standard,
                )
            }
        }
        rule.onNodeWithContentDescription("Sweet Spot", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactShowsSummaryStatsWithoutPeakFreq() {
        rule.setContent {
            TeslaSyncTheme {
                SpeedProfileWidget(
                    state = UiState(phase = UiPhase.Content, data = snapshot, fetchedAt = 1L),
                    prefs = prefs,
                    size = compact,
                )
            }
        }
        rule.onNodeWithContentDescription("Most Common", substring = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("Sweet Spot", substring = true).assertIsDisplayed()
        // Compact drops the Peak Freq chip (web compact WidgetChartSummary shows Most Common + Sweet Spot).
        rule.onNodeWithContentDescription("Peak Freq", substring = true).assertDoesNotExist()
    }

    @Test
    fun statCellExposesAccessibleLabel() {
        rule.setContent {
            TeslaSyncTheme {
                SpeedProfileWidget(
                    state = UiState(phase = UiPhase.Content, data = snapshot, fetchedAt = 1L),
                    prefs = prefs,
                    size = standard,
                )
            }
        }
        rule.onNodeWithContentDescription("Most Common:", substring = true).assertIsDisplayed()
    }
}
