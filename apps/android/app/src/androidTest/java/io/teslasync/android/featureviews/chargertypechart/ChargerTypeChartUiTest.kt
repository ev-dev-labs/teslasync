package io.teslasync.android.featureviews.chargertypechart

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
 * On-device Compose UI + accessibility verification of [ChargerTypeChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * chart (with its accessible chart description, data table, series legend, and per-category breakdown), and
 * the stale/offline cached views. Asserts the rendered i18n strings, the chart's accessible description (web
 * `ariaLabel`), the legend swatch labels, the breakdown row description, and the freshness chip's TalkBack
 * label. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors
 * the web spec (web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx).
 */
class ChargerTypeChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<ChargerSession>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChargerTypeChartContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun sessions(): List<ChargerSession> =
        listOf(
            ChargerSession("Tesla", 150_000.0, 48_000.0, "2026-04-04T10:00:00Z", "2026-04-04T10:30:00Z"),
            ChargerSession("ChargePoint", 50_000.0, 22_000.0, "2026-04-06T12:00:00Z", "2026-04-06T12:40:00Z"),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Charge Rate by Charger Type").assertIsDisplayed()
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
        compose.onNodeWithText("Charge Rate by Charger Type").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionLegendAndBreakdown() {
        setContent(UiState(UiPhase.Content, data = sessions()))
        compose.onNodeWithText("Charge Rate by Charger Type").assertIsDisplayed()
        compose
            .onNodeWithContentDescription("Composed bar/line chart of average power and energy per charger type")
            .assertExists()
        compose.onNodeWithText("Details").assertIsDisplayed()
        compose.onNodeWithContentDescription("Avg Power").assertExists()
        compose.onNodeWithContentDescription("Avg Energy").assertExists()
        compose.onNodeWithContentDescription("Supercharger", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sessions(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Charge Rate by Charger Type").assertIsDisplayed()
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
        compose.onNodeWithText("Charge Rate by Charger Type").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
