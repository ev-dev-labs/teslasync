package io.teslasync.android.dashboardwidgets.chargecosttracker

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
 * Instrumented Compose tests for the Charge Cost Tracker surface: each state from the web source
 * (content / empty / error / stale + the compact big-number layout) renders its copy on a device,
 * every interactive element exposes an accessible name (refresh + retry), and the compact layout
 * announces the headline cost to TalkBack. The framework-free logic is covered by the no-device
 * [ChargeCostTrackerWidgetTest]; this is the connectedAndroidTest surface gate.
 */
class ChargeCostTrackerWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val prefs = ChargeCostPrefs.DEFAULT

    private val metrics =
        ChargeCostMetrics(
            totalKwh = 312.5,
            totalCost = 37.5,
            costPerDistance = 0.034,
            gasSavings = 42.5,
            sessionCount = 12,
            totalDistanceMi = 1093.75,
        )

    @Test
    fun contentStandardShowsTitleAndEveryTileLabel() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeCostTrackerWidget(
                    state = UiState(phase = UiPhase.Content, data = metrics, fetchedAt = 1L),
                    prefs = prefs,
                    size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithText("Charge Cost Tracker").assertIsDisplayed()
        rule.onNodeWithText("Total Energy").assertIsDisplayed()
        rule.onNodeWithText("Total Cost").assertIsDisplayed()
        rule.onNodeWithText("Cost / km").assertIsDisplayed()
        rule.onNodeWithText("vs Gas Savings").assertIsDisplayed()
    }

    @Test
    fun contentExposesRefreshAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeCostTrackerWidget(
                    state = UiState(phase = UiPhase.Content, data = metrics, fetchedAt = 1L),
                    prefs = prefs,
                    size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeCostTrackerWidget(
                    state = UiState(phase = UiPhase.Empty, data = ChargeCostMetrics.EMPTY, fetchedAt = 1L),
                    prefs = prefs,
                    size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithText("No charge data").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresRefresh() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                ChargeCostTrackerWidget(
                    state = UiState<ChargeCostMetrics>(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    prefs = prefs,
                    size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
                    onRetry = { retried = true },
                )
            }
        }

        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleContentStillRendersTiles() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeCostTrackerWidget(
                    state = UiState(phase = UiPhase.Content, data = metrics, fetchedAt = 1L, stale = true),
                    prefs = prefs,
                    size = ChargeCostTrackerRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithText("Total Cost").assertIsDisplayed()
    }

    @Test
    fun compactLayoutAnnouncesCostForTalkback() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeCostTrackerWidget(
                    state = UiState(phase = UiPhase.Content, data = metrics, fetchedAt = 1L),
                    prefs = prefs,
                    size = ChargeCostTrackerSize(cols = 1, rows = 1),
                )
            }
        }

        rule.onNodeWithContentDescription("30-day cost", substring = true).assertIsDisplayed()
    }
}
