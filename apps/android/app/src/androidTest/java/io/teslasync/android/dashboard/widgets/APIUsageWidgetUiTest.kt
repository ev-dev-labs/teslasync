package io.teslasync.android.dashboard.widgets

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
 * Instrumented Compose tests for the API Usage surface — the loading / content / empty / error /
 * stale-offline states the web `APIUsageWidget` renders, plus the screen-reader names on the stat
 * tiles and the refresh affordance. The framework-free parse / projection / view-model logic is
 * covered off-device by [APIUsageWidgetTest]; these assert the surfaces render their copy, expose
 * accessible names, and fire their actions on a device (connectedAndroidTest).
 */
class APIUsageWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    @Test
    fun content_shows_title_and_stat_labels() {
        rule.setContent {
            TeslaSyncTheme {
                ApiUsageWidgetContent(
                    state = UiState(UiPhase.Content, data = stats(), fetchedAt = 100L),
                    size = ApiUsageSize(2, 2),
                    onRetry = {},
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("API Usage").assertIsDisplayed()
        rule.onNodeWithText("Total Calls (24h)").assertIsDisplayed()
        rule.onNodeWithText("Avg Response").assertIsDisplayed()
        rule.onNodeWithText("Error Rate").assertIsDisplayed()
        rule.onNodeWithText("Errors").assertIsDisplayed()
    }

    @Test
    fun content_high_error_rate_shows_high_chip() {
        rule.setContent {
            TeslaSyncTheme {
                ApiUsageWidgetContent(
                    state = UiState(UiPhase.Content, data = stats(errorRate = 9.0), fetchedAt = 100L),
                    size = ApiUsageSize(3, 2),
                    onRetry = {},
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("High").assertIsDisplayed()
    }

    @Test
    fun stat_tile_exposes_merged_content_description() {
        rule.setContent {
            TeslaSyncTheme {
                ApiUsageWidgetContent(
                    state = UiState(UiPhase.Content, data = stats(), fetchedAt = 100L),
                    size = ApiUsageSize(2, 2),
                    onRetry = {},
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithContentDescription("Total Calls (24h)", substring = true).assertIsDisplayed()
    }

    @Test
    fun compact_shows_big_number_and_label() {
        rule.setContent {
            TeslaSyncTheme {
                ApiUsageWidgetContent(
                    state = UiState(UiPhase.Content, data = stats(last24h = 12345, errorRate = 2.0), fetchedAt = 100L),
                    size = ApiUsageSize(1, 2),
                    onRetry = {},
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("12,345").assertIsDisplayed()
        rule.onNodeWithText("Calls (24h)").assertIsDisplayed()
    }

    @Test
    fun empty_shows_no_data_message() {
        rule.setContent {
            TeslaSyncTheme {
                ApiUsageWidgetContent(
                    state = UiState(UiPhase.Empty, data = ApiUsageStats.EMPTY, fetchedAt = 100L),
                    size = ApiUsageSize(2, 2),
                    onRetry = {},
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("No API usage data").assertIsDisplayed()
    }

    @Test
    fun error_shows_server_error_and_fires_retry() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                ApiUsageWidgetContent(
                    state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    size = ApiUsageSize(2, 2),
                    onRetry = { retried = true },
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Server error").assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offline_cached_still_renders_stats() {
        rule.setContent {
            TeslaSyncTheme {
                ApiUsageWidgetContent(
                    state =
                        UiState(
                            UiPhase.Content,
                            data = stats(),
                            fetchedAt = 100L,
                            stale = true,
                            errorKind = ErrorKind.Network,
                        ),
                    size = ApiUsageSize(2, 2),
                    onRetry = {},
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Total Calls (24h)").assertIsDisplayed()
    }

    @Test
    fun refresh_affordance_is_labelled_and_fires() {
        var refreshed = false
        rule.setContent {
            TeslaSyncTheme {
                ApiUsageWidgetContent(
                    state = UiState(UiPhase.Content, data = stats(), fetchedAt = 100L),
                    size = ApiUsageSize(2, 2),
                    onRetry = {},
                    onRefresh = { refreshed = true },
                )
            }
        }
        rule.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    private fun stats(
        last24h: Int = 12345,
        avgDurationMs: Double = 42.5,
        errorRate: Double = 6.5,
        errorCount: Int = 12,
        totalCalls: Int = 20000,
    ): ApiUsageStats = ApiUsageStats(last24h, avgDurationMs, errorRate, errorCount, totalCalls)
}
