package io.teslasync.android.featureviews.driveanalyticssection

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
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
import java.time.LocalDate
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [DriveAnalyticsSectionContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state (every
 * chart's empty message), the populated charts (titles + each chart's screen-reader description, including
 * the bespoke scatter), and the stale/offline cached views with auto-refresh. The offline gate's
 * `testReleaseUnitTest` covers the pure projections; this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/driving-dynamics/DriveAnalyticsSection.tsx).
 */
class DriveAnalyticsSectionUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<DriveAnalyticsDrive>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DriveAnalyticsSectionContent(
                    state = state,
                    onRetry = onRetry,
                    units = UnitFormatter.default().prefs,
                    locale = Locale.US,
                    todayEpochDay = TODAY,
                )
            }
        }
    }

    private fun drives(): List<DriveAnalyticsDrive> =
        listOf(
            DriveAnalyticsDrive(startTs = "2026-04-02T08:00:00Z", distanceM = 18_400.0, avgSpeedMps = 12.0, avgPowerW = 16_000.0),
            DriveAnalyticsDrive(startTs = "2026-04-08T17:30:00Z", distanceM = 42_100.0, avgSpeedMps = 27.0, avgPowerW = 38_500.0),
            DriveAnalyticsDrive(startTs = "2026-04-15T07:10:00Z", distanceM = 9_300.0, avgSpeedMps = 8.0, avgPowerW = 11_200.0),
        )

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Drive Analytics").assertIsDisplayed()
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
    fun emptyShowsEveryChartTitleAndItsFriendlyEmptyMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Speed Distribution").assertIsDisplayed()
        compose.onNodeWithText("Acceleration Patterns").assertExists()
        compose.onNodeWithText("Power Profile").assertExists()
        // One "No data available" per always-visible chart — never a hidden panel.
        compose.onAllNodesWithText("No data available").assertCountEquals(3)
    }

    @Test
    fun contentRendersEveryChartTitleAndAccessibleDescription() {
        setContent(UiState(UiPhase.Content, data = drives()))
        compose.onNodeWithText("Speed Distribution").assertIsDisplayed()
        compose.onNodeWithText("Acceleration Patterns").assertExists()
        compose.onNodeWithText("Power Profile").assertExists()
        compose.onNodeWithContentDescription("Speed-bucket drive count distribution bar chart").assertExists()
        compose.onNodeWithContentDescription("Per-drive scatter chart of peak power versus trip distance").assertExists()
        compose.onNodeWithContentDescription("Recent-drives peak and regen power dual-area chart").assertExists()
    }

    @Test
    fun offlineShowsCachedChartsWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = drives(),
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
                    data = drives(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Drive Analytics").assertIsDisplayed()
        assertTrue(refreshed)
    }

    private companion object {
        // A fixed "today" so the default trailing-30-day range covers the sample drives deterministically.
        private val TODAY: Long = LocalDate.parse("2026-04-20").toEpochDay()
    }
}
