package io.teslasync.android.dashboardwidgets

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the Analytics Summary surface: each state from the web source
 * (content / empty / error / stale) renders its copy on a device, every interactive element
 * exposes an accessible name (refresh + retry), and the compact layout announces the headline
 * distance to TalkBack. The framework-free logic is covered by the no-device
 * [AnalyticsSummaryWidgetTest]; this is the connectedAndroidTest surface gate.
 */
class AnalyticsSummaryWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val metricPrefs = AnalyticsDisplayPrefs(DistanceUnitPref.KM, "$")

    @Test
    fun contentStandardShowsTitleAndEveryStatLabel() {
        rule.setContent {
            TeslaSyncTheme {
                AnalyticsSummaryWidget(
                    state = UiState(phase = UiPhase.Content, data = summary(distanceKm = 1234.5), fetchedAt = 1L),
                    prefs = metricPrefs,
                    span = AnalyticsSummaryWidgetSpec.defaultSpan,
                    onRefresh = {},
                )
            }
        }

        rule.onNodeWithText("Analytics Summary").assertIsDisplayed()
        rule.onNodeWithText("Total Distance").assertIsDisplayed()
        rule.onNodeWithText("Avg Efficiency").assertIsDisplayed()
        rule.onNodeWithText("Energy Consumed").assertIsDisplayed()
        rule.onNodeWithText("Cost / km").assertIsDisplayed()
    }

    @Test
    fun contentExposesRefreshAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                AnalyticsSummaryWidget(
                    state = UiState(phase = UiPhase.Content, data = summary(distanceKm = 10.0), fetchedAt = 1L),
                    prefs = metricPrefs,
                    span = AnalyticsSummaryWidgetSpec.defaultSpan,
                    onRefresh = {},
                )
            }
        }

        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                AnalyticsSummaryWidget(
                    state = UiState(phase = UiPhase.Empty, data = buildJsonObject {}),
                    prefs = metricPrefs,
                    span = AnalyticsSummaryWidgetSpec.defaultSpan,
                    onRefresh = {},
                )
            }
        }

        rule.onNodeWithText("No analytics data").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresRefresh() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                AnalyticsSummaryWidget(
                    state = UiState<JsonElement>(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    prefs = metricPrefs,
                    span = AnalyticsSummaryWidgetSpec.defaultSpan,
                    onRefresh = { retried = true },
                )
            }
        }

        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleContentStillRendersData() {
        rule.setContent {
            TeslaSyncTheme {
                AnalyticsSummaryWidget(
                    state = UiState(phase = UiPhase.Content, data = summary(distanceKm = 42.0), fetchedAt = 1L, stale = true),
                    prefs = metricPrefs,
                    span = AnalyticsSummaryWidgetSpec.defaultSpan,
                    onRefresh = {},
                )
            }
        }

        rule.onNodeWithText("Total Distance").assertIsDisplayed()
    }

    @Test
    fun compactLayoutAnnouncesDistanceForTalkback() {
        rule.setContent {
            TeslaSyncTheme {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    AnalyticsSummaryWidget(
                        state = UiState(phase = UiPhase.Content, data = summary(distanceKm = 100.0), fetchedAt = 1L),
                        prefs = metricPrefs,
                        span = WidgetSpan(cols = 1, rows = 2),
                        onRefresh = {},
                    )
                }
            }
        }

        rule.onNodeWithContentDescription("Total Distance", substring = true).assertIsDisplayed()
    }

    private fun summary(distanceKm: Double): JsonElement =
        buildJsonObject {
            put("total_distance_km", distanceKm)
            put("total_energy_kwh", 45.6)
            put("total_cost", 12.5)
            put("avg_efficiency_wh_km", 150.0)
        }
}
