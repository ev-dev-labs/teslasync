package io.teslasync.android.dashboard.widgets.chargingtelemetry

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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [ChargingTelemetryWidgetContent] across
 * every state the web component renders (loading skeleton, not-charging empty, no-telemetry empty,
 * hard error + retry, standard charging grid, wide grid with efficiency + charger badge, the compact
 * hero, and the stale/offline cached path). Asserts the rendered i18n strings and the TalkBack
 * content descriptions are present. Runs under `connectedAndroidTest`; the offline gate's
 * `testReleaseUnitTest` covers the pure logic, this covers the render.
 */
class ChargingTelemetryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun charging(): ChargingTelemetrySnapshot =
        ChargingTelemetrySnapshot(
            chargingState = "Charging",
            chargerVoltage = 250.0,
            chargerActualCurrent = 32.0,
            chargerPowerW = 8.0,
            chargerPhases = 1,
            chargerPilotCurrent = 40.0,
            ts = "2026-06-06T12:00:00Z",
        )

    private fun setContent(
        state: UiState<ChargingTelemetrySnapshot?>,
        size: ChargingTelemetrySize = ChargingTelemetryRegistration.defaultSize,
        powerHistory: List<Double> = emptyList(),
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ChargingTelemetryWidgetContent(
                        state = state,
                        powerHistory = powerHistory,
                        size = size,
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Charging Telemetry").assertIsDisplayed()
    }

    @Test
    fun notChargingShowsFriendlyEmptyMessage() {
        setContent(UiState(UiPhase.Empty, data = stoppedSnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("Not currently charging").assertIsDisplayed()
    }

    @Test
    fun noTelemetryShowsFriendlyEmptyMessage() {
        setContent(UiState(UiPhase.Empty, data = null, fetchedAt = 0L))
        compose.onNodeWithText("Not currently charging").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun standardChargingShowsTitleStatsAndRefresh() {
        setContent(UiState(UiPhase.Content, data = charging(), fetchedAt = NOW))
        compose.onNodeWithText("Charging Telemetry").assertIsDisplayed()
        compose.onNodeWithText("Voltage").assertIsDisplayed()
        compose.onNodeWithText("Power").assertIsDisplayed()
        compose.onNodeWithText("250").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideChargingShowsEfficiencyAndChargerBadge() {
        setContent(
            state = UiState(UiPhase.Content, data = charging(), fetchedAt = NOW),
            size = ChargingTelemetrySize(cols = 4, rows = 4),
            powerHistory = listOf(7.0, 8.0, 8.5),
        )
        compose.onNodeWithText("Efficiency").assertIsDisplayed()
        // 250 V is below the 300 V DC threshold -> AC charger badge.
        compose.onNodeWithContentDescription("AC Charger").assertIsDisplayed()
    }

    @Test
    fun compactHeroExposesPowerAndAccessibleName() {
        setContent(
            state = UiState(UiPhase.Content, data = charging(), fetchedAt = NOW),
            size = ChargingTelemetrySize(cols = 1, rows = 2),
        )
        compose.onNodeWithContentDescription("8.0 kW", substring = true).assertIsDisplayed()
    }

    @Test
    fun offlineKeepsCachedChargingContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = charging(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached stats stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Voltage").assertIsDisplayed()
    }

    private fun stoppedSnapshot(): ChargingTelemetrySnapshot = charging().copy(chargingState = "Stopped")

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 520.dp
    }
}
