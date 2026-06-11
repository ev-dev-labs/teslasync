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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for [ChargeHistoryWidgetContent] — the loading / empty / content (standard
 * + compact) / error / offline surfaces the widget must render, asserting the localized copy, the stat
 * labels, the refresh control's accessibility label, and that retry fires. The pure projection / adapter
 * logic is covered by the no-device [ChargeHistoryWidgetTest]; these assert the surfaces on a device
 * (connectedReleaseAndroidTest).
 */
class ChargeHistoryWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val standard = ChargeHistorySize(cols = 2, rows = 4)
    private val compact = ChargeHistorySize(cols = 1, rows = 2)

    @Test
    fun loadingShowsNoStatsOrEmptyMessage() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeHistoryWidgetContent(state = UiState.loading(), size = standard, onRefresh = {})
            }
        }
        rule.onNodeWithText("Total").assertDoesNotExist()
        rule.onNodeWithText("No charge sessions yet").assertDoesNotExist()
    }

    @Test
    fun emptyShowsTitleAndLocalizedEmptyState() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeHistoryWidgetContent(
                    state = UiState(phase = UiPhase.Empty, data = ChargeHistorySnapshot.EMPTY, fetchedAt = 1L),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("CHARGE HISTORY").assertIsDisplayed()
        rule.onNodeWithText("No charge sessions yet").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleStatsAndRefresh() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeHistoryWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(), fetchedAt = 1L),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("CHARGE HISTORY").assertIsDisplayed()
        rule.onNodeWithText("Total").assertIsDisplayed()
        rule.onNodeWithText("Avg").assertIsDisplayed()
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactContentShowsStatsWithoutTitle() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeHistoryWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(), fetchedAt = 1L),
                    size = compact,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Total").assertIsDisplayed()
        rule.onNodeWithText("Avg").assertIsDisplayed()
        rule.onNodeWithText("CHARGE HISTORY").assertDoesNotExist()
    }

    @Test
    fun serverErrorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                ChargeHistoryWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    size = standard,
                    onRefresh = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineErrorShowsOfflineSurface() {
        rule.setContent {
            TeslaSyncTheme {
                ChargeHistoryWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("You're offline").assertIsDisplayed()
    }

    private fun contentSnapshot(): ChargeHistorySnapshot = ChargeHistorySnapshot(listOf(12_000.0, 8_000.0, 16_000.0, 9_500.0))
}
