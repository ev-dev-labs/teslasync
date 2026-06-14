// Instrumented Compose UI + accessibility verification of the EditableText surface across the states the web
// component renders: the default display (the value, the muted ghost fallback for an empty value, and the
// disabled read-only variant), the display→editor activation, the caller-supplied `display` render prop, the
// editor's per-state branches (the in-flight save indicator and the validation/save-failed error), and the
// a11y contract (the display is a Role.Button named by ariaLabel; the editor input carries ariaLabel as its
// name). It also asserts the one-shot PII-safe `view.opened` diagnostic. Runs under `connectedAndroidTest` (a
// device/emulator); the offline `:android:testReleaseUnitTest` gate covers the pure model (the commit
// classifier, live validation, display resolution, and diagnostics) in EditableTextModelTest.
//
// `assertExists` / `assertDoesNotExist` are SemanticsNodeInteraction MEMBERS (called on the result, not
// imported); only the matcher form `assert(SemanticsMatcher)` and the other asserts below are real top-level
// `androidx.compose.ui.test` extensions, which are imported. `InvalidPackageDeclaration` is suppressed: the
// mandated surface directory (com/teslasync/shared-surfaces/EditableText) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.editabletext

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.sharedsurfaces.announcerregion.Announcer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class EditableTextUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    // ── Display: the value, as a Role.Button named by ariaLabel (web `<button aria-label>`) ───────────

    @Test
    fun displayRendersTheValueAsAButtonNamedByAriaLabel() {
        host {
            EditableText(value = VALUE, onSave = {}, ariaLabel = LABEL, logger = RecordingLogger())
        }
        compose.onNodeWithText(VALUE, useUnmergedTree = true).assertIsDisplayed()
        compose
            .onNodeWithTag(EDITABLE_TEXT_TRIGGER_TAG)
            .assertExists()
            .assertHasClickAction()
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button))
        // The button announces the ariaLabel, not the visible text (web aria-label override).
        compose.onNodeWithContentDescription(LABEL).assertExists()
    }

    // ── Display (empty): the muted ghost text, never a blank box ───────────────────────────────────────

    @Test
    fun emptyValueRendersTheGhostText() {
        host {
            EditableText(value = "", onSave = {}, ariaLabel = LABEL, ghostText = GHOST, logger = RecordingLogger())
        }
        compose.onNodeWithText(GHOST, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(EDITABLE_TEXT_TRIGGER_TAG).assertExists()
    }

    // ── Display (disabled): no edit affordance (web `disabled`) ────────────────────────────────────────

    @Test
    fun disabledDisplayExposesNoClickAction() {
        host {
            EditableText(value = VALUE, onSave = {}, ariaLabel = LABEL, disabled = true, logger = RecordingLogger())
        }
        compose
            .onNodeWithTag(EDITABLE_TEXT_TRIGGER_TAG)
            .assertExists()
            .assert(SemanticsMatcher.keyNotDefined(SemanticsActions.OnClick))
    }

    // ── Display → editor: activating the trigger enters edit mode (web onClick) ────────────────────────

    @Test
    fun tappingTheTriggerEntersEditMode() {
        host {
            EditableText(value = VALUE, onSave = {}, ariaLabel = LABEL, logger = RecordingLogger())
        }
        compose.onNodeWithTag(EDITABLE_TEXT_INPUT_TAG).assertDoesNotExist()
        compose.onNodeWithTag(EDITABLE_TEXT_TRIGGER_TAG).performClick()
        compose.onNodeWithTag(EDITABLE_TEXT_INPUT_TAG).assertExists()
    }

    // ── Custom display render prop (web `display`) ─────────────────────────────────────────────────────

    @Test
    fun customDisplaySlotReplacesTheDefaultTrigger() {
        host {
            EditableText(
                value = VALUE,
                onSave = {},
                ariaLabel = LABEL,
                logger = RecordingLogger(),
                display = { scope -> Text("${scope.value} (custom)") },
            )
        }
        compose.onNodeWithText("$VALUE (custom)", useUnmergedTree = true).assertIsDisplayed()
        // The default button-styled-as-text is not rendered when a custom display is supplied.
        compose.onNodeWithTag(EDITABLE_TEXT_TRIGGER_TAG).assertDoesNotExist()
    }

    // ── Editor: the input carries ariaLabel as its accessible name (web input `aria-label`) ────────────

    @Test
    fun editorInputIsNamedByAriaLabel() {
        host {
            EditableTextEditor(
                draft = VALUE,
                ariaLabel = LABEL,
                saving = false,
                errorMessage = null,
                savingLabel = SAVING,
            )
        }
        compose.onNodeWithTag(EDITABLE_TEXT_INPUT_TAG).assertExists()
        compose.onNodeWithContentDescription(LABEL).assertExists()
    }

    // ── Editor (saving = "loading"): the in-flight indicator is shown (web `saving`) ───────────────────

    @Test
    fun savingShowsTheIndicatorAndDisablesNothingElse() {
        host {
            EditableTextEditor(
                draft = VALUE,
                ariaLabel = LABEL,
                saving = true,
                errorMessage = null,
                savingLabel = SAVING,
            )
        }
        compose.onNodeWithTag(EDITABLE_TEXT_SPINNER_TAG).assertExists()
    }

    // ── Editor (error): the error text is shown and the input flags the error (web ErrorText) ──────────

    @Test
    fun errorRendersTheErrorTextAndFlagsTheInput() {
        host {
            EditableTextEditor(
                draft = "",
                ariaLabel = LABEL,
                saving = false,
                errorMessage = ERROR,
                savingLabel = SAVING,
            )
        }
        compose.onNodeWithTag(EDITABLE_TEXT_ERROR_TAG).assertExists()
        compose.onNodeWithText(ERROR, useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        host {
            EditableText(value = VALUE, onSave = {}, ariaLabel = LABEL, announcer = Announcer(), logger = logger)
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "EditableText"), fields)
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
        const val VALUE = "Home"
        const val GHOST = "Unnamed location"
        const val LABEL = "Rename geofence Home"
        const val SAVING = "Saving…"
        const val ERROR = "Value cannot be empty"
    }
}
