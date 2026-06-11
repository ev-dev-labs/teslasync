package io.teslasync.android.dashboard.widgets.uptimemonitor

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
 * Instrumented Compose tests for the Uptime Monitor surface — every state from the web source rendered
 * on a device: standard content (title + overall + per-service rows + DB-size/table footer), the compact
 * healthy-count hero (title hidden), empty, loading skeleton, hard error (retry), and the offline
 * stale-cache branch. Also asserts the interactive affordances expose accessible names. The pure
 * adapter/projection/state logic is covered off-device by [UptimeMonitorProjectionTest] and
 * [UptimeMonitorWidgetViewModelTest].
 */
class UptimeMonitorWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun healthy(
        databaseSize: String? = "1.4 GB",
        tableCount: Long? = 87L,
    ): UptimeHealth =
        UptimeHealth(
            overallStatus = "healthy",
            componentStatuses =
                mapOf(
                    "database" to "healthy",
                    "mqtt" to "healthy",
                    "tesla_api" to "healthy",
                    "fleet_telemetry" to "healthy",
                ),
            databaseSize = databaseSize,
            tableCount = tableCount,
        )

    @Test
    fun contentRendersTitleOverallServicesAndFooter() {
        rule.setContent {
            TeslaSyncTheme {
                UptimeMonitorWidgetContent(
                    state = UiState(UiPhase.Content, data = healthy(), fetchedAt = 1_000L),
                    size = UptimeMonitorSize(cols = 2, rows = 4),
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Uptime Monitor").assertIsDisplayed()
        rule.onNodeWithText("All OK").assertIsDisplayed()
        // Each service row folds dot + label + status into one TalkBack phrase.
        rule.onNodeWithContentDescription("Database, OK").assertIsDisplayed()
        rule.onNodeWithContentDescription("Fleet Telemetry, OK").assertIsDisplayed()
        // Tall footer (rows >= 2) shows DB size + table count.
        rule.onNodeWithText("DB Size").assertIsDisplayed()
        rule.onNodeWithText("Tables").assertIsDisplayed()
        rule.onNodeWithText("1.4 GB").assertIsDisplayed()
        rule.onNodeWithText("87").assertIsDisplayed()
    }

    @Test
    fun compactHidesTitleAndShowsHealthyCount() {
        rule.setContent {
            TeslaSyncTheme {
                UptimeMonitorWidgetContent(
                    state = UiState(UiPhase.Content, data = healthy(), fetchedAt = 1_000L),
                    size = UptimeMonitorSize(cols = 1, rows = 1),
                    onRefresh = {},
                )
            }
        }
        // Web hides the title in the compact footprint.
        rule.onNodeWithText("Uptime Monitor").assertDoesNotExist()
        // The folded compact hero carries the "healthy/total" count.
        rule.onNodeWithContentDescription("4/4", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoSystemHealthDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                UptimeMonitorWidgetContent(
                    state = UiState(UiPhase.Empty, data = null, fetchedAt = 1_000L),
                    size = UptimeMonitorRegistration.DEFAULT_SIZE,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("No system health data").assertIsDisplayed()
    }

    @Test
    fun loadingExposesAccessibleLoadingLabel() {
        rule.setContent {
            TeslaSyncTheme {
                UptimeMonitorWidgetContent(
                    state = UiState.loading(),
                    size = UptimeMonitorRegistration.DEFAULT_SIZE,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                UptimeMonitorWidgetContent(
                    state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    size = UptimeMonitorRegistration.DEFAULT_SIZE,
                    onRefresh = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Server error").assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun refreshButtonHasAccessibleNameAndFires() {
        var refreshed = false
        rule.setContent {
            TeslaSyncTheme {
                UptimeMonitorWidgetContent(
                    state = UiState(UiPhase.Content, data = healthy(), fetchedAt = 1_000L),
                    size = UptimeMonitorRegistration.DEFAULT_SIZE,
                    onRefresh = { refreshed = true },
                )
            }
        }
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        rule.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun offlineShowsStaleChipWhileKeepingData() {
        rule.setContent {
            TeslaSyncTheme {
                UptimeMonitorWidgetContent(
                    state =
                        UiState(
                            UiPhase.Content,
                            data = healthy(),
                            fetchedAt = 1_000L,
                            stale = true,
                            errorKind = ErrorKind.Network,
                        ),
                    size = UptimeMonitorRegistration.DEFAULT_SIZE,
                    onRefresh = {},
                )
            }
        }
        // The freshness chip flags offline (its text is folded into the chip's content description).
        rule.onNodeWithContentDescription("Offline").assertIsDisplayed()
        // Cached data stays visible — never blanked.
        rule.onNodeWithContentDescription("Database, OK").assertIsDisplayed()
    }
}
