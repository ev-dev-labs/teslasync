package io.teslasync.android.featureviews.statortempchart

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.TemperatureUnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [StatorTempChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the
 * insufficient-sample (web `data.length <= 1`) empty state, the populated three-line chart with its series
 * + threshold legends, and the stale/offline cached views. Asserts the rendered i18n strings and the
 * TalkBack content descriptions (the always-visible title/subtitle, the per-series legend swatch labels,
 * the converted threshold-legend labels, the offline freshness chip). The offline gate's
 * `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx).
 */
class StatorTempChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        state: UiState<List<MotorTempPoint>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                StatorTempChartContent(
                    state = state,
                    onRetry = onRetry,
                    temperatureUnit = TemperatureUnitPref.CELSIUS,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun points(): List<MotorTempPoint> =
        listOf(
            MotorTempPoint(time = "10:00", statorC = 45.0, statorRelC = 42.0, statorRerC = 38.0),
            MotorTempPoint(time = "10:05", statorC = 72.0, statorRelC = 68.0, statorRerC = 61.0),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Stator Temperature History").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Stator Temperature History").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("Stator Temperature History").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun singleSampleRendersEmptyState() {
        // The web `if (data.length <= 1) return null` guard maps to the empty state (never hidden).
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = listOf(MotorTempPoint(time = "10:00", statorC = 45.0, statorRelC = 42.0, statorRerC = 38.0)),
            ),
        )
        compose.onNodeWithText("Stator Temperature History").assertIsDisplayed()
        compose.onNodeWithText("No data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleSubtitleAndAccessibleSeriesAndThresholdLegends() {
        setContent(UiState(UiPhase.Content, data = points()))
        compose.onNodeWithText("Stator Temperature History").assertIsDisplayed()
        compose.onNodeWithText("Motor stator temperature over recent snapshots").assertIsDisplayed()
        // Series legend swatches carry their unit-suffixed name as a TalkBack description (web `<Line name>`).
        compose.onNodeWithContentDescription("Stator Temp (°C)").assertExists()
        compose.onNodeWithContentDescription("Rear-Left Stator Temp (°C)").assertExists()
        compose.onNodeWithContentDescription("Rear-Right Stator Temp (°C)").assertExists()
        // Threshold legend (the native ReferenceLine adaptation) carries the converted guide values.
        compose.onNodeWithContentDescription("Normal 60.0°C").assertExists()
        compose.onNodeWithContentDescription("Warm 80.0°C").assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = points(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Stator Temperature History").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = points(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Stator Temperature History").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
