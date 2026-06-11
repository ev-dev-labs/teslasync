package io.teslasync.android.dashboardwidgets.notificationstats

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.notifications.NotificationLog
import io.teslasync.shared.core.presentation.notifications.NotificationStats
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the Notification Stats surface: each state from the web source
 * (content / wide+log-table / empty / error / stale + the compact big-number layout) renders its copy
 * on a device, every interactive element exposes an accessible name (refresh + retry), the log rows
 * expose a merged TalkBack description, and the compact layout announces the delivery rate. The
 * framework-free logic is covered by the no-device [NotificationStatsWidgetModelTest]; this is the
 * connectedAndroidTest surface gate.
 */
class NotificationStatsWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val stats =
        NotificationStats(totalSent = 100, sent = 98, failed = 6, pending = 0, totalChannels = 4, enabledChannels = 3)

    private val logs =
        listOf(
            NotificationLog(id = 1, title = "Email", message = "Battery low", status = "sent", createdAt = "2024-01-03T00:00:00Z"),
            NotificationLog(id = 2, title = "Push", message = "Charge complete", status = "pending", createdAt = "2024-01-02T00:00:00Z"),
            NotificationLog(id = 3, title = "Webhook", message = "Sentry triggered", status = "failed", createdAt = "2024-01-01T00:00:00Z"),
        )

    private fun statsState(
        phase: UiPhase = UiPhase.Content,
        stale: Boolean = false,
    ): UiState<NotificationStats> =
        UiState(
            phase = phase,
            data =
                if (phase ==
                    UiPhase.Content
                ) {
                    stats
                } else {
                    null
                },
            fetchedAt = 1L,
            stale = stale,
        )

    private fun logsState(): UiState<List<NotificationLog>> = UiState(phase = UiPhase.Content, data = logs, fetchedAt = 1L)

    @Test
    fun contentStandardShowsTitleAndEveryTileLabel() {
        rule.setContent {
            TeslaSyncTheme {
                NotificationStatsWidgetContent(
                    statsState = statsState(),
                    logsState = logsState(),
                    size = NotificationStatsRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithText("Notification Stats", ignoreCase = true).assertIsDisplayed()
        rule.onNodeWithText("Total Sent (7d)").assertIsDisplayed()
        rule.onNodeWithText("Delivery Rate").assertIsDisplayed()
        rule.onNodeWithText("Failed").assertIsDisplayed()
        rule.onNodeWithText("Active Channels").assertIsDisplayed()
    }

    @Test
    fun contentExposesRefreshAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                NotificationStatsWidgetContent(
                    statsState = statsState(),
                    logsState = logsState(),
                    size = NotificationStatsRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideLayoutShowsLogTableHeadersAndRowLabel() {
        rule.setContent {
            TeslaSyncTheme {
                NotificationStatsWidgetContent(
                    statsState = statsState(),
                    logsState = logsState(),
                    size = NotificationStatsSize(cols = 4, rows = 4),
                )
            }
        }

        rule.onNodeWithText("Channel").assertIsDisplayed()
        rule.onNodeWithText("Type").assertIsDisplayed()
        rule.onNodeWithText("Status").assertIsDisplayed()
        rule.onNodeWithText("Time").assertIsDisplayed()
        rule.onNodeWithContentDescription("Email, Battery low, sent", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                NotificationStatsWidgetContent(
                    statsState = statsState(phase = UiPhase.Empty),
                    logsState = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = 1L),
                    size = NotificationStatsRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithText("No notification data").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresCallback() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                NotificationStatsWidgetContent(
                    statsState = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    logsState = UiState.loading(),
                    size = NotificationStatsRegistration.DEFAULT_SIZE,
                    onRetry = { retried = true },
                )
            }
        }

        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun compactLayoutAnnouncesDeliveryRateForTalkback() {
        rule.setContent {
            TeslaSyncTheme {
                NotificationStatsWidgetContent(
                    statsState = statsState(),
                    logsState = logsState(),
                    size = NotificationStatsSize(cols = 1, rows = 2),
                )
            }
        }

        rule.onNodeWithContentDescription("98.0%", substring = true).assertIsDisplayed()
    }

    @Test
    fun staleContentStillRendersTiles() {
        rule.setContent {
            TeslaSyncTheme {
                NotificationStatsWidgetContent(
                    statsState = statsState(stale = true),
                    logsState = logsState(),
                    size = NotificationStatsRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithText("Delivery Rate").assertIsDisplayed()
    }
}
