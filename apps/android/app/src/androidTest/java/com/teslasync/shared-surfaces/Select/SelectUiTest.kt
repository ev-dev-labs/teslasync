// Instrumented Compose UI + accessibility verification of [SelectField] across the states the web Select renders:
// the selected-value trigger, the empty-value-label trigger, the label + HelpIcon row, the open options menu
// (with a disabled, non-selectable option), picking an option, the friendly empty-options row (never a blank
// box), the error paragraph + the field's `aria-invalid` error semantic, the hint paragraph, the disabled
// control that will not open, and the trigger's accessible name (the web `<label htmlFor>` association). Runs
// under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure
// model (the id resolver, the display/precedence logic, the classifier, and the diagnostics) in SelectModelTest.
//
// `assertExists` / `assertDoesNotExist` / `assertIsNotEnabled` are SemanticsNodeInteraction MEMBERS (called on
// the result, not imported); only the matcher form `assert(SemanticsMatcher)` is the real top-level
// `androidx.compose.ui.test` extension, imported below. `InvalidPackageDeclaration` is suppressed: the mandated
// surface directory (com/teslasync/shared-surfaces/Select) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.select

import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class SelectUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) { content() }
        }
    }

    @Test
    fun selectedValueRendersInTheTrigger() {
        host {
            SelectField(options = OPTIONS, selectedValue = "model_3", onSelect = {}, label = LABEL)
        }
        compose.onNodeWithText(LABEL, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Model 3", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun emptyLabelRendersWhenNothingIsSelected() {
        host {
            SelectField(
                options = OPTIONS,
                selectedValue = null,
                onSelect = {},
                label = LABEL,
                emptyLabel = EMPTY_LABEL,
            )
        }
        compose.onNodeWithText(EMPTY_LABEL, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun labelAndHelpAffordanceRender() {
        host {
            SelectField(
                options = OPTIONS,
                selectedValue = null,
                onSelect = {},
                label = LABEL,
                help = SelectHelp(text = HELP_TEXT, accessibleLabel = HELP_ARIA),
                emptyLabel = EMPTY_LABEL,
            )
        }
        compose.onNodeWithText(LABEL, useUnmergedTree = true).assertIsDisplayed()
        // The HelpIcon is an interactive, screen-reader-named button (web `HelpIcon` aria "Help for {id}").
        compose.onNodeWithContentDescription(HELP_ARIA, useUnmergedTree = true).assertHasClickAction()
    }

    @Test
    fun openingTheMenuListsOptionsAndPickingReportsTheValue() {
        var picked: String? = null
        host {
            SelectField(
                options = OPTIONS,
                selectedValue = null,
                onSelect = { picked = it },
                label = LABEL,
                emptyLabel = EMPTY_LABEL,
            )
        }
        compose.onNodeWithTag(SELECT_TRIGGER_TAG).assertHasClickAction().performClick()
        compose.onNodeWithText("Model 3", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Model 3", useUnmergedTree = true).performClick()
        assertEquals("model_3", picked)
    }

    @Test
    fun disabledOptionIsNotSelectable() {
        host {
            SelectField(options = OPTIONS, selectedValue = null, onSelect = {}, label = LABEL, emptyLabel = EMPTY_LABEL)
        }
        compose.onNodeWithTag(SELECT_TRIGGER_TAG).performClick()
        // "Model X" is a disabled option — it renders but carries no enabled click action (web disabled <option>).
        compose.onNodeWithText("Model X", useUnmergedTree = true).assertIsNotEnabled()
    }

    @Test
    fun emptyOptionsShowTheFriendlyMessageRow() {
        host {
            SelectField(
                options = emptyList(),
                selectedValue = null,
                onSelect = {},
                label = LABEL,
                emptyLabel = EMPTY_LABEL,
                emptyMessage = EMPTY_MESSAGE,
            )
        }
        compose.onNodeWithTag(SELECT_TRIGGER_TAG).performClick()
        // A friendly empty row, never a blank open menu (the prompt's empty-state contract).
        compose.onNodeWithTag(SELECT_EMPTY_TAG, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(EMPTY_MESSAGE, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun errorRendersBeneathAndFlagsTheField() {
        host {
            SelectField(
                options = OPTIONS,
                selectedValue = null,
                onSelect = {},
                label = LABEL,
                emptyLabel = EMPTY_LABEL,
                error = ERROR,
            )
        }
        compose.onNodeWithTag(SELECT_ERROR_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(ERROR, useUnmergedTree = true).assertIsDisplayed()
        // The trigger carries the `aria-invalid` equivalent error semantic for screen readers.
        compose
            .onNodeWithTag(SELECT_TRIGGER_TAG)
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Error))
    }

    @Test
    fun hintRendersOnlyWhenThereIsNoError() {
        host {
            SelectField(
                options = OPTIONS,
                selectedValue = "model_y",
                onSelect = {},
                label = LABEL,
                hint = HINT,
            )
        }
        compose.onNodeWithTag(SELECT_HINT_TAG, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(HINT, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun disabledSelectDoesNotOpen() {
        host {
            SelectField(
                options = OPTIONS,
                selectedValue = "model_s",
                onSelect = {},
                label = LABEL,
                enabled = false,
            )
        }
        compose.onNodeWithTag(SELECT_TRIGGER_TAG).performClick()
        // The menu never opens, so the other options are not composed.
        compose.onNodeWithText("Model 3", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun triggerIsNamedByTheLabelForScreenReaders() {
        host {
            SelectField(options = OPTIONS, selectedValue = "model_3", onSelect = {}, label = LABEL)
        }
        // The read-only trigger's accessible name is the field label (web `<label htmlFor={selectId}>`).
        compose
            .onNodeWithTag(SELECT_TRIGGER_TAG)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.ContentDescription, listOf(LABEL)))
    }

    private companion object {
        const val LABEL = "Vehicle"
        const val EMPTY_LABEL = "Select a vehicle…"
        const val HELP_TEXT = "Pick the vehicle to sync."
        const val HELP_ARIA = "Help for Vehicle"
        const val HINT = "Only vehicles linked to your account appear here."
        const val ERROR = "Please choose a vehicle."
        const val EMPTY_MESSAGE = "No vehicles linked yet."

        val OPTIONS =
            listOf(
                SelectOption(value = "model_s", label = "Model S"),
                SelectOption(value = "model_3", label = "Model 3"),
                SelectOption(value = "model_x", label = "Model X", enabled = false),
                SelectOption(value = "model_y", label = "Model Y"),
            )
    }
}
