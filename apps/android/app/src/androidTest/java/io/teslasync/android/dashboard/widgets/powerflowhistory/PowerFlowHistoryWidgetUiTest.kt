package io.teslasync.android.dashboard.widgets.powerflowhistory

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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
 * Instrumented Compose tests for the Power Flow History surface — every state from the web source
 * rendered on a device (connectedAndroidTest): loading skeleton, the title-less "No Tesla Energy site
 * linked" surface, the linked-site "No power flow data" surface, hard error + retry, standard content
 * (stat row + chart + channel legend), the compact stats-only branch, and the stale/offline content
 * path. The pure projection/state-machine logic is covered no-device by [PowerFlowHistoryProjectionTest]
 * and [PowerFlowHistoryWidgetViewModelTest]; these assert the surfaces render their copy and expose
 * accessible names. Strings resolve from the real i18n catalog.
 */
class PowerFlowHistoryWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun samples(): List<PowerFlowSample> =
        listOf(
            PowerFlowSample(timeLabel = "08:00", solarKw = 2.5, batteryKw = 1.0, gridKw = -0.5, homeKw = 1.5),
            PowerFlowSample(timeLabel = "09:00", solarKw = 3.0, batteryKw = 0.5, gridKw = -1.0, homeKw = 2.0),
        )

    private fun content(): PowerFlowHistorySnapshot = PowerFlowHistorySnapshot.ofSamples(samples())

    private fun render(
        state: UiState<PowerFlowHistorySnapshot>,
        size: PowerFlowHistorySize = PowerFlowHistoryRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme {
                Host {
                    PowerFlowHistoryWidgetContent(state = state, size = size, onRefresh = onRefresh)
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
    fun noSiteStateShowsNoSiteMessage() {
        render(UiState(UiPhase.Empty, data = PowerFlowHistorySnapshot.NO_SITES, fetchedAt = 0L))
        rule.onNodeWithText("No Tesla Energy site linked").assertIsDisplayed()
    }

    @Test
    fun noDataStateShowsNoPowerFlowDataMessage() {
        render(UiState(UiPhase.Content, data = PowerFlowHistorySnapshot.ofSamples(emptyList()), fetchedAt = NOW))
        rule.onNodeWithText("No power flow data").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresIt() {
        var retried = false
        render(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRefresh = { retried = true })
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentStateShowsTitleStatsAndRefresh() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW))
        rule.onNodeWithText("Power Flow History").assertIsDisplayed()
        rule.onNodeWithText("Avg Solar").assertIsDisplayed()
        rule.onNodeWithText("Peak Home").assertIsDisplayed()
        rule.onNodeWithText("Net Grid").assertIsDisplayed()
        // The only interactive element carries a screen-reader name.
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun contentStateShowsChannelLegend() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW))
        rule.onNodeWithText("Solar").assertIsDisplayed()
        rule.onNodeWithText("Battery").assertIsDisplayed()
        rule.onNodeWithText("Grid").assertIsDisplayed()
        rule.onNodeWithText("Home").assertIsDisplayed()
    }

    @Test
    fun compactStateShowsStatsWithoutTitleOrNetGrid() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW), size = PowerFlowHistorySize(1, 4))
        rule.onNodeWithText("Avg Solar").assertIsDisplayed()
        rule.onNodeWithText("Peak Home").assertIsDisplayed()
        rule.onNodeWithText("Power Flow History").assertDoesNotExist()
        rule.onNodeWithText("Net Grid").assertDoesNotExist()
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
        rule.onNodeWithText("Avg Solar").assertIsDisplayed()
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
