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
 * Instrumented Compose tests for [BatteryDegradationTrendWidgetContent] — the loading / empty /
 * single-sample / standard-content / compact / error surfaces the widget must render, asserting the
 * localized copy, the summary-stat accessibility labels, the chart's warranty-threshold accessible
 * description, and that the retry action fires. The pure projection / adapter logic is covered by the
 * no-device [BatteryDegradationTrendWidgetTest]; these assert the surfaces on a device
 * (connectedReleaseAndroidTest).
 */
class BatteryDegradationTrendWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val standard = BatteryDegradationSize(2, 4)
    private val compact = BatteryDegradationSize(1, 1)

    @Test
    fun loadingShowsNoStats() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationTrendWidgetContent(state = UiState.loading(), size = standard, onRefresh = {})
            }
        }
        rule.onNodeWithText("SoH").assertDoesNotExist()
        rule.onNodeWithText("No degradation data").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoDegradationState() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationTrendWidgetContent(
                    state = UiState(phase = UiPhase.Empty, data = BatteryDegradationSnapshot.NO_DATA, fetchedAt = 1L),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("No degradation data").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsStatsAndChartThresholdA11y() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationTrendWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(), fetchedAt = 1L),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("Battery Degradation").assertIsDisplayed()
        rule.onNodeWithText("SoH").assertIsDisplayed()
        rule.onNodeWithText("Cycles").assertIsDisplayed()
        rule.onNodeWithText("Degradation").assertIsDisplayed()
        // The web's 80% warranty reference line is conveyed to assistive tech on the chart section.
        rule.onNodeWithContentDescription("80%", substring = true).assertIsDisplayed()
    }

    @Test
    fun degradationChipHiddenWhenRateNotPositive() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationTrendWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(rate = 0.0), fetchedAt = 1L),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("SoH").assertIsDisplayed()
        rule.onNodeWithText("Degradation").assertDoesNotExist()
    }

    @Test
    fun singleSampleShowsNeedMoreData() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationTrendWidgetContent(
                    state =
                        UiState(
                            phase = UiPhase.Content,
                            data = snapshot(health = 92.0, trend = listOf(DegradationTrend("Jan", 99.0, 300.0))),
                            fetchedAt = 1L,
                        ),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("More data needed for trend").assertIsDisplayed()
    }

    @Test
    fun compactShowsStatsWithoutChart() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationTrendWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(), fetchedAt = 1L),
                    size = compact,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithText("SoH").assertIsDisplayed()
        // No chart section in compact, so the threshold a11y description is absent.
        rule.onNodeWithContentDescription("80%", substring = true).assertDoesNotExist()
    }

    @Test
    fun statCellExposesAccessibleLabel() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationTrendWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(), fetchedAt = 1L),
                    size = standard,
                    onRefresh = {},
                )
            }
        }
        rule.onNodeWithContentDescription("SoH:", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationTrendWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                    size = standard,
                    onRefresh = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    private fun contentSnapshot(rate: Double? = 1.2): BatteryDegradationSnapshot =
        snapshot(
            health = 92.0,
            rate = rate,
            cycles = 800.0,
            trend = listOf(DegradationTrend("Jan", 99.0, 300.0), DegradationTrend("Feb", 98.0, 290.0)),
        )

    private fun snapshot(
        health: Double? = null,
        rate: Double? = null,
        cycles: Double? = null,
        trend: List<DegradationTrend> = emptyList(),
    ): BatteryDegradationSnapshot =
        BatteryDegradationSnapshot(
            hasData = true,
            currentHealthPct = health,
            currentHealth = null,
            degradationRatePctPerMonth = rate,
            currentCycles = cycles,
            monthlyTrend = trend,
        )
}
