package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertExists
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
 * Instrumented Compose tests for the Battery Cells surface — every state from the web source rendered
 * on a device (connectedAndroidTest): loading skeleton, outer empty, hard error + retry, content
 * (standard + wide), and the stale/offline content path. The pure parse/projection/state-machine
 * logic is covered no-device by [BatteryCellsWidgetTest]; these assert the surfaces render their copy
 * and expose accessible names. Strings resolve from the real i18n catalog.
 */
class BatteryCellsWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private fun summary(): BatteryCellSummary =
        BatteryCellSummary(
            avgVoltage = 3.700,
            minVoltage = 3.650,
            maxVoltage = 3.750,
            voltageSpread = 0.012,
            avgTemperature = 25.0,
            minTemperature = 22.0,
            maxTemperature = 28.0,
            tempSpread = 6.0,
            totalCells = 2,
            cells = listOf(BatteryCell(1, 0, 3.700, 25.0), BatteryCell(2, 1, 3.710, 26.0)),
        )

    private fun render(
        state: UiState<BatteryCellSummary?>,
        size: BatteryCellsSize = BatteryCellsSize(2, 4),
        onRetry: () -> Unit = {},
    ) {
        rule.setContent {
            TeslaSyncTheme {
                Host {
                    BatteryCellsWidgetContent(state = state, size = size, onRetry = onRetry)
                }
            }
        }
    }

    @Test
    fun loadingStateExposesAccessibleSurfaceLabel() {
        render(UiState(UiPhase.Loading))
        rule.onNodeWithContentDescription("Battery Cells").assertExists()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        render(UiState(UiPhase.Empty, data = null, fetchedAt = 0L))
        rule.onNodeWithText("No battery cell data").assertIsDisplayed()
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
    fun contentStateShowsHeatmapTilesAndVoltageStats() {
        render(UiState(UiPhase.Content, data = summary(), fetchedAt = NOW))
        rule.onNodeWithText("Battery Cells").assertExists()
        rule.onNodeWithText("Min V").assertIsDisplayed()
        rule.onNodeWithText("Spread").assertIsDisplayed()
        rule.onNodeWithText("12.0 mV").assertIsDisplayed()
        // Each heatmap tile is a single accessibility node (label + value).
        rule.onNodeWithContentDescription("C1, 3.700 V").assertExists()
    }

    @Test
    fun wideContentStateShowsModuleLabelsAndTemperatureStats() {
        render(UiState(UiPhase.Content, data = summary(), fetchedAt = NOW), size = BatteryCellsSize(3, 4))
        rule.onNodeWithText("Min Temp").assertIsDisplayed()
        rule.onNodeWithContentDescription("Cell 1 \u00B7 M0, 3.700 V / 25.0\u00B0").assertExists()
    }

    @Test
    fun staleOfflineStateStillRendersContent() {
        render(
            UiState(
                phase = UiPhase.Content,
                data = summary(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )
        rule.onNodeWithText("Min V").assertIsDisplayed()
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
