package io.teslasync.android.dashboard.widgets

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose tests for `BatteryDegradationForecastWidget` — one per render state from the
 * web source (full / compact / empty / error / stale-offline) plus the accessibility affordance on
 * the error retry control. They run on a device/emulator (connectedDebugAndroidTest); the
 * framework-free projection logic is covered by the no-device [BatteryDegradationForecastWidgetTest].
 * The retry is observed through the `onRetry` callback so assertions never depend on internal state.
 */
class BatteryDegradationForecastWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun sample(): DegradationForecast =
        DegradationForecast(
            currentHealthPct = 92.4,
            degradationRatePctPerMonth = 0.08,
            projected80PctDate = "2031-07-01T00:00:00Z",
            riskFactors =
                listOf(
                    DegradationRiskFactor(
                        name = "high_temp",
                        score = 8.0,
                        label = "High temperatures",
                        detail = "Frequent heat",
                    ),
                    DegradationRiskFactor(
                        name = "fast_charging",
                        score = 5.0,
                        label = "Fast charging",
                        detail = "42% DC",
                    ),
                ),
            recommendations = listOf("Charge to 80% daily"),
        )

    private fun content(data: DegradationForecast): UiState<DegradationForecast> =
        UiState(phase = if (data.hasData) UiPhase.Content else UiPhase.Empty, data = data, fetchedAt = 1L)

    @Test
    fun fullViewRendersHeroStatRisksAndRecommendations() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationForecastWidgetContent(
                    state = content(sample()),
                    size = DashboardWidgetSize(cols = 2, rows = 4),
                    locale = Locale.US,
                )
            }
        }
        rule.onNodeWithText("Projected 80% Capacity").assertIsDisplayed()
        rule.onNodeWithText("Jul 2031").assertIsDisplayed()
        // rate 0.08 %/mo classifies as the Normal tier.
        rule.onNodeWithText("Normal").assertIsDisplayed()
        rule.onNodeWithText("Current Health").assertIsDisplayed()
        rule.onNodeWithText("High temperatures").assertIsDisplayed()
        rule.onNodeWithText("Recommendations").assertIsDisplayed()
        rule.onNodeWithText("Charge to 80% daily").assertIsDisplayed()
    }

    @Test
    fun compactViewShowsHealthAndTier() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationForecastWidgetContent(
                    state = content(sample()),
                    size = DashboardWidgetSize(cols = 1, rows = 2),
                    locale = Locale.US,
                )
            }
        }
        rule.onNodeWithText("92.4%").assertIsDisplayed()
        rule.onNodeWithText("Normal").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsConfiguredMessage() {
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationForecastWidgetContent(
                    state = UiState(phase = UiPhase.Empty),
                    size = DashboardWidgetSize(cols = 2, rows = 4),
                )
            }
        }
        rule.onNodeWithText("No degradation forecast data").assertIsDisplayed()
    }

    @Test
    fun errorStateExposesAccessibleRetryAndFires() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationForecastWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
                    size = DashboardWidgetSize(cols = 2, rows = 4),
                    onRetry = { retried = true },
                )
            }
        }
        // The retry is the only interactive element — it carries an accessible label + click action.
        rule.onNodeWithText("Retry").assertIsDisplayed()
        rule.onNodeWithText("Retry").assertHasClickAction()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleOfflineContentStaysVisible() {
        // ADR-013: a cached value served after a failed refresh stays visible (never blanked).
        val state =
            UiState(
                phase = UiPhase.Content,
                data = sample(),
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            )
        rule.setContent {
            TeslaSyncTheme {
                BatteryDegradationForecastWidgetContent(
                    state = state,
                    size = DashboardWidgetSize(cols = 2, rows = 4),
                    locale = Locale.US,
                )
            }
        }
        rule.onNodeWithText("Jul 2031").assertIsDisplayed()
        rule.onNodeWithText("Current Health").assertIsDisplayed()
    }
}
