package io.teslasync.android.featureviews.recentactivity

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
 * On-device Compose UI + accessibility verification of [RecentActivityContent] across every state the surface
 * renders: the loading chrome, the hard-error retry surface, the no-data empty state (each panel keeps its
 * own friendly empty branch), the populated three-panel grid, and the stale/offline cached view. Asserts the
 * rendered i18n strings, the interactive affordances (the "View all" link + the retry button), and the
 * freshness chip's "Offline" label. The offline gate's `testReleaseUnitTest` covers the pure logic; this
 * covers render + a11y. Mirrors the web spec (web/src/features/dashboard/components/RecentActivity.tsx).
 */
class RecentActivityUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val display = RecentActivityDisplay(currencySymbol = "$", precision = 2, locale = Locale.US)
    private val now = 1_700_000_000_000L

    private fun sampleData(): RecentActivityData =
        RecentActivityData(
            drives =
                listOf(
                    RecentActivityDrive(
                        distanceM = 42_000.0,
                        durationS = 3_900L,
                        startSocPct = 82.0,
                        endSocPct = 68.0,
                        startedAtMillis = now - 600_000L,
                    ),
                    RecentActivityDrive(
                        distanceM = 12_500.0,
                        durationS = 1_500L,
                        startSocPct = 68.0,
                        endSocPct = 61.0,
                        startedAtMillis = now - 7_200_000L,
                    ),
                    RecentActivityDrive(
                        distanceM = 88_000.0,
                        durationS = 6_300L,
                        startSocPct = 95.0,
                        endSocPct = 70.0,
                        startedAtMillis = now - 90_000_000L,
                    ),
                ),
            charges =
                listOf(
                    RecentActivityCharge(
                        totalEnergyAddedWh = 23_400.0,
                        startSocPct = 61.0,
                        endSocPct = 90.0,
                        cost = 7.42,
                        startedAtMillis = now - 3_600_000L,
                    ),
                ),
            analytics =
                RecentActivityAnalytics(
                    totalDrives = 128,
                    totalChargingSessions = 36,
                    totalCost = 214.5,
                    totalEnergyKwh = 940.0,
                    mostEfficient = MostEfficientVehicle(name = "Model 3 LR", efficiencyWhPerKm = 148.0),
                ),
        )

    private fun setContent(
        state: UiState<RecentActivityData>,
        onRetry: () -> Unit = {},
        onViewAllDrives: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RecentActivityContent(
                    state = state,
                    onRetry = onRetry,
                    onViewAllDrives = onViewAllDrives,
                    display = display,
                    nowMillis = now,
                )
            }
        }
    }

    @Test
    fun loadingShowsSkeletonChromeNotContentOrError() {
        setContent(UiState(UiPhase.Loading))

        compose.onNodeWithText("Fleet Performance").assertDoesNotExist()
        compose.onNodeWithText("Recent Activity").assertDoesNotExist()
        compose.onNodeWithText("Retry").assertDoesNotExist()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })

        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyRendersEveryPanelWithItsFriendlyEmptyState() {
        setContent(UiState(UiPhase.Empty, data = RecentActivityData()))

        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        compose.onNodeWithText("No activity yet. Start driving!").assertIsDisplayed()
        compose.onNodeWithText("Fleet Performance").assertIsDisplayed()
        compose.onNodeWithText("Total Drives (30d)").assertIsDisplayed()
    }

    @Test
    fun contentRendersAllThreePanelTitlesAndStats() {
        setContent(UiState(UiPhase.Content, data = sampleData()))

        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        compose.onNodeWithText("Battery Health").assertIsDisplayed()
        compose.onNodeWithText("Fleet Performance").assertIsDisplayed()
        compose.onNodeWithText("Total Cost").assertIsDisplayed()
        compose.onNodeWithText("Most Efficient").assertIsDisplayed()
    }

    @Test
    fun viewAllAffordanceInvokesItsCallback() {
        var viewedAll = false
        setContent(state = UiState(UiPhase.Content, data = sampleData()), onViewAllDrives = { viewedAll = true })

        compose.onNodeWithText("View all").performClick()
        assertTrue(viewedAll)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sampleData(),
                stale = true,
                fetchedAt = now,
                errorKind = ErrorKind.Network,
            ),
        )

        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        compose.onNodeWithText("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sampleData(),
                    stale = true,
                    fetchedAt = now,
                ),
            onRetry = { refreshed = true },
        )

        compose.waitForIdle()
        compose.onNodeWithText("Recent Activity").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
