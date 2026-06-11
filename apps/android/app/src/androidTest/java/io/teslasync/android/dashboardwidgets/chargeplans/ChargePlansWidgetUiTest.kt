package io.teslasync.android.dashboardwidgets.chargeplans

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
 * Instrumented Compose tests for [ChargePlansWidgetContent] — the loading / empty / content / compact
 * / error surfaces the widget must render, asserting the localized copy, the detail-row + compact-tile
 * accessibility labels, and that the retry action fires. The pure projection / merge logic is covered
 * by the no-device [ChargePlansWidgetModelTest]; these assert the surfaces on a device.
 */
class ChargePlansWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val standard = ChargePlansSize(2, 4)
    private val compact = ChargePlansSize(1, 2)

    @Test
    fun loadingShowsNoContent() {
        rule.setContent {
            TeslaSyncTheme {
                ChargePlansWidgetContent(
                    state = UiState.loading(),
                    prefs = ChargePlansPrefs.DEFAULT,
                    size = standard,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithText("Target SOC").assertDoesNotExist()
        rule.onNodeWithText("No charge plans or rate data").assertDoesNotExist()
    }

    @Test
    fun emptyShowsNoDataState() {
        rule.setContent {
            TeslaSyncTheme {
                ChargePlansWidgetContent(
                    state = UiState(phase = UiPhase.Empty, data = ChargePlansSnapshot.EMPTY, fetchedAt = 1L),
                    prefs = ChargePlansPrefs.DEFAULT,
                    size = standard,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithText("No charge plans or rate data").assertIsDisplayed()
    }

    @Test
    fun standardContentShowsTitleStatsBadgeAndAccessibleDetailRows() {
        rule.setContent {
            TeslaSyncTheme {
                ChargePlansWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(), fetchedAt = 1L),
                    prefs = ChargePlansPrefs.DEFAULT,
                    size = standard,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithText("Charge Plans").assertIsDisplayed()
        rule.onNodeWithText("Target SOC").assertIsDisplayed()
        rule.onNodeWithText("Departure").assertIsDisplayed()
        rule.onNodeWithText("scheduled").assertIsDisplayed()
        rule.onNodeWithText("Rate Plans").assertIsDisplayed()
        rule.onNodeWithContentDescription("Est. Cost:", substring = true).assertIsDisplayed()
    }

    @Test
    fun compactContentShowsTargetSocTile() {
        rule.setContent {
            TeslaSyncTheme {
                ChargePlansWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = contentSnapshot(), fetchedAt = 1L),
                    prefs = ChargePlansPrefs.DEFAULT,
                    size = compact,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithText("80%").assertIsDisplayed()
        rule.onNodeWithContentDescription("Target SOC:", substring = true).assertIsDisplayed()
        // compact tile omits the detail list + rate-plans section (web compact branch)
        rule.onNodeWithText("Scheduled Start").assertDoesNotExist()
        rule.onNodeWithText("Rate Plans").assertDoesNotExist()
    }

    @Test
    fun noActivePlanShowsNoPlansButKeepsRates() {
        rule.setContent {
            TeslaSyncTheme {
                ChargePlansWidgetContent(
                    state = UiState(phase = UiPhase.Content, data = ratesOnlySnapshot(), fetchedAt = 1L),
                    prefs = ChargePlansPrefs.DEFAULT,
                    size = standard,
                    onRefresh = {},
                    onRetry = {},
                )
            }
        }
        rule.onNodeWithText("No charge plans").assertIsDisplayed()
        rule.onNodeWithText("Rate Plans").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndFiresIt() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                ChargePlansWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                    prefs = ChargePlansPrefs.DEFAULT,
                    size = standard,
                    onRefresh = {},
                    onRetry = { retried = true },
                )
            }
        }
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    private fun contentSnapshot(): ChargePlansSnapshot =
        ChargePlansSnapshot(
            plans =
                listOf(
                    ChargePlan(
                        id = 1,
                        vehicleId = 1,
                        targetSoc = 80.0,
                        departBy = "2024-01-02T07:30:00Z",
                        scheduledStart = "2024-01-02T00:00:00Z",
                        scheduledEnd = "2024-01-02T06:00:00Z",
                        ratePlan = "PG&E EV2-A",
                        estimatedKwh = 42.5,
                        estimatedCost = 6.4,
                        chargeNowCost = 9.2,
                        savings = 2.5,
                        status = "scheduled",
                        appliedAt = null,
                        completedAt = null,
                        createdAt = "2024-01-01T00:00:00Z",
                    ),
                ),
            ratePlans = listOf(RatePlanInfo(id = "EV2A", name = "EV2-A Time of Use", utility = "PG&E")),
        )

    private fun ratesOnlySnapshot(): ChargePlansSnapshot =
        ChargePlansSnapshot(
            plans = emptyList(),
            ratePlans = listOf(RatePlanInfo(id = "EV2A", name = "EV2-A Time of Use", utility = "PG&E")),
        )
}
