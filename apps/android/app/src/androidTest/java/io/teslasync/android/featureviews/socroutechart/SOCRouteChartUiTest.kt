package io.teslasync.android.featureviews.socroutechart

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
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [SOCRouteChartContent] across every state the surface
 * renders: the loading chrome, the hard-error retry surface, the no-curve empty state, the populated chart,
 * and the stale/offline cached view. Asserts the rendered i18n strings, the chart's accessible description
 * (web `ariaLabel`), the accessible fallback data table, the `km` axis caption, the min-arrival threshold
 * legend label (web `Min N%`), the charge-stop marker pin's TalkBack label (web `⚡ Stop N`), and the
 * freshness chip's offline label. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers
 * render + a11y. Mirrors the web spec (web/src/features/driving/components/SOCRouteChart.tsx).
 */
class SOCRouteChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<SOCRouteData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SOCRouteChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun route(): SOCRouteData =
        SOCRouteData(
            socCurve =
                listOf(
                    TripSOCPoint(distanceM = 0.0, soc = 80.0),
                    TripSOCPoint(distanceM = 40_000.0, soc = 55.0),
                    TripSOCPoint(distanceM = 80_000.0, soc = 30.0),
                    TripSOCPoint(distanceM = 120_000.0, soc = 12.0),
                    TripSOCPoint(distanceM = 160_000.0, soc = 60.0),
                ),
            chargeStops = listOf(RouteChargeStop(chargeFromSoc = 30.0)),
            minArrivalSoc = 10.0,
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Battery Along Route").assertIsDisplayed()
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
    fun emptyShowsTitleAndPlanATripMessage() {
        setContent(UiState(UiPhase.Empty, data = SOCRouteData(emptyList(), emptyList(), 10.0)))
        compose.onNodeWithText("Battery Along Route").assertIsDisplayed()
        compose.onNodeWithText("Plan a trip to see the SOC curve").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndDataTable() {
        setContent(UiState(UiPhase.Content, data = route()))
        compose.onNodeWithText("Battery Along Route").assertIsDisplayed()
        compose
            .onNodeWithContentDescription("Planned route battery state-of-charge area chart")
            .assertExists()
        compose.onNodeWithText("Details").assertIsDisplayed()
    }

    @Test
    fun contentRendersAxisCaptionAndMinArrivalLegendLabel() {
        setContent(UiState(UiPhase.Content, data = route()))
        compose.onNodeWithText("km").assertIsDisplayed()
        compose.onNodeWithText("Min 10%").assertIsDisplayed()
    }

    @Test
    fun contentRendersChargeStopMarkerAccessibilityLabel() {
        setContent(UiState(UiPhase.Content, data = route()))
        compose.onNodeWithContentDescription("\u26A1 Stop 1").assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = route(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Battery Along Route").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = route(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Battery Along Route").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
