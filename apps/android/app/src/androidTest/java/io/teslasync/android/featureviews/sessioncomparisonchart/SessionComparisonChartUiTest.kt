package io.teslasync.android.featureviews.sessioncomparisonchart

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
import java.time.ZoneOffset
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [SessionComparisonChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * overlay with its axis titles + date-swatch legend, and the stale/offline cached views. Asserts the rendered
 * i18n strings and the TalkBack content descriptions (the always-visible title, the legend swatch labels, the
 * freshness chip). The offline gate's `testReleaseUnitTest` covers the pure projection; this covers render +
 * a11y. Mirrors the web spec
 * (web/src/features/charging/components/charging-curve/SessionComparisonChart.tsx).
 */
class SessionComparisonChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<ChargingCurveSession>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SessionComparisonChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                    zoneId = ZoneOffset.UTC,
                )
            }
        }
    }

    private fun sessions(): List<ChargingCurveSession> =
        listOf(
            ChargingCurveSession(
                id = 1,
                startedAt = "2026-04-03T07:30:00Z",
                chargerType = null,
                peakPowerW = 11_000.0,
                startSocPct = 40.0,
                endSocPct = 80.0,
            ),
            ChargingCurveSession(
                id = 2,
                startedAt = "2026-04-04T21:15:00Z",
                chargerType = "Tesla",
                peakPowerW = 250_000.0,
                startSocPct = 10.0,
                endSocPct = 90.0,
            ),
        )

    @Test
    fun loadingShowsAlwaysVisibleTitleAndSubtitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Session Comparison").assertIsDisplayed()
        compose.onNodeWithText("Power curves overlaid from last 10 sessions").assertIsDisplayed()
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
    fun emptyShowsTitleAndNoSessionsMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Session Comparison").assertIsDisplayed()
        compose.onNodeWithText("No charging sessions to plot a curve.").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAxisTitlesAndAccessibleLegendLabels() {
        setContent(UiState(UiPhase.Content, data = sessions()))
        compose.onNodeWithText("Session Comparison").assertIsDisplayed()
        compose.onNodeWithText("Power (kW)").assertIsDisplayed()
        compose.onNodeWithText("SOC (%)").assertIsDisplayed()
        compose.onNodeWithContentDescription("Apr 3").assertExists()
        compose.onNodeWithContentDescription("Apr 4").assertExists()
    }

    @Test
    fun offlineShowsCachedOverlayWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sessions(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Session Comparison").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = sessions(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Session Comparison").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
