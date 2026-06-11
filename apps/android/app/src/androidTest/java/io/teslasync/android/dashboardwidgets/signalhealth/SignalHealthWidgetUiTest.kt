package io.teslasync.android.dashboardwidgets.signalhealth

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

/**
 * Instrumented Compose tests for the Signal Health surface: each state from the web source (content /
 * wide + stale-list / empty / error / stale + the compact health-badge layout) renders its copy on a
 * device, every interactive element exposes an accessible name (refresh + retry), the gap rows expose a
 * merged TalkBack description, and the compact layout announces the signal count. The framework-free
 * logic is covered by the no-device [SignalHealthWidgetModelTest]; this is the connectedAndroidTest gate.
 */
class SignalHealthWidgetUiTest {
    @get:Rule
    val rule = createComposeRule()

    private val now = 1_700_000_000_000L

    private fun data(): SignalHealthData =
        SignalHealthData(
            totalSignals = 48,
            activeCount = 40,
            staleCount = 6,
            gapSignals =
                listOf(
                    SignalGap("VehicleSpeed", null),
                    SignalGap("ChargeState", now - 30L * 60_000L),
                ),
            freshnessAgeSeconds = 12,
            healthLevel = SignalHealthLevel.Degraded,
            resolved = true,
        )

    private fun contentState(stale: Boolean = false): UiState<SignalHealthData> =
        UiState(phase = UiPhase.Content, data = data(), fetchedAt = 1L, stale = stale)

    @Test
    fun contentStandardShowsTitleEveryTileLabelAndStatus() {
        rule.setContent {
            TeslaSyncTheme {
                SignalHealthWidgetContent(state = contentState(), size = SignalHealthRegistration.DEFAULT_SIZE)
            }
        }

        rule.onNodeWithText("Signal Health", ignoreCase = true).assertIsDisplayed()
        rule.onNodeWithText("Total Signals").assertIsDisplayed()
        rule.onNodeWithText("Active").assertIsDisplayed()
        rule.onNodeWithText("With Gaps").assertIsDisplayed()
        rule.onNodeWithText("Freshness").assertIsDisplayed()
        rule.onNodeWithText("Degraded").assertIsDisplayed()
    }

    @Test
    fun contentExposesRefreshAccessibilityLabel() {
        rule.setContent {
            TeslaSyncTheme {
                SignalHealthWidgetContent(state = contentState(), size = SignalHealthRegistration.DEFAULT_SIZE)
            }
        }

        rule.onNodeWithContentDescription("Refresh").assertIsDisplayed()
    }

    @Test
    fun wideLayoutShowsStaleListHeaderAndRowLabel() {
        rule.setContent {
            TeslaSyncTheme {
                SignalHealthWidgetContent(state = contentState(), size = SignalHealthSize(cols = 4, rows = 6))
            }
        }

        rule.onNodeWithText("Stale / Gap Signals", ignoreCase = true).assertIsDisplayed()
        rule.onNodeWithContentDescription("VehicleSpeed", substring = true).assertIsDisplayed()
    }

    @Test
    fun emptyStateShowsNoDataMessage() {
        rule.setContent {
            TeslaSyncTheme {
                SignalHealthWidgetContent(
                    state = UiState(phase = UiPhase.Empty, data = SignalHealthData.EMPTY, fetchedAt = 1L),
                    size = SignalHealthRegistration.DEFAULT_SIZE,
                )
            }
        }

        rule.onNodeWithText("No signal health data").assertIsDisplayed()
    }

    @Test
    fun errorStateShowsRetryAndFiresCallback() {
        var retried = false
        rule.setContent {
            TeslaSyncTheme {
                SignalHealthWidgetContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500),
                    size = SignalHealthRegistration.DEFAULT_SIZE,
                    onRetry = { retried = true },
                )
            }
        }

        rule.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun compactLayoutAnnouncesSignalCountForTalkback() {
        rule.setContent {
            TeslaSyncTheme {
                SignalHealthWidgetContent(state = contentState(), size = SignalHealthSize(cols = 1, rows = 2))
            }
        }

        rule.onNodeWithContentDescription("48", substring = true).assertIsDisplayed()
    }

    @Test
    fun staleContentStillRendersTiles() {
        rule.setContent {
            TeslaSyncTheme {
                SignalHealthWidgetContent(state = contentState(stale = true), size = SignalHealthRegistration.DEFAULT_SIZE)
            }
        }

        rule.onNodeWithText("Total Signals").assertIsDisplayed()
    }
}
