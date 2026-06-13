package io.teslasync.android.sharedsurfaces.aicabintemperatureimpactnarrative

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
 * On-device Compose UI + accessibility verification of [AICabinTemperatureImpactNarrativeContent] across
 * every state the web component renders: the AI-Off gate (renders nothing), the idle card (header + Helix
 * badge + description + action button, disabled without a vehicle), the streaming "thinking" skeleton +
 * Cancel, the streamed narration text, and the classified error + retry. Asserts the rendered i18n strings
 * and the TalkBack content descriptions are present. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the logic, this covers the render.
 */
class AICabinTemperatureImpactNarrativeUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        AICabinTemperatureImpactNarrativeStrings(
            title = "Narrate the cabin-temperature impact",
            description = "Ask Helix to explain how outside temperature affects efficiency.",
            generateButton = "Narrate impact",
            badge = "Helix",
            streamingLabel = "Streaming",
            loadingLabel = "Loading",
            cancelLabel = "Cancel",
        )

    private fun setContent(
        state: AICabinTemperatureImpactNarrativeState,
        onNarrate: () -> Unit = {},
        onCancel: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AICabinTemperatureImpactNarrativeContent(
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
        setContent(AICabinTemperatureImpactNarrativeState(gateEnabled = false, vehicleId = 1L))
        compose.onNodeWithText("Narrate the cabin-temperature impact").assertDoesNotExist()
    }

    @Test
    fun idleShowsHeaderBadgeAndEnabledButton() {
        setContent(AICabinTemperatureImpactNarrativeState(gateEnabled = true, vehicleId = 1L))
        compose.onNodeWithText("Narrate the cabin-temperature impact").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("Narrate impact").assertIsEnabled()
    }

    @Test
    fun idleDisablesButtonWithoutVehicle() {
        setContent(AICabinTemperatureImpactNarrativeState(gateEnabled = true, vehicleId = null))
        compose.onNodeWithText("Narrate impact").assertIsNotEnabled()
    }

    @Test
    fun streamingShowsThinkingChromeAndCancel() {
        setContent(
            AICabinTemperatureImpactNarrativeState(
                gateEnabled = true,
                vehicleId = 1L,
                phase = NarrationPhase.Streaming,
            ),
        )
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Streaming").assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
        // The narrate button is disabled while a stream is in flight (web `disabled={... || streaming}`).
        compose.onNodeWithText("Narrate impact").assertIsNotEnabled()
    }

    @Test
    fun contentShowsNarrationText() {
        setContent(
            AICabinTemperatureImpactNarrativeState(
                gateEnabled = true,
                vehicleId = 1L,
                phase = NarrationPhase.Done,
                text = "The 15–25 °C bucket runs most efficiently.",
            ),
        )
        compose.onNodeWithText("The 15–25 °C bucket runs most efficiently.").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            state =
                AICabinTemperatureImpactNarrativeState(
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
                AICabinTemperatureImpactNarrativeState(
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
