package io.teslasync.android.featureviews.overviewtab

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.DistanceUnitPref
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [OverviewTabContent] across every state the surface
 * renders: the loading chart-skeleton chrome, the hard-error retry surface, the per-section empty states,
 * the populated charts with their legends, the always-present Quick Links (label + tap navigation), and the
 * stale/offline cached views. Asserts the rendered i18n strings and the TalkBack content descriptions. The
 * offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web
 * spec (web/src/features/analytics/components/analytics/OverviewTab.tsx).
 */
class OverviewTabUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<OverviewData>,
        onRetry: () -> Unit = {},
        onNavigate: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                OverviewTabContent(
                    state = state,
                    distanceUnit = DistanceUnitPref.KM,
                    onRetry = onRetry,
                    onNavigate = onNavigate,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun data(): OverviewData =
        OverviewData(
            vehicles =
                listOf(
                    OverviewVehicle(name = "Model 3", distanceKm = 1240.0),
                    OverviewVehicle(name = "Model Y", distanceKm = 980.5),
                ),
            dayOfWeek =
                listOf(
                    DayOfWeekPoint(day = "Mon", drives = 8, avgDistanceKm = 24.0),
                    DayOfWeekPoint(day = "Tue", drives = 6, avgDistanceKm = 18.5),
                ),
            monthly =
                listOf(
                    MonthlyCostPoint(month = "Jan", cost = 42.0, gasCost = 120.0, savings = 78.0),
                    MonthlyCostPoint(month = "Feb", cost = 38.5, gasCost = 110.0, savings = 71.5),
                ),
        )

    @Test
    fun loadingShowsTitledSkeletonChromeAndStaticQuickLinks() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Distance by Vehicle").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Loading").onFirst().assertIsDisplayed()
        // Quick Links is static — present even while the charts load.
        compose.onNodeWithText("Quick Links").assertExists()
        compose.onNodeWithContentDescription("statistics").assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
        compose.onNodeWithText("Quick Links").assertExists()
    }

    @Test
    fun emptyShowsEveryPerSectionEmptyStateAndQuickLinks() {
        setContent(UiState(UiPhase.Content, data = OverviewData()))
        compose.onNodeWithText("No vehicle data").assertExists()
        compose.onNodeWithText("No day-of-week data").assertExists()
        compose.onNodeWithText("No monthly data").assertExists()
        compose.onNodeWithText("Quick Links").assertExists()
    }

    @Test
    fun contentRendersTitlesAndAccessibleLegendLabels() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText("Distance by Vehicle").assertIsDisplayed()
        compose.onNodeWithContentDescription("Drives").assertExists()
        compose.onNodeWithContentDescription("Avg Distance").assertExists()
        compose.onNodeWithContentDescription("Electric Cost").assertExists()
        compose.onNodeWithContentDescription("Gas Cost").assertExists()
        compose.onNodeWithContentDescription("Savings").assertExists()
    }

    @Test
    fun quickLinkTapNavigatesToItsRoute() {
        var navigated: String? = null
        setContent(state = UiState(UiPhase.Content, data = OverviewData()), onNavigate = { navigated = it })
        compose.onNodeWithContentDescription("statistics").performClick()
        assertEquals("/statistics", navigated)
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Distance by Vehicle").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = data(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Distance by Vehicle").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
