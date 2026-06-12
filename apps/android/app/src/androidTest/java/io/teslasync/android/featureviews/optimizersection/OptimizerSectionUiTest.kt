package io.teslasync.android.featureviews.optimizersection

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
 * On-device Compose UI + accessibility verification of [OptimizerSectionContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state, the populated
 * section (savings banner, habits / battery / cost panels, inline cost heatmap, recommendation cards), and the
 * stale / offline cached views. Asserts the rendered i18n strings and the TalkBack content descriptions (the
 * accessible loading label, the radial-gauge score description, the offline freshness chip). The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/charging-list/OptimizerSection.tsx). Runs under en-US, so number
 * formatting is deterministic.
 */
class OptimizerSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<ChargingOptimizerData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OptimizerSectionContent(state = state, onRetry = onRetry)
            }
        }
    }

    private fun mix(): ChargingOptimizerData =
        ChargingOptimizerData(
            currentSchedule =
                OptimizerSchedule(
                    mostCommonStartHour = 22,
                    mostCommonDay = "Monday",
                    avgSessionsPerWeek = 4.5,
                    homeChargingPct = 80.0,
                    avgChargeToPct = 85.0,
                ),
            costAnalysis =
                OptimizerCostAnalysis(
                    peakHours = listOf(16, 17, 18),
                    offpeakHours = listOf(0, 1, 2),
                    peakCostPerKwh = 0.32,
                    offpeakCostPerKwh = 0.12,
                    sessionsDuringPeakPct = 40.0,
                    potentialMonthlySavings = 24.0,
                ),
            batteryHealthScore = 82.0,
            recommendations =
                listOf(
                    OptimizerRecommendation(
                        type = "shift",
                        priority = "high",
                        title = "Shift charging to off-peak hours",
                        detail = "Most of your sessions land in the peak window.",
                        estimatedSavings = 12.0,
                    ),
                ),
            weeklyHeatmap = listOf(OptimizerHeatmapEntry(day = 1, hour = 22, sessions = 3, avgCostPerKwh = 0.30)),
        )

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankSection() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersSavingsBannerHabitsAndCost() {
        setContent(UiState(UiPhase.Content, data = mix()))
        compose.onNodeWithText("Save ~\$24/month by adjusting your charging schedule").assertExists()
        compose.onNodeWithText("Charging Habits").assertExists()
        compose.onNodeWithText("4.5").assertExists()
        compose.onNodeWithText("22:00").assertExists()
        compose.onNodeWithText("Monday").assertExists()
        compose.onNodeWithText("Cost Analysis").assertExists()
        compose.onNodeWithText("\$0.320/kWh").assertExists()
        compose.onNodeWithText("16:00, 17:00, 18:00").assertExists()
    }

    @Test
    fun contentRendersBatteryScoreMessageAndRecommendations() {
        setContent(UiState(UiPhase.Content, data = mix()))
        compose.onNodeWithText("Your habits are battery-friendly").assertExists()
        compose.onNodeWithText("Optimization Recommendations").assertExists()
        compose.onNodeWithText("Shift charging to off-peak hours").assertExists()
        compose.onNodeWithText("HIGH").assertExists()
        compose.onNodeWithText("~\$12/mo").assertExists()
    }

    @Test
    fun contentRendersInlineCostHeatmapWithLegend() {
        setContent(UiState(UiPhase.Content, data = mix()))
        compose.onNodeWithText("Charging Cost Heatmap").assertExists()
        compose.onNodeWithText("Cheap").assertExists()
        compose.onNodeWithText("Expensive").assertExists()
    }

    @Test
    fun recommendationsEmptyStateShowsWhenNoneAvailable() {
        setContent(UiState(UiPhase.Content, data = mix().copy(recommendations = emptyList())))
        compose.onNodeWithText("Recommendations will appear after more charging sessions.").assertExists()
    }

    @Test
    fun gaugeExposesAccessibleScoreDescription() {
        setContent(UiState(UiPhase.Content, data = mix()))
        compose.onNodeWithContentDescription("Battery-Friendly Score: 82").assertExists()
    }

    @Test
    fun offlineShowsCachedSectionWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = mix(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Charging Habits").assertExists()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = mix(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Charging Habits").assertExists()
        assertTrue(refreshed)
    }
}
