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
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for [BackupHistoryWidgetContent] — the loading / no-site / no-events /
 * content / error surfaces the widget must render, asserting the localized copy, the event-row
 * accessibility labels, and the retry action fires. The pure projection / adapter logic is covered by
 * the no-device [BackupHistoryWidgetTest]; these assert the surfaces on a device
 * (connectedReleaseAndroidTest).
 */
class BackupHistoryWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val standard = BackupHistorySize(2, 4)
    private val compact = BackupHistorySize(1, 2)

    @Test
    fun loadingShowsNoStats() {
        rule.setContent {
            TeslaSyncTheme {
                BackupHistoryWidgetContent(state = UiState.loading(), size = standard, onRefresh = {})
            }
        }
        rule.onNodeWithText("Outages (30d)").assertDoesNotExist()
        rule.onNodeWithText("No backup events in the last 30 days").assertDoesNotExist()
    }

    @Test
    fun noSiteShowsNoSiteEmptyState() {
        rule.setContent {
            TeslaSyncTheme {
                BackupHistoryWidgetContent(
                    state = UiState(phase = UiPhase.Empty, data = BackupHistorySnapshot.NO_SITES, fetchedAt = 1L),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("No Tesla Energy site linked").assertIsDisplayed()
    }

    @Test
    fun noEventsShowsTitleAndEmptyState() {
        rule.setContent {
            TeslaSyncTheme {
                BackupHistoryWidgetContent(
                    state =
                        UiState(
                            phase = UiPhase.Empty,
                            data = BackupHistorySnapshot.siteWithoutEvents(1),
                            fetchedAt = 1L,
                        ),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Backup History").assertIsDisplayed()
        rule.onNodeWithText("No backup events in the last 30 days").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsBothStatsAndAccessibleRows() {
        rule.setContent {
            TeslaSyncTheme {
                BackupHistoryWidgetContent(
                    state =
                        UiState(
                            phase = UiPhase.Content,
                            data = contentSnapshot(),
                            fetchedAt = 1L,
                        ),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Outages (30d)").assertIsDisplayed()
        rule.onNodeWithText("Avg Duration").assertIsDisplayed()
        rule.onNodeWithContentDescription("Duration:", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactContentShowsSingleStat() {
        rule.setContent {
            TeslaSyncTheme {
                BackupHistoryWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(), fetchedAt = 1L),
                    size = compact,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Outages (30d)").assertIsDisplayed()
        rule.onNodeWithText("Avg Duration").assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                BackupHistoryWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                    size = standard,
                    onRefresh = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    private fun contentSnapshot(): BackupHistorySnapshot =
        BackupHistorySnapshot.fromSiteAndEvents(
            siteId = 1,
            eventsJson =
                buildJsonArray {
                    add(
                        buildJsonObject {
                            put("id", 1L)
                            put("timestamp", "2024-01-02T00:00:00Z")
                            put("duration_seconds", 120.0)
                        },
                    )
                    add(
                        buildJsonObject {
                            put("id", 2L)
                            put("timestamp", "2024-01-01T00:00:00Z")
                            put("duration_seconds", 60.0)
                        },
                    )
                },
        )
}
