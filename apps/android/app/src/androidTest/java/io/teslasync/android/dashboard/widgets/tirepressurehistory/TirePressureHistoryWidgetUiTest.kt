package io.teslasync.android.dashboard.widgets.tirepressurehistory

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the Tire Pressure History surface — every state from the web source
 * rendered on a device (connectedAndroidTest): loading skeleton, the "No tire pressure history" empty
 * surface, hard error + retry, standard content (title + FL/FR/RL/RR stat row + chart + recommended
 * range + corner legend), the compact stats-only branch (no title/chart), and the stale/offline content
 * path. The pure projection/state-machine logic is covered no-device by [TirePressureHistoryProjectionTest],
 * [TirePressureHistorySourceTest], and [TirePressureHistoryWidgetViewModelTest]; these assert the surfaces
 * render their copy and expose accessible names. Strings resolve from the real i18n catalog.
 */
class TirePressureHistoryWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun points(): List<TirePressurePoint> =
        listOf(
            TirePressurePoint("2024-06-11T08:00:00Z", 230000.0, 240000.0, 250000.0, 260000.0),
            TirePressurePoint("2024-06-11T09:00:00Z", 240000.0, 250000.0, 260000.0, 270000.0),
        )

    private fun content(): TirePressureHistorySnapshot = TirePressureHistorySnapshot.of(points())

    private fun render(
        state: UiState<TirePressureHistorySnapshot>,
        size: TirePressureHistorySize = TirePressureHistoryRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme {
                Host {
                    TirePressureHistoryWidgetContent(state = state, size = size, onRefresh = onRefresh)
                }
            }
        }
    }

    @Test
    fun loadingStateExposesAccessibleSurfaceLabel() {
        render(UiState(UiPhase.Loading))
        rule.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoTirePressureHistoryMessage() {
        render(UiState(UiPhase.Empty, data = TirePressureHistorySnapshot.EMPTY, fetchedAt = 0L))
        rule.onNodeWithText("No tire pressure history").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresIt() {
        var retried = false
        render(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentStateShowsTitleStatsRecommendedRangeAndRefresh() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW))
        rule.onNodeWithText("Tire Pressure History").assertIsDisplayed()
        // FL appears in both the stat row and the corner legend.
        rule.onAllNodesWithText("FL").onFirst().assertIsDisplayed()
        rule.onAllNodesWithText("RR").onFirst().assertIsDisplayed()
        // The recommended-range caption carries the Min/Max reference labels.
        rule.onNodeWithText("Min", substring = true).assertIsDisplayed()
        rule.onNodeWithText("Max", substring = true).assertIsDisplayed()
        // The only interactive element carries a screen-reader name.
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactStateShowsStatsWithoutTitle() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW), size = TirePressureHistorySize(1, 4))
        // Compact hides the chart/legend, so each corner label is unique to the stat row.
        rule.onNodeWithText("FL").assertIsDisplayed()
        rule.onNodeWithText("RR").assertIsDisplayed()
        rule.onNodeWithText("Tire Pressure History").assertDoesNotExist()
    }

    @Test
    fun staleOfflineStateStillRendersContent() {
        render(
            UiState(
                phase = UiPhase.Content,
                data = content(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        rule.onAllNodesWithText("FL").onFirst().assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 560.dp
    }
}
