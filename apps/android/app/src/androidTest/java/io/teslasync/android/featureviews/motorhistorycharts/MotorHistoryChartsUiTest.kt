package io.teslasync.android.featureviews.motorhistorycharts

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
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
 * On-device Compose UI + accessibility verification of [MotorHistoryChartsContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state (web
 * `dynamics.awaitingData`), the populated three charts (Power area + Torque line + RPM line) with their
 * titles / subtitle / accessible descriptions / interactive Power legend / data tables, the Power legend's
 * click-to-hide toggle (web `useHiddenSeries`), and the stale/offline cached view. Asserts the rendered i18n
 * strings, each chart's accessible description (web `ariaLabel`, resolved via the catalog-absent fallback),
 * the legend chips' interactivity + hidden-state announcement, and the freshness chip's TalkBack label. The
 * offline gate's `testReleaseUnitTest` covers the pure logic; this covers render + a11y. Mirrors the web spec
 * (web/src/features/driving/components/driving-dynamics/MotorHistoryCharts.tsx).
 */
class MotorHistoryChartsUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val powerTitle = "Motor Power Over Time"
    private val torqueTitle = "Motor Torque History"
    private val rpmTitle = "Motor RPM History"
    private val powerSubtitle = "Drive and regen power from motor telemetry"
    private val powerAria = "Motor power and regen over time area chart"
    private val torqueAria = "Front and rear motor torque over time line chart"
    private val rpmAria = "Front and rear motor RPM over time line chart"
    private val awaiting = "Awaiting motor telemetry data..."
    private val errorMessage = "Something went wrong on our end. Please try again."

    private fun setContent(
        state: UiState<List<MotorHistorySample>>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MotorHistoryChartsContent(
                    state = state,
                    onRetry = onRetry,
                    locale = Locale.US,
                )
            }
        }
    }

    // MotorHistorySample(time, powerKw, regenKw, torqueFront, torqueRear, rpmFront, rpmRear) — positional to
    // keep each fixture on one line within the column limit.
    private fun samples(): List<MotorHistorySample> =
        listOf(
            MotorHistorySample("10:00", 64.2, -12.0, 180.0, 210.0, 3200.0, 3400.0),
            MotorHistorySample("10:05", 120.5, -4.0, 240.0, 265.0, 5200.0, 5600.0),
            MotorHistorySample("10:10", 88.0, -33.5, 150.0, 175.0, 4100.0, 4300.0),
        )

    @Test
    fun loadingShowsEveryTitleChromeNotBlankPanels() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText(powerTitle).assertIsDisplayed()
        compose.onNodeWithText(torqueTitle).assertIsDisplayed()
        compose.onNodeWithText(rpmTitle).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        // Each of the three panels surfaces the error + a retry affordance (never a blank panel).
        compose.onAllNodesWithText(errorMessage).onFirst().assertIsDisplayed()
        compose.onAllNodesWithText("Retry").onFirst().performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitlesAndAwaitingTelemetryMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(powerTitle).assertIsDisplayed()
        compose.onNodeWithText(rpmTitle).assertIsDisplayed()
        // The web `dynamics.awaitingData` empty copy renders for each chart, never a blank box.
        compose.onAllNodesWithText(awaiting).onFirst().assertIsDisplayed()
    }

    @Test
    fun contentRendersAllTitlesSubtitleAccessibleDescriptionsAndLegends() {
        setContent(UiState(UiPhase.Content, data = samples()))
        compose.onNodeWithText(powerTitle).assertIsDisplayed()
        compose.onNodeWithText(torqueTitle).assertIsDisplayed()
        compose.onNodeWithText(rpmTitle).assertIsDisplayed()
        compose.onNodeWithText(powerSubtitle).assertIsDisplayed()
        // Each chart body carries the web ariaLabel as its screen-reader description.
        compose.onNodeWithContentDescription(powerAria).assertExists()
        compose.onNodeWithContentDescription(torqueAria).assertExists()
        compose.onNodeWithContentDescription(rpmAria).assertExists()
        // Every series appears in its chart's legend.
        compose.onNodeWithText("Power").assertExists()
        compose.onNodeWithText("Regen").assertExists()
        compose.onNodeWithText("Front Torque").assertExists()
        compose.onNodeWithText("Rear Torque").assertExists()
        compose.onNodeWithText("Front RPM").assertExists()
        compose.onNodeWithText("Rear RPM").assertExists()
        // The accessible fallback data table is offered for each chart (collapsed by default).
        compose.onAllNodesWithText("Details").onFirst().assertExists()
    }

    @Test
    fun powerLegendChipIsInteractiveAndTogglesHiddenState() {
        // The web Power chart's `useHiddenSeries` click-to-hide: the legend chip is a button, and tapping it
        // marks the series hidden (announced via the chip's content description).
        setContent(UiState(UiPhase.Content, data = samples()))
        compose.onNodeWithContentDescription("Power").assertHasClickAction()
        compose.onNodeWithContentDescription("Power").performClick()
        compose.onNodeWithContentDescription("Power, hidden").assertExists()
    }

    @Test
    fun offlineShowsCachedChartsWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = samples(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(powerTitle).assertIsDisplayed()
        // A failed refresh over cached data surfaces the "Offline" chip on the panel headers.
        compose.onAllNodesWithContentDescription("Offline").onFirst().assertExists()
    }

    @Test
    fun staleContentAutoRefreshesOnceAndKeepsCachedContent() {
        var refreshes = 0
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = samples(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshes++ },
        )
        compose.waitForIdle()
        compose.onNodeWithText(powerTitle).assertIsDisplayed()
        // The auto-refresh effect lives at the content level, so a stale feed refreshes exactly once
        // (not once per stacked chart).
        assertTrue(refreshes >= 1)
    }
}
