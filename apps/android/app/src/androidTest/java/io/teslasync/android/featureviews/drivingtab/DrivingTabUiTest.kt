package io.teslasync.android.featureviews.drivingtab

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [DrivingTabContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state (per-section
 * empty messages), the populated charts (titles + the scatter's TalkBack label), and the stale/offline
 * cached views with auto-refresh. The offline gate's `testReleaseUnitTest` covers the pure projections; this
 * covers render + a11y. Mirrors the web spec
 * (web/src/features/analytics/components/analytics/DrivingTab.tsx).
 */
class DrivingTabUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<DrivingAnalytics>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DrivingTabContent(
                    state = state,
                    onRetry = onRetry,
                    units = UnitFormatter.default().prefs,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun analytics(): DrivingAnalytics =
        DrivingAnalytics(
            speedDistribution =
                listOf(
                    DistributionBucket("0-20", 4),
                    DistributionBucket("20-40", 9),
                ),
            distanceDistribution = listOf(DistributionBucket("0-5", 7)),
            hourlyPattern =
                listOf(
                    HourlyDrivePoint(hour = 7, drives = 3, distance = 22.0),
                    HourlyDrivePoint(hour = 8, drives = 6, distance = 41.0),
                ),
            tempVsEfficiency =
                listOf(
                    TempEfficiencySample(temp = 5.0, efficiency = 182.0, distance = 12.0),
                    TempEfficiencySample(temp = 18.0, efficiency = 150.0, distance = 25.0),
                ),
            dailyTrend =
                listOf(
                    DailyDrivePoint("2026-04-02", 3, 40.0, 168.0),
                    DailyDrivePoint("2026-04-03", 5, 62.0, 155.0),
                ),
            durationDistribution = listOf(DistributionBucket("0-15m", 6)),
        )

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
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
    fun emptyShowsEverySectionTitleAndItsFriendlyEmptyMessage() {
        setContent(UiState(UiPhase.Empty, data = DrivingAnalytics.EMPTY))
        compose.onNodeWithText("Speed Distribution").assertIsDisplayed()
        compose.onNodeWithText("No speed data").assertExists()
        compose.onNodeWithText("Temperature vs Efficiency").assertExists()
        compose.onNodeWithText("No temperature data").assertExists()
        compose.onNodeWithText("Efficiency Trend").assertExists()
        compose.onNodeWithText("No efficiency trend data").assertExists()
    }

    @Test
    fun contentRendersSectionTitlesAndAccessibleScatterLabel() {
        setContent(UiState(UiPhase.Content, data = analytics()))
        compose.onNodeWithText("Speed Distribution").assertIsDisplayed()
        compose.onNodeWithText("Hourly Driving Pattern").assertExists()
        compose.onNodeWithText("Temperature vs Efficiency").assertExists()
        compose.onNodeWithText("Daily Driving Trend").assertExists()
        compose.onNodeWithContentDescription("Temp / Efficiency").assertExists()
    }

    @Test
    fun offlineShowsCachedChartsWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = analytics(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Speed Distribution").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = analytics(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Speed Distribution").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
