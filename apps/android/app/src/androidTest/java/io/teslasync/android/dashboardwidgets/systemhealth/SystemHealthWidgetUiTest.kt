package io.teslasync.android.dashboardwidgets.systemhealth

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
 * Instrumented Compose tests for the System Health surface: each state from the web source (content /
 * empty / error / stale + the compact overall-badge layout) renders its copy on a device, every
 * interactive element exposes an accessible name (refresh + retry), each service row exposes a merged
 * TalkBack description (label + status word), and the compact layout announces the healthy/total count.
 * The framework-free logic is covered by the no-device [SystemHealthWidgetModelTest]; this is the
 * connectedAndroidTest gate.
 */
class SystemHealthWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun data(): SystemHealthData =
        SystemHealthData(
            overall = SystemOverall.Degraded,
            services =
                listOf(
                    SystemService("database", "Database", SystemServiceLevel.Ok),
                    SystemService("mqtt", "Mqtt", SystemServiceLevel.Ok),
                    SystemService("tesla_api", "Tesla Api", SystemServiceLevel.Degraded),
                    SystemService("fleet_telemetry", "Fleet Telemetry", SystemServiceLevel.Down),
                ),
            healthyCount = 2,
            dbSize = "1.2 GB",
            activeConns = 4,
            maxConns = 25,
            memoryMb = 312,
            goroutines = 148,
            resolved = true,
        )

    private fun contentState(stale: Boolean = false): UiState<SystemHealthData> =
        UiState(phase = UiPhase.Content, data = data(), fetchedAt = 1L, stale = stale)

    @Test
    fun contentStandardShowsTitleStatLabelsAndService() {
        rule.setContent {
            TeslaSyncTheme {
                SystemHealthWidgetContent(state = contentState(), size = SystemHealthRegistration.DEFAULT_SIZE)
            }
        }

        rule.onNodeWithText("System Health", ignoreCase = true).assertIsDisplayed()
        rule.onNodeWithText("DB Size").assertIsDisplayed()
        rule.onNodeWithText("Active Conns").assertIsDisplayed()
        rule.onNodeWithText("Memory").assertIsDisplayed()
        rule.onNodeWithText("Goroutines").assertIsDisplayed()
        rule.onNodeWithText("Database").assertIsDisplayed()
    }

    @Test
    fun contentShowsTheActiveConnsValue() {
        rule.setContent {
            TeslaSyncTheme {
                SystemHealthWidgetContent(state = contentState(), size = SystemHealthRegistration.DEFAULT_SIZE)
            }
        }

        rule.onNodeWithText("4/25").assertIsDisplayed()
    }

    @Test
    fun contentExposesRefreshAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                SystemHealthWidgetContent(state = contentState(), size = SystemHealthRegistration.DEFAULT_SIZE)
            }
        }

        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun serviceRowExposesMergedTalkbackLabel() {
        rule.setContent {
            TeslaSyncTheme {
                SystemHealthWidgetContent(state = contentState(), size = SystemHealthRegistration.DEFAULT_SIZE)
            }
        }

        rule.onNodeWithContentDescription("Database", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                SystemHealthWidgetContent(
                    state = UiState(phase = UiPhase.Empty, data = SystemHealthData.EMPTY, fetchedAt = 1L),
                    size = SystemHealthRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithText("No system health data").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresCallback() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                SystemHealthWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    size = SystemHealthRegistration.DEFAULT_SIZE,
                    onRetry = { retried = true },
                )
            }
        }

        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun compactLayoutAnnouncesServiceCountForTalkback() {
        rule.setContent {
            TeslaSyncTheme {
                SystemHealthWidgetContent(state = contentState(), size = SystemHealthSize(cols = 1, rows = 2))
            }
        }

        rule.onNodeWithContentDescription("2/4", substring = true).assertIsDisplayed()
    }

    @Test
    fun staleContentStillRendersTiles() {
        rule.setContent {
            TeslaSyncTheme {
                SystemHealthWidgetContent(state = contentState(stale = true), size = SystemHealthRegistration.DEFAULT_SIZE)
            }
        }

        rule.onNodeWithText("DB Size").assertIsDisplayed()
    }
}
