package io.teslasync.android.sharedsurfaces.aitirepressuretrendreasoning

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AITirePressureTrendReasoningContent] across every
 * state the web component renders: the AI-Off gate (renders nothing), the idle card (header + Helix badge
 * + description + action button, disabled without a vehicle), the streaming "thinking" skeleton + Cancel,
 * the streamed narration text, and the classified error + retry. Asserts the rendered i18n strings and the
 * TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the `testReleaseUnitTest`
 * gate covers the logic, this covers the render.
 */
class AITirePressureTrendReasoningUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        AITirePressureTrendReasoningStrings(
            title = "Narrate the 30-day tire-pressure trend",
            description = "Ask Helix to explain the recent 30-day trend in this vehicle's four corner tire pressures.",
            generateButton = "Narrate trend",
            badge = "Helix",
            streamingLabel = "Streaming",
            loadingLabel = "Loading",
            cancelLabel = "Cancel",
        )

    private fun setContent(
        state: AITirePressureTrendReasoningState,
        onNarrate: () -> Unit = {},
        onCancel: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AITirePressureTrendReasoningContent(
                    state = state,
                    strings = strings,
                    onNarrate = onNarrate,
                    onCancel = onCancel,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun offModeRendersNothing() {
        setContent(AITirePressureTrendReasoningState(gateEnabled = false, vehicleId = 1L))
        compose.onNodeWithText("Narrate the 30-day tire-pressure trend").assertDoesNotExist()
    }

    @Test
    fun idleShowsHeaderBadgeAndEnabledButton() {
        setContent(AITirePressureTrendReasoningState(gateEnabled = true, vehicleId = 1L))
        compose.onNodeWithText("Narrate the 30-day tire-pressure trend").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("Narrate trend").assertIsEnabled()
    }

    @Test
    fun idleDisablesButtonWithoutVehicle() {
        setContent(AITirePressureTrendReasoningState(gateEnabled = true, vehicleId = null))
        compose.onNodeWithText("Narrate trend").assertIsNotEnabled()
    }

    @Test
    fun streamingShowsThinkingChromeAndCancel() {
        setContent(
            AITirePressureTrendReasoningState(
                gateEnabled = true,
                vehicleId = 1L,
                phase = NarrationPhase.Streaming,
            ),
        )
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Streaming").assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
        // The narrate button is disabled while a stream is in flight (web `disabled={... || streaming}`).
        compose.onNodeWithText("Narrate trend").assertIsNotEnabled()
    }

    @Test
    fun contentShowsNarrationText() {
        setContent(
            AITirePressureTrendReasoningState(
                gateEnabled = true,
                vehicleId = 1L,
                phase = NarrationPhase.Done,
                text = "Front-left is trending down about 14 kPa over 30 days.",
            ),
        )
        compose.onNodeWithText("Front-left is trending down about 14 kPa over 30 days.").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            state =
                AITirePressureTrendReasoningState(
                    gateEnabled = true,
                    vehicleId = 1L,
                    phase = NarrationPhase.Error,
                    error = NarrationError(message = "stream_http_503", kind = ErrorKind.Http, httpStatus = 503),
                ),
            onRetry = { retried = true },
        )
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun streamingCancelInvokesCancel() {
        var cancelled = false
        setContent(
            state =
                AITirePressureTrendReasoningState(
                    gateEnabled = true,
                    vehicleId = 1L,
                    phase = NarrationPhase.Streaming,
                ),
            onCancel = { cancelled = true },
        )
        compose.onNodeWithText("Cancel").performClick()
        assertTrue(cancelled)
    }
}
