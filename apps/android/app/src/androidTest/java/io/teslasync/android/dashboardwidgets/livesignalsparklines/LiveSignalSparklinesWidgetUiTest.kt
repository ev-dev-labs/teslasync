package io.teslasync.android.dashboardwidgets.livesignalsparklines

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
 * Instrumented Compose tests for [LiveSignalSparklinesWidgetContent] — the loading / empty / content /
 * error surfaces the widget must render, asserting the localized copy (title, "no data" label, empty
 * message), the per-row signal name + value, the refresh accessibility label, and that retry fires. The
 * pure projection / adapter logic is covered by the no-device unit tests; these assert the surfaces on a
 * device.
 */
class LiveSignalSparklinesWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val default = LiveSignalSparklinesRegistration.DEFAULT_SIZE

    @Test
    fun loadingShowsSkeletonNotContent() {
        setWidget(state = UiState.loading(), size = default)
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
        rule.onNodeWithText("Battery Level").assertDoesNotExist()
        rule.onNodeWithText("Live Signal Sparklines").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoSignalsAvailable() {
        setWidget(
            state = UiState(phase = UiPhase.Empty, data = LiveSignalSparklinesData.EMPTY, fetchedAt = 1L),
            size = default,
        )
        rule.onNodeWithText("No signals available").assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleRowsAndValue() {
        setWidget(state = contentState(), size = default)
        rule.onNodeWithText("Live Signal Sparklines").assertIsDisplayed()
        rule.onNodeWithText("Battery Level").assertIsDisplayed()
        rule.onNodeWithText("72", substring = true).assertIsDisplayed()
    }

    @Test
    fun contentShowsNoHistoryLabelForSparseRow() {
        setWidget(state = contentState(), size = default)
        rule.onNodeWithText("no data").assertIsDisplayed()
    }

    @Test
    fun refreshExposesAccessibilityLabel() {
        setWidget(state = contentState(), size = default)
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                LiveSignalSparklinesWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                    size = default,
                    onRetry = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    private fun setWidget(
        state: UiState<LiveSignalSparklinesData>,
        size: LiveSignalSparklinesSize,
    ) {
        rule.setContent {
            TeslaSyncTheme {
                LiveSignalSparklinesWidgetContent(state = state, size = size)
            }
        }
    }

    private fun contentState(): UiState<LiveSignalSparklinesData> =
        UiState(
            phase = UiPhase.Content,
            data =
                LiveSignalSparklinesData(
                    rows =
                        listOf(
                            row("BatteryLevel", 72.4, listOf(70.0, 71.0, 71.5, 72.0, 72.4, 72.4), SignalTrend.Up),
                            row("OutsideTemp", 15.2, emptyList(), SignalTrend.Flat),
                        ),
                ),
            fetchedAt = 1L,
        )

    private fun row(
        name: String,
        value: Double?,
        points: List<Double>,
        trend: SignalTrend,
    ): LiveSignalSparklineRow =
        LiveSignalSparklineRow(
            signal = name,
            displayName = formatSignalName(name),
            currentValue = value,
            points = points,
            hasSparkline = points.size >= 2,
            trend = trend,
        )
}
