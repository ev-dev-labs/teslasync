package io.teslasync.android.dashboard.widgets.motorhistory

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
import io.teslasync.shared.core.units.TemperatureUnitPref
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [MotorHistoryWidgetContent] across every state
 * the web component renders (loading skeleton, hard error + retry, the Torque/Stator stat row + chart,
 * the friendly empty state, the compact stats-only footprint, the wide g-force legend, and the
 * stale/offline cached path). Asserts the rendered i18n strings and the TalkBack content descriptions
 * are present. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the
 * pure logic, this covers the render + a11y.
 */
class MotorHistoryWidgetUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<MotorHistorySnapshot>,
        size: MotorHistorySize = MotorHistoryRegistration.defaultSize,
        temperatureUnit: TemperatureUnitPref = TemperatureUnitPref.CELSIUS,
        onRefresh: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    MotorHistoryWidgetContent(
                        state = state,
                        size = size,
                        onRefresh = onRefresh,
                        temperatureUnit = temperatureUnit,
                    )
                }
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonChrome() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(
            state = UiState(UiPhase.Error, errorKind = ErrorKind.Network),
            onRefresh = { retried = true },
        )
        compose.onNodeWithText("Can't reach server").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyMessage() {
        setContent(UiState(UiPhase.Empty, data = MotorHistorySnapshot.EMPTY, fetchedAt = NOW))
        compose.onNodeWithText("No motor history").assertIsDisplayed()
    }

    @Test
    fun contentShowsTitleStatsAndRefresh() {
        setContent(UiState(UiPhase.Content, data = sampleSnapshot(), fetchedAt = NOW))
        compose.onNodeWithText("Motor History").assertIsDisplayed()
        // The torque stat's unit token is unique on screen (the legend lists labels, not units).
        compose.onNodeWithText("Nm").assertIsDisplayed()
        // The header refresh control exposes an accessible name (TalkBack).
        compose.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideFootprintShowsGForceLegend() {
        setContent(
            state = UiState(UiPhase.Content, data = sampleSnapshot(), fetchedAt = NOW),
            size = MotorHistorySize(cols = 4, rows = 6),
        )
        // The lateral / longitudinal overlays appear only on the wide footprint (web `isWide`).
        compose.onNodeWithText("Lateral G").assertIsDisplayed()
        compose.onNodeWithText("Long. G").assertIsDisplayed()
    }

    @Test
    fun compactFootprintShowsStatsOnlyWithoutTitle() {
        setContent(
            state = UiState(UiPhase.Content, data = sampleSnapshot(), fetchedAt = NOW),
            size = MotorHistorySize(cols = 1, rows = 4),
        )
        // The compact branch keeps the stat unit but drops the title + chart (web `chart={null}`).
        compose.onNodeWithText("Nm").assertIsDisplayed()
        compose.onNodeWithText("Motor History").assertDoesNotExist()
    }

    @Test
    fun offlineKeepsCachedContentVisible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = sampleSnapshot(),
                fetchedAt = NOW,
                stale = true,
                errorKind = ErrorKind.Timeout,
            ),
        )
        // Cached stats stay visible (never blanked) when offline/stale.
        compose.onNodeWithText("Nm").assertIsDisplayed()
    }

    /** Two timestamped samples, each with a torque + stator reading and the g-force overlays. */
    private fun sampleSnapshot(): MotorHistorySnapshot =
        MotorHistorySnapshot(
            listOf(
                row("2024-01-15T10:00:00Z", torque = 120.0, stator = 50.0, lateralG = 0.10, longG = 0.20),
                row("2024-01-15T10:01:00Z", torque = 240.0, stator = 65.0, lateralG = 0.30, longG = 0.40),
            ),
        )

    @Suppress("LongParameterList")
    private fun row(
        ts: String,
        torque: Double,
        stator: Double,
        lateralG: Double,
        longG: Double,
    ): JsonObject =
        buildJsonObject {
            put("ts", ts)
            put("di_torque", torque)
            put("di_stator_temp", stator)
            put("lateral_accel", lateralG)
            put("longitudinal_accel", longG)
        }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_780_000_000_000L
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 560.dp
    }
}
