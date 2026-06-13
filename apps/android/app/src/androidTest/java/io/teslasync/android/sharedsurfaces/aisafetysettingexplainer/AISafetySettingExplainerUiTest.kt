package io.teslasync.android.sharedsurfaces.aisafetysettingexplainer

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
 * On-device Compose UI + accessibility verification of [AISafetySettingExplainerContent] across every
 * state the web component renders: the AI-Off gate (renders nothing), the idle card (header + Helix badge
 * + description + action button), the streaming "thinking" skeleton + Cancel, the streamed narration
 * text, and the classified error + retry. Asserts the rendered i18n strings and the TalkBack content
 * descriptions are present. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the
 * logic, this covers the render.
 */
class AISafetySettingExplainerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        AISafetySettingExplainerStrings(
            title = "Explain my safety settings",
            description = "Ask Helix to explain the safety-related settings on this page in plain English.",
            explainButton = "Explain my settings",
            badge = "Helix",
            streamingLabel = "Streaming",
            loadingLabel = "Loading",
            cancelLabel = "Cancel",
        )

    private fun setContent(
        state: AISafetySettingExplainerState,
        onExplain: () -> Unit = {},
        onCancel: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AISafetySettingExplainerContent(
                    state = state,
                    strings = strings,
                    onExplain = onExplain,
                    onCancel = onCancel,
                    onRetry = onRetry,
                )
            }
        }
    }

    @Test
    fun offModeRendersNothing() {
        setContent(AISafetySettingExplainerState(gateEnabled = false))
        compose.onNodeWithText("Explain my safety settings").assertDoesNotExist()
    }

    @Test
    fun idleShowsHeaderBadgeAndEnabledButton() {
        setContent(AISafetySettingExplainerState(gateEnabled = true))
        compose.onNodeWithText("Explain my safety settings").assertIsDisplayed()
        compose.onNodeWithText("Helix").assertIsDisplayed()
        compose.onNodeWithText("Explain my settings").assertIsEnabled()
    }

    @Test
    fun streamingShowsThinkingChromeAndCancel() {
        setContent(
            AISafetySettingExplainerState(
                gateEnabled = true,
                phase = ExplainPhase.Streaming,
            ),
        )
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
        compose.onNodeWithText("Streaming").assertIsDisplayed()
        compose.onNodeWithText("Cancel").assertIsDisplayed()
        // The explain button is disabled while a stream is in flight (web `disabled={... || streaming}`).
        compose.onNodeWithText("Explain my settings").assertIsNotEnabled()
    }

    @Test
    fun contentShowsNarrationText() {
        setContent(
            AISafetySettingExplainerState(
                gateEnabled = true,
                phase = ExplainPhase.Done,
                text = "Sentry Mode is on and PIN to Drive is off.",
            ),
        )
        compose.onNodeWithText("Sentry Mode is on and PIN to Drive is off.").assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAndInvokesIt() {
        var retried = false
        setContent(
            state =
                AISafetySettingExplainerState(
                    gateEnabled = true,
                    phase = ExplainPhase.Error,
                    error = ExplainError(message = "stream_http_503", kind = ErrorKind.Http, httpStatus = 503),
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
                AISafetySettingExplainerState(
                    gateEnabled = true,
                    phase = ExplainPhase.Streaming,
                ),
            onCancel = { cancelled = true },
        )
        compose.onNodeWithText("Cancel").performClick()
        assertTrue(cancelled)
    }
}
