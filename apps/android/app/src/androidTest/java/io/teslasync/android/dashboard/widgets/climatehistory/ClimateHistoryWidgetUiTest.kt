package io.teslasync.android.dashboard.widgets.climatehistory

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
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose tests for the Climate History surface — every state from the web source rendered
 * on a device (connectedAndroidTest): the loading skeleton's accessible label, the "No climate history"
 * empty state, the standard content (title + Cabin/Outside stats + chart), the compact stats-only branch,
 * the hard-error path (no blanked panel — the empty body keeps its refresh), and the stale/offline content
 * path. The pure projection/state-machine logic is covered off-device by [ClimateHistoryProjectionTest]
 * and [ClimateHistoryWidgetViewModelTest]; these assert the surfaces render their copy and expose
 * accessible names. Strings resolve from the real i18n catalog.
 */
class ClimateHistoryWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun samples(): List<ClimateSample> =
        listOf(
            ClimateSample("2024-06-11T08:00:00Z", insideC = 21.0, outsideC = 14.0),
            ClimateSample("2024-06-11T09:00:00Z", insideC = 22.0, outsideC = 16.0),
        )

    private fun content(): ClimateHistorySnapshot = ClimateHistorySnapshot.ofSamples(samples())

    private fun render(
        state: UiState<ClimateHistorySnapshot>,
        size: ClimateHistorySize = ClimateHistoryRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme {
                Host {
                    ClimateHistoryWidgetContent(
                        state = state,
                        formatter = UnitFormatter.default(),
                        size = size,
                        onRefresh = onRefresh,
                    )
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
    fun emptyStateShowsNoClimateHistory() {
        render(UiState(UiPhase.Empty, data = ClimateHistorySnapshot.EMPTY, fetchedAt = NOW))
        rule.onNodeWithText("No climate history").assertIsDisplayed()
    }

    @Test
    fun contentStateShowsTitleAndRefresh() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW))
        rule.onNodeWithText("Climate History").assertIsDisplayed()
        // The only interactive element carries a screen-reader name.
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
        rule.onNodeWithText("No climate history").assertDoesNotExist()
    }

    @Test
    fun contentStateShowsCabinAndOutsideSeries() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW))
        // Cabin / Outside appear in both the stat row and the chart legend.
        rule.onAllNodesWithText("Cabin").onFirst().assertIsDisplayed()
        rule.onAllNodesWithText("Outside").onFirst().assertIsDisplayed()
    }

    @Test
    fun compactStateShowsStatsWithoutTitle() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW), size = ClimateHistorySize(1, 4))
        rule.onNodeWithText("Cabin").assertIsDisplayed()
        rule.onNodeWithText("Outside").assertIsDisplayed()
        rule.onNodeWithText("Climate History").assertDoesNotExist()
    }

    @Test
    fun errorStateShowsEmptyBodyAndRefresh() {
        var retried = false
        render(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        rule.onNodeWithText("No climate history").assertIsDisplayed()
        rule.onNodeWithContentDescription("Refresh").performClick()
        assertTrue(retried)
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
        rule.onNodeWithText("Climate History").assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
