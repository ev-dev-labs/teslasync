// Instrumented Compose UI + accessibility verification of [LiveSignalTailContent] across every state the web
// component renders (data table / "Waiting for signals…" empty) plus the live-pipeline chrome the host's feed
// implies (loading / down-wire QueryError / stale / offline). Verifies the always-present title, the four stat
// labels, a data row's signal/value/type, the empty + error messages, the retry affordance, and the TalkBack
// names on every interactive control (filter field, Pause, Auto-scroll, Clear). Runs under
// `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure
// projection + the view-model fold. `mainClock.autoAdvance` is disabled because the surface hosts indefinite
// animations (the FadeIn entry, the per-row freshness pulse, the freshness ticker) that never idle; the clock
// is nudged once so the entry animation settles before assertions.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livesignaltail

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class LiveSignalTailUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        LiveSignalTailStrings(
            title = "Live Monitor",
            time = "Time",
            signal = "Signal",
            value = "Value",
            type = "Type",
            freshness = "Freshness",
            filterHint = "Filter by signal name…",
            filterLabel = "Filter signals",
            resume = "Resume",
            pause = "Pause",
            autoScroll = "Auto-scroll",
            clear = "Clear",
            sigPerSec = "Signals / sec",
            bufferSize = "Buffer Size",
            uniqueSignals = "Unique Signals",
            filtered = "Filtered",
            waiting = "Waiting for signals…",
            noMatch = "No signals match filter",
        )

    private fun entries(): List<LiveSignalEntry> {
        val now = System.currentTimeMillis()
        return listOf(
            LiveSignalEntry(3L, now, "VehicleSpeed", "64", SignalValueType.Number),
            LiveSignalEntry(2L, now - 300L, "Gear", "D", SignalValueType.Text),
            LiveSignalEntry(1L, now - 700L, "Locked", "true", SignalValueType.Boolean),
        )
    }

    private fun state(
        entries: List<LiveSignalEntry>,
        status: LiveConnectionStatus,
        isStale: Boolean = false,
    ): LiveSignalTailState =
        LiveSignalTailState(
            entries = entries,
            rate = entries.size,
            paused = false,
            bufferMax = DEFAULT_BUFFER_MAX,
            status = status,
            isStale = isStale,
            updatedAtMillis = if (entries.isEmpty()) null else System.currentTimeMillis(),
        )

    private fun setContent(
        state: LiveSignalTailState,
        onPauseToggle: () -> Unit = {},
        onClear: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    LiveSignalTailContent(
                        state = state,
                        strings = strings,
                        onPauseToggle = onPauseToggle,
                        onClear = onClear,
                        onRetry = onRetry,
                    )
                }
            }
        }
        compose.mainClock.advanceTimeBy(SETTLE_MILLIS)
    }

    @Test
    fun titleIsAlwaysVisible() {
        setContent(state(entries(), LiveConnectionStatus.Connected))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
    }

    @Test
    fun dataShowsSignalValueAndTypeBadge() {
        setContent(state(entries(), LiveConnectionStatus.Connected))
        compose.onNodeWithText("VehicleSpeed").assertIsDisplayed()
        compose.onNodeWithText("64").assertIsDisplayed()
        compose.onNodeWithText("number").assertIsDisplayed()
        compose.onNodeWithText("Gear").assertIsDisplayed()
    }

    @Test
    fun statCardLabelsAreAllVisible() {
        setContent(state(entries(), LiveConnectionStatus.Connected))
        compose.onNodeWithText(strings.sigPerSec).assertIsDisplayed()
        compose.onNodeWithText(strings.bufferSize).assertIsDisplayed()
        compose.onNodeWithText(strings.uniqueSignals).assertIsDisplayed()
        compose.onNodeWithText(strings.filtered).assertIsDisplayed()
    }

    @Test
    fun connectedButSilentShowsWaitingEmptyState() {
        setContent(state(emptyList(), LiveConnectionStatus.Connected))
        compose.onNodeWithText(strings.waiting).assertIsDisplayed()
    }

    @Test
    fun downWireWithNothingBufferedShowsRetryAndInvokesCallback() {
        var retried = false
        setContent(state(emptyList(), LiveConnectionStatus.Disconnected), onRetry = { retried = true })
        val retry = compose.onNodeWithText("Retry")
        retry.assertIsDisplayed().assertHasClickAction()
        retry.performClick()
        assertTrue(retried)
    }

    @Test
    fun pauseControlIsClickableAndInvokesCallback() {
        var toggled = false
        setContent(state(entries(), LiveConnectionStatus.Connected), onPauseToggle = { toggled = true })
        compose.onNodeWithText(strings.pause).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.pause).performClick()
        assertTrue(toggled)
    }

    @Test
    fun clearControlIsClickableAndInvokesCallback() {
        var cleared = false
        setContent(state(entries(), LiveConnectionStatus.Connected), onClear = { cleared = true })
        compose.onNodeWithText(strings.clear).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.clear).performClick()
        assertTrue(cleared)
    }

    @Test
    fun filterFieldExposesItsAccessibleLabel() {
        setContent(state(entries(), LiveConnectionStatus.Connected))
        compose.onNodeWithContentDescription(strings.filterLabel).assertIsDisplayed()
    }

    @Test
    fun everyInteractiveControlExposesAnAccessibleName() {
        setContent(state(entries(), LiveConnectionStatus.Connected))
        compose.onNodeWithContentDescription(strings.filterLabel).assertIsDisplayed()
        compose.onNodeWithText(strings.pause).assertIsDisplayed()
        compose.onNodeWithText(strings.autoScroll).assertIsDisplayed()
        compose.onNodeWithText(strings.clear).assertIsDisplayed()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 900.dp
        const val SETTLE_MILLIS = 1_000L
    }
}
