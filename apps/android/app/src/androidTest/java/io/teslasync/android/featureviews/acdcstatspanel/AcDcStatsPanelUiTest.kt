package io.teslasync.android.featureviews.acdcstatspanel

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
 * On-device Compose UI + accessibility verification of [AcDcStatsPanelContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state (with the title
 * header still visible — never a blank box), the populated panel (title, energy-split bar, eight-column stats
 * table, free-charged footer), and the stale/offline cached views. Asserts the rendered i18n strings and the
 * TalkBack content descriptions (the accessible loading label, the combined split-bar description, the offline
 * freshness chip). The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y.
 * Locale.US fixes the numeric formatting so the string assertions are deterministic. Mirrors the web spec
 * (web/src/features/charging/components/charging-list/AcDcStatsPanel.tsx).
 */
class AcDcStatsPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun mixed(): AcDcBreakdownData =
        AcDcBreakdownData(
            ac = AcDcBucket(energy = 420.5, cost = 52.3, count = 18, totalDuration = 540.0, freeCount = 2, freeEnergy = 30.0),
            dc = AcDcBucket(energy = 1250.0, cost = 210.75, count = 9, totalDuration = 180.0, freeCount = 0, freeEnergy = 0.0),
            total = AcDcTotals(energy = 1670.5, cost = 263.05, freeEnergy = 30.0, freeCount = 2),
        )

    private fun setContent(
        state: UiState<AcDcBreakdownData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AcDcStatsPanelContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

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
    fun emptyShowsTitleHeaderAndFriendlyNoDataMessage() {
        setContent(UiState(UiPhase.Empty))
        // The title header still renders (never a blank box) …
        compose.onNodeWithText("Charging Stats by Type").assertIsDisplayed()
        // … above the friendly empty message.
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentWithNoSessionsFallsBackToEmptyState() {
        setContent(UiState(UiPhase.Content, data = AcDcBreakdownData()))
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleSplitBarFooterAndAccessibleSplitDescription() {
        setContent(UiState(UiPhase.Content, data = mixed()))
        compose.onNodeWithText("Charging Stats by Type").assertIsDisplayed()
        compose.onNodeWithText("Energy Split (AC vs DC)").assertIsDisplayed()
        // The split-footer captions (distinct from the table cells).
        compose.onNodeWithText("Total: 1.67 MWh").assertIsDisplayed()
        // The free-charged footer (web `total.freeCount > 0`).
        compose.onNodeWithText("2 sessions").assertExists()
        // The bar exposes one combined TalkBack description instead of the decorative per-segment labels.
        compose.onNodeWithContentDescription("AC 25.17%, DC 74.83%").assertExists()
    }

    @Test
    fun contentRendersTableRowsAndDerivedCells() {
        setContent(UiState(UiPhase.Content, data = mixed()))
        // Type column (source-colored labels).
        compose.onNodeWithText("AC Charging").assertExists()
        compose.onNodeWithText("DC Charging").assertExists()
        // Energy column — AC in kWh, DC rolled up to MWh past 1000.
        compose.onNodeWithText("420.50 kWh").assertExists()
        compose.onNodeWithText("1.25 MWh").assertExists()
        // Avg-time + free cells (derived per row).
        compose.onNodeWithText("30m").assertExists()
        compose.onNodeWithText("2 (30.00 kWh)").assertExists()
    }

    @Test
    fun offlineShowsCachedPanelWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = mixed(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Charging Stats by Type").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = mixed(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Charging Stats by Type").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
