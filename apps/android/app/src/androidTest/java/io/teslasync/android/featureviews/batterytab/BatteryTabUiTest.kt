// On-device Compose UI + accessibility verification of [BatteryTabContent] across every state the surface
// renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated tab
// (metric cards + four trend charts), and the stale/offline cached view. Asserts the rendered i18n strings,
// the charts' accessible descriptions, the data-table affordance, and the freshness chip's TalkBack label.
// The offline gate's `testReleaseUnitTest` covers the pure projection; this covers render + a11y. Mirrors
// the web spec (web/src/features/analytics/components/analytics/BatteryTab.tsx).
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterytab

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
import java.util.Locale

class BatteryTabUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<BatteryTrendPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryTabContent(
                    state = state,
                    onRetry = onRetry,
                    formatter = UnitFormatter.default(),
                    locale = Locale.US,
                )
            }
        }
    }

    private fun trend(): List<BatteryTrendPoint> =
        listOf(
            BatteryTrendPoint("2026-03-01", 98.0, 74_000.0, 1.5, 470.0, 150.0),
            BatteryTrendPoint("2026-04-01", 97.5, 73_000.0, 2.25, 455.0, 168.0),
        )

    @Test
    fun loadingShowsLoadingChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertExists()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No battery trend data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersCardsChartTitlesAccessibleDescriptionsAndDataTables() {
        setContent(UiState(UiPhase.Content, data = trend()))
        compose.onNodeWithText("Health Score").assertExists()
        compose.onNodeWithText("Est. Range").assertExists()
        compose.onNodeWithText("Health Score Timeline").assertExists()
        compose.onNodeWithText("Capacity Trend").assertExists()
        compose.onNodeWithText("Range Trend").assertExists()
        compose.onNodeWithText("Degradation & Cycles").assertExists()
        compose.onNodeWithContentDescription("Health Score Timeline: Health %").assertExists()
        compose.onNodeWithContentDescription("Degradation & Cycles: Degradation %, Cycle Count").assertExists()
        assertTrue(compose.onAllNodesWithText("Details").fetchSemanticsNodes().isNotEmpty())
    }

    @Test
    fun offlineShowsCachedContentWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = trend(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Health Score").assertExists()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = trend(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Health Score").assertExists()
        assertTrue(refreshed)
    }
}
