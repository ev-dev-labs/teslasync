package io.teslasync.android.sharedsurfaces.input

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextInput
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the Input surface across every branch the web component
 * renders (web/src/components/ui/Input.tsx): the labelled / required field name, the optional help affordance,
 * the leading suffix, the ghost prompt, the error-or-hint message slot (error replacing hint), the disabled
 * dim, and the edit that reports the typed text. Asserts the field's TalkBack accessible name (label + the
 * localized required word), the help trigger's accessible name, the rendered message strings, and the one-shot
 * PII-safe `view.opened` diagnostic. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers
 * the pure model + diagnostics logic off-device.
 */
class InputUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Accessibility: the label (plus the required word) names the field; the help trigger is named ─────

    @Test
    fun labelledFieldExposesItsAccessibleName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "", onValueChange = {}, label = LABEL)
            }
        }
        compose.onNodeWithContentDescription(LABEL, substring = true).assertIsDisplayed()
    }

    @Test
    fun requiredFieldFoldsTheRequiredWordIntoItsName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "", onValueChange = {}, label = LABEL, required = true)
            }
        }
        // The required word comes from the P1/S10 catalog (form.required = "required").
        compose.onNodeWithContentDescription("required", substring = true).assertIsDisplayed()
    }

    @Test
    fun helpAffordanceExposesItsAccessibleName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "", onValueChange = {}, label = LABEL, help = HELP)
            }
        }
        // a11y.helpFor = "Help for %1$s"; the field id is the slugged label ("email").
        compose.onNodeWithContentDescription("Help for email", substring = true).assertIsDisplayed()
    }

    // ── Interaction: editing reports the typed text (web `onChange`) ─────────────────────────────────────

    @Test
    fun editingReportsTheTypedText() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var text by remember { mutableStateOf("") }
                InputField(value = text, onValueChange = { text = it }, ghost = GHOST)
            }
        }
        compose.onNodeWithTag(INPUT_TEST_TAG).performTextInput("hi@x.io")
        compose.onNodeWithText("hi@x.io").assertIsDisplayed()
    }

    // ── Message slot: error shown red, hint shown muted, error replaces the hint ─────────────────────────

    @Test
    fun errorMessageIsShown() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "x", onValueChange = {}, label = LABEL, error = ERROR)
            }
        }
        compose.onNodeWithText(ERROR).assertIsDisplayed()
    }

    @Test
    fun hintIsShownWhenThereIsNoError() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "x", onValueChange = {}, label = LABEL, hint = HINT)
            }
        }
        compose.onNodeWithText(HINT).assertIsDisplayed()
    }

    @Test
    fun errorMessageReplacesTheHintInTheSlot() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "x", onValueChange = {}, label = LABEL, error = ERROR, hint = HINT)
            }
        }
        // The single supporting slot shows the error; the hint is suppressed. The hint-suppression
        // precedence is asserted exhaustively off-device in
        // InputModelTest.errorTakesPrecedenceOverHintAndMarksTheSlotAsError.
        compose.onNodeWithText(ERROR).assertIsDisplayed()
    }

    // ── Suffix + disabled ────────────────────────────────────────────────────────────────────────────────

    @Test
    fun trailingSuffixIsRendered() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "75", onValueChange = {}, label = "Battery Capacity", suffix = "kWh")
            }
        }
        compose.onNodeWithText("kWh").assertIsDisplayed()
    }

    @Test
    fun disabledFieldIsNotEnabled() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "x", onValueChange = {}, label = LABEL, enabled = false)
            }
        }
        compose.onNodeWithTag(INPUT_TEST_TAG).assertIsNotEnabled()
    }

    // ── Ghost prompt shown on the empty field (the web ghost-text attribute) ─────────────────────────────

    @Test
    fun ghostPromptIsShownWhenEmpty() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                InputField(value = "", onValueChange = {}, ghost = GHOST)
            }
        }
        compose.onNodeWithText(GHOST).assertIsDisplayed()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ─────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Input(value = "secret value", onValueChange = {}, label = LABEL, logger = logger)
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "Input"), opened.single().fields)
        assertTrue("the label must never leak", logger.records.none { it.fields.containsValue(LABEL) })
        assertTrue("the value must never leak", logger.records.none { it.fields.containsValue("secret value") })
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }

    private companion object {
        private const val LABEL = "Email"
        private const val HELP = "We only use this to send charge alerts."
        private const val HINT = "You can change this later."
        private const val ERROR = "Enter a valid email address."
        private const val GHOST = "you@example.com"
    }
}
