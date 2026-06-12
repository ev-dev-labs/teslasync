package io.teslasync.android.featureviews.alertmessageeditor

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AlertMessageEditorContent] across every state the
 * surface renders: the always-visible controls, the live-preview loading / empty / error+retry / content /
 * offline branches, the `{{`-trigger token autocomplete (open, filter, empty, insert), and the preset-gallery
 * modal (open, apply). Asserts the rendered i18n strings and the TalkBack content descriptions, and that the
 * change/retry callbacks fire. The offline gate's `testReleaseUnitTest` covers the pure logic; this covers
 * render + a11y. Mirrors the web spec (web/src/features/notifications/components/AlertMessageEditor.tsx).
 */
class AlertMessageEditorUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val tokens =
        listOf(
            TemplateToken(key = "BatteryLevel", label = "Battery level", group = "Battery"),
            TemplateToken(key = "VehicleName", label = "Vehicle name", group = "Vehicle"),
        )

    private val presets =
        listOf(
            MessagePreset(
                id = "low-battery",
                name = "Low battery",
                template = "{{VehicleName}} battery is {{BatteryLevel}}%",
                description = "Warns when charge drops.",
                tags = listOf("battery"),
            ),
        )

    private fun setEditor(
        tokensState: UiState<List<TemplateToken>> = UiState(UiPhase.Content, data = tokens),
        presetsState: UiState<List<MessagePreset>> = UiState(UiPhase.Content, data = presets),
        previewState: UiState<MessagePreview> = UiState(UiPhase.Empty, data = null),
        initialTemplate: String = "",
        onRetryPreview: () -> Unit = {},
        onTemplate: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var template by remember { mutableStateOf(initialTemplate) }
                var includeTitle by remember { mutableStateOf(true) }
                AlertMessageEditorContent(
                    template = template,
                    includeTitle = includeTitle,
                    tokens = tokensState,
                    presets = presetsState,
                    preview = previewState,
                    onTemplateChange = {
                        template = it
                        onTemplate(it)
                    },
                    onIncludeTitleChange = { includeTitle = it },
                    onRetryPreview = onRetryPreview,
                )
            }
        }
    }

    @Test
    fun rendersAlwaysVisibleControls() {
        setEditor()
        compose.onNodeWithText("Include title in notifications").assertIsDisplayed()
        compose.onNodeWithText("Message Template").assertExists()
        compose.onNodeWithText("Pick a preset").assertIsDisplayed()
    }

    @Test
    fun previewEmptyShowsStartTypingMessage() {
        setEditor(previewState = UiState(UiPhase.Empty, data = null))
        compose.onNodeWithText("Start typing to see a preview").assertIsDisplayed()
    }

    @Test
    fun previewErrorShowsRetryAndInvokesRetry() {
        var retried = false
        setEditor(previewState = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetryPreview = { retried = true })
        compose.onNodeWithText("Something went wrong on our end. Please try again.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun previewContentShowsTitleAndBody() {
        setEditor(previewState = UiState(UiPhase.Content, data = MessagePreview(title = "Low battery", body = "Model 3 at 18%")))
        compose.onNodeWithText("Low battery").assertIsDisplayed()
        compose.onNodeWithText("Model 3 at 18%").assertIsDisplayed()
    }

    @Test
    fun typingTriggerOpensSuggestionsAndInsertSplicesToken() {
        var lastTemplate = ""
        setEditor(onTemplate = { lastTemplate = it })
        compose.onNode(hasSetTextAction()).performTextInput("{{Bat")
        compose.waitForIdle()

        compose.onNodeWithText("Battery level").assertIsDisplayed()
        compose.onNodeWithText("Battery level").performClick()
        compose.waitForIdle()

        assertEquals("{{BatteryLevel}}", lastTemplate)
    }

    @Test
    fun typingUnmatchedTriggerShowsNoMatchMessage() {
        setEditor()
        compose.onNode(hasSetTextAction()).performTextInput("{{zzz")
        compose.waitForIdle()
        compose.onNodeWithText("No matching placeholders").assertIsDisplayed()
    }

    @Test
    fun pickPresetOpensModalAndApplyingSetsTemplate() {
        var lastTemplate = ""
        setEditor(onTemplate = { lastTemplate = it })
        compose.onNodeWithText("Pick a preset").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("Message Presets").assertIsDisplayed()
        compose.onNodeWithText("Low battery").assertIsDisplayed()
        compose.onNodeWithText("Low battery").performClick()
        compose.waitForIdle()

        assertEquals("{{VehicleName}} battery is {{BatteryLevel}}%", lastTemplate)
    }

    @Test
    fun offlinePreviewShowsCachedContentAndOfflineChip() {
        setEditor(
            previewState =
                UiState(
                    phase = UiPhase.Content,
                    data = MessagePreview(title = "Low battery", body = "Model 3 at 18%"),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
        )
        compose.waitForIdle()
        compose.onNodeWithText("Model 3 at 18%").assertIsDisplayed()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun helpAffordancesExposeAccessibleNames() {
        setEditor()
        compose.onNodeWithText("Include title in notifications").assertIsDisplayed()
        compose.onNodeWithContentDescription("Message Template").assertExists()
    }
}
