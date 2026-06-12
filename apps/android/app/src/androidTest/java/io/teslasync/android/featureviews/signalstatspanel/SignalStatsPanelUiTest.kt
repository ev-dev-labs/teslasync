package io.teslasync.android.featureviews.signalstatspanel

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
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [SignalStatsPanelContent] across every state the surface
 * renders: the loading skeleton chrome, the hard-error retry surface, the no-data empty state (with the title header
 * still visible — never a blank box), the populated five-column table (title, headers, series-colored signal names,
 * formatted figures), the selected-signal stand-in rows + "Hide empty (N)" toggle behaviour, and the
 * stale/offline cached views. Asserts the rendered i18n strings and the TalkBack content descriptions (the accessible
 * loading label, the offline freshness chip). The offline gate's `testReleaseUnitTest` covers the pure logic; this
 * covers render + a11y. Locale.US fixes the numeric formatting so the string assertions are deterministic. Mirrors
 * the web spec (web/src/features/telemetry/components/SignalStatsPanel.tsx).
 */
class SignalStatsPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun populated(): SignalStatsInput =
        SignalStatsInput(
            stats =
                listOf(
                    SignalStat(signal = "VehicleSpeed", min = 0.0, max = 120.5, avg = 47.34, count = 1820),
                    SignalStat(signal = "BatteryLevel", min = 18.0, max = 92.0, avg = 64.41, count = 1820),
                ),
        )

    private fun withGap(): SignalStatsInput = populated().copy(selectedSignals = listOf("VehicleSpeed", "BatteryLevel", "TpmsPressureFl"))

    private fun setContent(
        state: UiState<SignalStatsInput>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SignalStatsPanelContent(state = state, onRetry = onRetry, locale = Locale.US)
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
        compose.onNodeWithText("Stats Summary").assertIsDisplayed()
        // … above the friendly empty message.
        compose.onNodeWithText("No stats available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleHeadersAndFormattedRows() {
        setContent(UiState(UiPhase.Content, data = populated()))
        compose.onNodeWithText("Stats Summary").assertIsDisplayed()
        // Column headers.
        compose.onNodeWithText("Signal").assertIsDisplayed()
        compose.onNodeWithText("Avg").assertIsDisplayed()
        // Series-colored signal names + formatted figures (unique values to avoid ambiguous matches).
        compose.onAllNodesWithText("VehicleSpeed").assertCountEquals(1)
        compose.onAllNodesWithText("120.50").assertCountEquals(1) // VehicleSpeed max via fmtNumber
        compose.onAllNodesWithText("47.34").assertCountEquals(1) // VehicleSpeed avg
    }

    @Test
    fun selectedGapShowsStandInRowAndHideEmptyTogglesItAway() {
        setContent(UiState(UiPhase.Content, data = withGap()))
        // The gap signal renders as a stand-in row with the "No data in range" subtitle.
        compose.onAllNodesWithText("TpmsPressureFl").assertCountEquals(1)
        compose.onAllNodesWithText("No data in range").assertCountEquals(1)
        // The "Hide empty (N)" toggle is offered because there is one empty row …
        compose.onNodeWithText("Hide empty (1)").assertIsDisplayed().performClick()
        compose.waitForIdle()
        // … and toggling it collapses the stand-in row.
        compose.onAllNodesWithText("No data in range").assertCountEquals(0)
        compose.onAllNodesWithText("TpmsPressureFl").assertCountEquals(0)
    }

    @Test
    fun offlineShowsCachedPanelWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = populated(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Stats Summary").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertIsDisplayed()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = populated(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Stats Summary").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
