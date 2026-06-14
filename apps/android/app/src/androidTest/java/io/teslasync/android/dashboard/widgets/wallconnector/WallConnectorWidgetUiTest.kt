package io.teslasync.android.dashboard.widgets.wallconnector

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
 * Instrumented Compose tests for the Wall Connector surface — every state from the web source rendered on
 * a device (connectedAndroidTest): loading skeleton, the title-less "No Tesla Energy site linked"
 * surface, the linked-site "No Wall Connector data" surface, hard error + retry, standard content (This
 * Month / Sessions / Avg / Session stat row + bar chart), the compact stats-only branch, and the
 * stale/offline content path. The pure projection/state-machine logic is covered no-device by
 * [WallConnectorProjectionTest] and [WallConnectorWidgetViewModelTest]; these assert the surfaces render
 * their copy and expose accessible names. Strings resolve from the real i18n catalog.
 */
class WallConnectorWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun days(): List<WallConnectorDayPoint> =
        listOf(
            WallConnectorDayPoint(dateKey = "2024-06-10", label = "6/10", energyKwh = 2.0),
            WallConnectorDayPoint(dateKey = "2024-06-11", label = "6/11", energyKwh = 4.0),
        )

    private fun content(): WallConnectorSnapshot =
        WallConnectorSnapshot.ofData(days = days(), monthTotalKwh = 12.5, monthSessions = 3, avgKwhPerSession = 4.0)

    private fun render(
        state: UiState<WallConnectorSnapshot>,
        size: WallConnectorSize = WallConnectorRegistration.defaultSize,
        onRefresh: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme {
                Host {
                    WallConnectorWidgetContent(state = state, size = size, onRefresh = onRefresh)
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
        render(UiState(UiPhase.Empty, data = WallConnectorSnapshot.NO_SITES, fetchedAt = 0L))
        rule.onNodeWithText("No Tesla Energy site linked").assertIsDisplayed()
    }

    @Test
    fun noDataStateShowsNoWallConnectorDataMessage() {
        render(
            UiState(
                UiPhase.Content,
                data = WallConnectorSnapshot.ofData(emptyList(), 0.0, 0, 0.0),
                fetchedAt = NOW,
            ),
        )
        rule.onNodeWithText("No Wall Connector data").assertIsDisplayed()
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
        rule.onNodeWithText("Wall Connector").assertIsDisplayed()
        rule.onNodeWithText("This Month").assertIsDisplayed()
        rule.onNodeWithText("Sessions").assertIsDisplayed()
        rule.onNodeWithText("Avg / Session").assertIsDisplayed()
        // The only interactive element carries a screen-reader name.
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun compactStateShowsStatsWithoutTitleOrAvg() {
        render(UiState(UiPhase.Content, data = content(), fetchedAt = NOW), size = WallConnectorSize(1, 4))
        rule.onNodeWithText("This Month").assertIsDisplayed()
        rule.onNodeWithText("Sessions").assertIsDisplayed()
        rule.onNodeWithText("Wall Connector").assertDoesNotExist()
        rule.onNodeWithText("Avg / Session").assertDoesNotExist()
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
        rule.onNodeWithText("This Month").assertIsDisplayed()
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
