package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
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
import io.teslasync.shared.core.api.generated.ChargingSession
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.time.Instant

/**
 * Instrumented Compose tests for the Charge Session Chart surface — every state from the web source
 * rendered on a device (connectedAndroidTest): loading skeleton, outer empty, hard error + retry,
 * standard content (stat row + chart + legend), the compact stats-only branch, and the stale/offline
 * content path. The pure projection/state-machine logic is covered no-device by
 * [ChargeSessionChartWidgetTest]; these assert the surfaces render their copy and expose accessible
 * names. Strings resolve from the real i18n catalog.
 */
class ChargeSessionChartWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun sessions(): List<ChargingSession> =
        listOf(
            ChargingSession(
                id = 1,
                startedAt = Instant.parse("2024-06-11T10:00:00Z"),
                vehicleId = 7,
                chargerType = "Tesla Supercharger",
                totalEnergyAddedWh = 30_000.0,
            ),
            ChargingSession(
                id = 2,
                startedAt = Instant.parse("2024-06-12T10:00:00Z"),
                vehicleId = 7,
                chargerType = "CCS",
                totalEnergyAddedWh = 20_000.0,
            ),
        )

    private fun render(
        state: UiState<List<ChargingSession>>,
        size: ChargeSessionChartSize = ChargeSessionChartSize(2, 4),
        onRetry: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme {
                Host {
                    ChargeSessionChartWidgetContent(state = state, size = size, onRetry = onRetry)
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
    fun emptyStateShowsNoSessionsMessage() {
        render(UiState(UiPhase.Empty, data = emptyList(), fetchedAt = 0L))
        rule.onNodeWithText("No charge sessions yet").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresIt() {
        var retried = false
        render(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        rule.onNodeWithText("Can't reach server").assertIsDisplayed()
        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun contentStateShowsTitleStatsAndRefresh() {
        render(UiState(UiPhase.Content, data = sessions(), fetchedAt = NOW))
        rule.onNodeWithText("Charge Sessions").assertIsDisplayed()
        rule.onNodeWithText("Total").assertIsDisplayed()
        rule.onNodeWithText("Sessions").assertIsDisplayed()
        // The only interactive element carries a screen-reader name.
        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun contentStateShowsChargerTypeLegend() {
        render(UiState(UiPhase.Content, data = sessions(), fetchedAt = NOW))
        rule.onNodeWithText("Home / AC").assertIsDisplayed()
        rule.onNodeWithText("Supercharger").assertIsDisplayed()
        rule.onNodeWithText("DC Fast").assertIsDisplayed()
    }

    @Test
    fun compactStateShowsStatsWithoutTitle() {
        render(UiState(UiPhase.Content, data = sessions(), fetchedAt = NOW), size = ChargeSessionChartSize(1, 1))
        rule.onNodeWithText("Total").assertIsDisplayed()
        rule.onNodeWithText("Charge Sessions").assertDoesNotExist()
    }

    @Test
    fun staleOfflineStateStillRendersContent() {
        render(
            UiState(
                phase = UiPhase.Content,
                data = sessions(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        rule.onNodeWithText("Total").assertIsDisplayed()
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
