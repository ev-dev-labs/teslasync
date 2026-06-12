package io.teslasync.android.featureviews.powerprofilechart

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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
 * On-device Compose UI + accessibility verification of [PowerProfileChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state, the populated
 * area chart with its Max Power / Max Regen / Avg footer, and the stale/offline cached view. Asserts the
 * rendered i18n strings, the chart's accessible description (web `ariaLabel`, resolved via the
 * catalog-absent fallback), each footer figure's grouped TalkBack label, and the freshness chip's TalkBack
 * label. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors
 * the web spec (web/src/features/driving/components/drive-detail/PowerProfileChart.tsx).
 */
class PowerProfileChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val ariaLabel = "Drive power profile area chart over time"

    private fun setContent(
        state: UiState<PowerProfileData>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                PowerProfileChartContent(
                    state = state,
                    onRetry = onRetry,
                    syncId = null,
                    locale = Locale.US,
                )
            }
        }
    }

    private fun data(): PowerProfileData =
        PowerProfileData.from(
            points =
                listOf(
                    PowerProfilePoint("09:00", 10.0),
                    PowerProfilePoint("09:05", 80.0),
                    PowerProfilePoint("09:10", -30.0),
                ),
            avgPowerW = 20_000.0,
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText("Power Profile").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndNoTelemetryMessage() {
        setContent(UiState(UiPhase.Empty, data = PowerProfileData.from(emptyList())))
        compose.onNodeWithText("Power Profile").assertIsDisplayed()
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun singleSampleRendersEmptyStateMirroringLengthGreaterThanOne() {
        // The web `chartData.length > 1` boundary: one sample is the empty surface, never a one-point chart.
        setContent(UiState(UiPhase.Content, data = PowerProfileData.from(listOf(PowerProfilePoint("09:00", 10.0)))))
        compose.onNodeWithText("No telemetry data available").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAccessibleChartDescriptionAndFooter() {
        setContent(UiState(UiPhase.Content, data = data()))
        compose.onNodeWithText("Power Profile").assertIsDisplayed()
        compose.onNodeWithContentDescription(ariaLabel).assertExists()
        // Each footer figure is a grouped node whose TalkBack label carries its localized label + value.
        compose.onNodeWithContentDescription("Max Power:", substring = true).assertExists()
        compose.onNodeWithContentDescription("Max Regen:", substring = true).assertExists()
        compose.onNodeWithContentDescription("Avg:", substring = true).assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = data(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText("Power Profile").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = data(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText("Power Profile").assertIsDisplayed()
        assertTrue(refreshed)
    }
}
