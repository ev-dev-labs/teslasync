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
 * Instrumented Compose tests for the Audit Log surface — every state from the web source rendered
 * on a device: content feed, empty, loading skeleton, hard error (retry), offline banner, and the
 * compact 24-hour summary. Also asserts the interactive affordances expose accessible names. The
 * pure adapter/projection/state logic is covered off-device by [AuditLogWidgetTest].
 */
class AuditLogWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun sampleContent(): AuditLogContent =
        AuditLogContent(
            rows =
                listOf(
                    AuditFeedRow("audit-1", AuditSeverity.Critical, "user.delete", RowSubtitle.Raw("users · admin"), 1_000L, false),
                    AuditFeedRow("sec-1", AuditSeverity.Warning, "Vehicle locked", RowSubtitle.SecurityEvent, 900L, true),
                ),
            totalEvents24h = 2,
            worstSeverity = AuditSeverity.Critical,
        )

    private fun emptyContent(): AuditLogContent =
        AuditLogContent(rows = emptyList(), totalEvents24h = 0, worstSeverity = AuditSeverity.Info)

    @Test
    fun contentRendersTitleAndFeedRows() {
        rule.setContent {
            TeslaSyncTheme {
                AuditLogWidgetContent(
                    state = UiState(UiPhase.Content, data = sampleContent(), fetchedAt = 0L),
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Audit Log").assertIsDisplayed()
        rule.onNodeWithText("user.delete").assertIsDisplayed()
        rule.onNodeWithText("Vehicle locked").assertIsDisplayed()
    }

    @Test
    fun emptyShowsNoAuditEventsMessage() {
        rule.setContent {
            TeslaSyncTheme {
                AuditLogWidgetContent(
                    state = UiState(UiPhase.Empty, data = emptyContent(), fetchedAt = 0L),
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("No audit events").assertIsDisplayed()
    }

    @Test
    fun loadingExposesAccessibleLoadingLabel() {
        rule.setContent {
            TeslaSyncTheme {
                AuditLogWidgetContent(state = UiState.loading(), onRefresh = {})
            }
        }
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                AuditLogWidgetContent(
                    state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
                    onRefresh = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Can't reach server").assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun refreshButtonHasAccessibleNameAndFires() {
        var refreshed = false
        rule.setContent {
            TeslaSyncTheme {
                AuditLogWidgetContent(
                    state = UiState(UiPhase.Content, data = sampleContent(), fetchedAt = 0L),
                    onRefresh = { refreshed = true },
                )
            }
        }
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        rule.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(refreshed)
    }

    @Test
    fun compactShowsTwentyFourHourSummary() {
        rule.setContent {
            TeslaSyncTheme {
                AuditLogWidgetContent(
                    state = UiState(UiPhase.Content, data = sampleContent(), fetchedAt = 0L),
                    onRefresh = {},
                    size = WidgetGridSize(cols = 1, rows = 2),
                )
            }
        }
        rule.onNodeWithText("Events (24h)").assertIsDisplayed()
        rule.onNodeWithText("Critical").assertIsDisplayed()
    }

    @Test
    fun offlineShowsBannerWhileKeepingData() {
        rule.setContent {
            TeslaSyncTheme {
                AuditLogWidgetContent(
                    state =
                        UiState(
                            UiPhase.Content,
                            data = sampleContent(),
                            fetchedAt = 0L,
                            stale = true,
                            errorKind = ErrorKind.Network,
                        ),
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Offline").assertIsDisplayed()
        rule.onNodeWithText("user.delete").assertIsDisplayed()
    }
}
