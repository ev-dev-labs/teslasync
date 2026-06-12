package io.teslasync.android.featureviews.sessioncurvechart

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
 * On-device Compose UI + accessibility verification of [SessionCurveChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * chart, and the stale/offline cached view. Asserts the rendered i18n strings, the chart's accessible
 * description (web `ariaLabel`, resolved via the catalog-absent fallback), the two axis-title captions, the
 * subtitle fallback, the accessible data table, and the freshness chip's TalkBack label. The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/charging-curve/SessionCurveChart.tsx).
 */
class SessionCurveChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<CurvePoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SessionCurveChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun curve(): List<CurvePoint> =
        listOf(
            CurvePoint(soc = 20.0, power = 150.0),
            CurvePoint(soc = 50.0, power = 120.5),
            CurvePoint(soc = 80.0, power = 45.0),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Power vs SOC").assertIsDisplayed()
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
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Power vs SOC").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndDataTable() {
        setContent(UiState(UiPhase.Content, data = curve()))
        compose.onNodeWithText("Power vs SOC").assertIsDisplayed()
        compose
            .onNodeWithContentDescription(
                "Charging power versus state-of-charge area chart for the selected session",
            ).assertExists()
        compose.onNodeWithText("Details").assertIsDisplayed()
    }

    @Test
    fun contentRendersAxisCaptionsAndSubtitleFallback() {
        setContent(UiState(UiPhase.Content, data = curve()))
        compose.onNodeWithText("Charging power curve for selected session").assertIsDisplayed()
        compose.onNodeWithText("SOC (%)").assertIsDisplayed()
        compose.onNodeWithText("Power (kW)").assertIsDisplayed()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = curve(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Power vs SOC").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = curve(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Power vs SOC").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
