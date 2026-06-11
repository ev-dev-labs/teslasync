package io.teslasync.android.dashboardwidgets

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the Battery Analytics surface: each state from the web source
 * (content / empty / error / stale) renders its copy on a device, every interactive element exposes
 * an accessible name (refresh + retry), the standard layout shows every stat label, and the compact
 * layout announces the state-of-health gauge to TalkBack. The framework-free logic is covered by the
 * no-device [BatteryHealthAnalyticsWidgetTest]; this is the connectedAndroidTest surface gate.
 */
class BatteryHealthAnalyticsWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun contentStandardShowsTitleAndEveryStatLabel() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryHealthAnalyticsWidget(
                    state = UiState(phase = UiPhase.Content, data = fullJson(), fetchedAt = 1L),
                    span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }

        rule.onNodeWithText("Battery Analytics").assertIsDisplayed()
        rule.onNodeWithText("Cycles").assertIsDisplayed()
        rule.onNodeWithText("Charge Depth").assertIsDisplayed()
        rule.onNodeWithText("Discharge").assertIsDisplayed()
        rule.onNodeWithText("DC Fast").assertIsDisplayed()
        rule.onNodeWithText("Temp Score").assertIsDisplayed()
        rule.onNodeWithText("Habits").assertIsDisplayed()
    }

    @Test
    fun contentExposesRefreshAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryHealthAnalyticsWidget(
                    state = UiState(phase = UiPhase.Content, data = fullJson(), fetchedAt = 1L),
                    span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }

        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryHealthAnalyticsWidget(
                    state = UiState(phase = UiPhase.Empty, data = JsonNull),
                    span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }

        rule.onNodeWithText("No battery health data").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresRetry() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                BatteryHealthAnalyticsWidget(
                    state = UiState<JsonElement>(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
                    onRefresh = {},
                    onRetry = { retried = true },
                )
            }
        }

        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleContentStillRendersData() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryHealthAnalyticsWidget(
                    state = UiState(phase = UiPhase.Content, data = fullJson(), fetchedAt = 1L, stale = true),
                    span = BatteryHealthAnalyticsWidgetSpec.defaultSpan,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }

        rule.onNodeWithText("Cycles").assertIsDisplayed()
    }

    @Test
    fun compactLayoutAnnouncesHealthGaugeForTalkback() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryHealthAnalyticsWidget(
                    state = UiState(phase = UiPhase.Content, data = fullJson(), fetchedAt = 1L),
                    span = BatteryHealthSpan(cols = 1, rows = 2),
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }

        rule.onNodeWithContentDescription("health", substring = true).assertIsDisplayed()
    }

    private fun fullJson(): JsonElement =
        buildJsonObject {
            put("current_soh", 92.0)
            put("total_cycles", 312.0)
            put("full_charge_pct", 18.0)
            put("avg_depth_of_discharge", 47.0)
            put("fast_charge_pct", 23.0)
            put("temp_exposure_score", 88.0)
            put("charge_habits_score", 74.0)
        }
}
