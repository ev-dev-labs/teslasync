package io.teslasync.android.featureviews.fsmtimelinechart

import androidx.compose.ui.test.assertExists
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
import java.time.ZoneId
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [FSMTimelineChartContent] across every state the
 * surface renders: the loading chrome, the hard-error retry surface, the no-data empty state (default and
 * with an `emptyMessage` override), the populated overlaid-area chart with its per-FSM legend, and the
 * stale/offline cached views. Asserts the rendered i18n strings and the TalkBack content descriptions (the
 * always-visible title, the legend swatch labels that identify each FSM series, the offline freshness chip).
 * The offline gate's `testReleaseUnitTest` covers the pure bucketing logic; this covers render + a11y.
 * Mirrors the web spec (web/src/features/system/components/FSMTimelineChart.tsx).
 */
class FSMTimelineChartUiTest {
    @get:Rule
    val compose = createComposeRule()

    private companion object {
        const val NOW_MILLIS: Long = 1_700_000_000_000L
        const val WINDOW_6H: Int = 6
        val UTC: ZoneId = ZoneId.of("UTC")
        const val TITLE = "Transitions Over Time"
        const val NO_DATA = "No transition data for timeline"
    }

    private fun setContent(
        state: UiState<List<FSMTransitionPoint>>,
        emptyMessage: String? = null,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FSMTimelineChartContent(
                    state = state,
                    hours = WINDOW_6H,
                    onRetry = onRetry,
                    emptyMessage = emptyMessage,
                    locale = Locale.US,
                    zone = UTC,
                    nowMillis = NOW_MILLIS,
                )
            }
        }
    }

    private fun transitions(): List<FSMTransitionPoint> =
        listOf(
            FSMTransitionPoint(ts = "2023-11-14T20:00:00Z", fsmName = "vehicle"),
            FSMTransitionPoint(ts = "2023-11-14T20:05:00Z", fsmName = "vehicle"),
            FSMTransitionPoint(ts = "2023-11-14T21:00:00Z", fsmName = "telemetry_connection"),
        )

    @Test
    fun loadingShowsTitleChromeNotABlankPanel() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithText(TITLE).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsTitleAndDefaultNoDataMessage() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText(NO_DATA).assertIsDisplayed()
    }

    @Test
    fun emptyHonorsTheEmptyMessageOverride() {
        setContent(UiState(UiPhase.Empty, data = emptyList()), emptyMessage = "No FSM activity in range")
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithText("No FSM activity in range").assertIsDisplayed()
    }

    @Test
    fun contentRendersTitleAndAccessibleSeriesLegend() {
        setContent(UiState(UiPhase.Content, data = transitions()))
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        // The legend identifies each dynamic FSM series for TalkBack (swatch contentDescription = name).
        compose.onNodeWithContentDescription("vehicle").assertExists()
        compose.onNodeWithContentDescription("telemetry_connection").assertExists()
    }

    @Test
    fun offlineShowsCachedChartWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = transitions(),
                stale = true,
                fetchedAt = NOW_MILLIS,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedContent() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = transitions(),
                    stale = true,
                    fetchedAt = NOW_MILLIS,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithText(TITLE).assertIsDisplayed()
        assertTrue(refreshed)
    }
}
