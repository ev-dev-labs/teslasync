package io.teslasync.android.featureviews.chartsrow

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
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
 * On-device Compose UI + accessibility verification of [ChartsRowContent] across every state the surface
 * renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated panels
 * (with the trend chart, the accessible donut description, and the per-charger-type cost rows), and the
 * stale/offline cached view. Asserts the rendered i18n strings, the donut's merged accessible description,
 * the cost-row text, and the freshness chip's TalkBack label. The offline gate's `testReleaseUnitTest`
 * covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/charging/components/charging-list/ChartsRow.tsx).
 */
class ChartsRowUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<ChartsRowData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChartsRowContent(state = state, onRetry = onRetry, locale = Locale.US)
            }
        }
    }

    private fun data(): ChartsRowData =
        ChartsRowData(
            energyTrend = listOf(EnergyTrendPoint("Apr 04", 48.0, 12.4)),
            chargerBreakdown =
                listOf(
                    ChargerBreakdownEntry("Supercharger", 6.0),
                    ChargerBreakdownEntry("Home / AC", 9.0),
                ),
            costByType = listOf(CostByTypeEntry("Supercharger", 142.6, 38.2, 0.27)),
        )

    @Test
    fun loadingShowsBothPanelTitlesNotBlankPanels() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Energy & Cost Trend").assertIsDisplayed()
        compose.onNodeWithText("Charger Breakdown").assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose
            .onAllNodesWithText("Something went wrong on our end. Please try again.")
            .onFirst()
            .assertIsDisplayed()
        compose.onAllNodesWithText("Retry").onFirst().performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitlesAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = ChartsRowData()))
        compose.onNodeWithText("Energy & Cost Trend").assertIsDisplayed()
        compose.onNodeWithText("Charger Breakdown").assertExists()
        compose.onAllNodesWithText("No data available").onFirst().assertExists()
    }

    @Test
    fun contentRendersTitlesAccessibleDonutAndCostRow() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText("Energy & Cost Trend").assertIsDisplayed()
        compose.onNodeWithText("Charger Breakdown").assertExists()
        // The donut exposes one merged share description (its TalkBack fallback): "Supercharger (40%), …".
        compose.onNodeWithContentDescription("Supercharger (40%)", substring = true).assertExists()
        // The cost row renders its formatted energy (web fmtWithUnit(_, 'kWh')).
        compose.onNodeWithText("142.60 kWh", substring = true).assertExists()
        compose.onNodeWithText("$38.20 total", substring = true).assertExists()
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
        compose.onNodeWithText("Energy & Cost Trend").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state = UiState(phase = UiPhase.Content, data = data(), stale = true, fetchedAt = 1_700_000_000_000L),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Energy & Cost Trend").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
