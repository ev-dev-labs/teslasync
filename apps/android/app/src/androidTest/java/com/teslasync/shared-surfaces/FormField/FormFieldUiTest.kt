// Instrumented Compose UI + accessibility verification of the stateless FormFieldContent across the states the web
// component renders: the optional field (label + control, no supporting line), the required field (whose label is
// announced with the localized "required" suffix — the web asterisk `aria-label="required"`), the hint line shown
// only when there is no error, and the validation error that REPLACES the hint (web `error ? … : hint ? … :
// null`). Runs under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers
// the pure model. `assertExists` / `assertDoesNotExist` are SemanticsNodeInteraction members and are deliberately
// called without an import (an explicit import does not resolve).
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.formfield

import androidx.compose.material3.Text
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

class FormFieldUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun optionalFieldShowsLabelAndControlWithoutSupportingLine() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FormFieldContent(label = LABEL, autoId = AUTO_ID) { Text(CONTROL) }
            }
        }
        compose.onNodeWithText(LABEL).assertIsDisplayed()
        compose.onNodeWithText(CONTROL).assertIsDisplayed()
        compose.onNodeWithText(HINT).assertDoesNotExist()
        compose.onNodeWithText(ERROR).assertDoesNotExist()
    }

    @Test
    fun requiredFieldAnnouncesRequiredSuffixOnLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FormFieldContent(label = LABEL, autoId = AUTO_ID, required = true) { Text(CONTROL) }
            }
        }
        // The web asterisk `aria-label="required"` is mirrored as the merged label announcement.
        compose.onNodeWithContentDescription(REQUIRED_LABEL).assertIsDisplayed()
    }

    @Test
    fun hintIsShownWhenThereIsNoError() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FormFieldContent(label = LABEL, autoId = AUTO_ID, hint = HINT) { Text(CONTROL) }
            }
        }
        compose.onNodeWithText(HINT).assertIsDisplayed()
        compose.onNodeWithText(ERROR).assertDoesNotExist()
    }

    @Test
    fun errorReplacesHint() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FormFieldContent(label = LABEL, autoId = AUTO_ID, hint = HINT, error = ERROR) { Text(CONTROL) }
            }
        }
        compose.onNodeWithText(ERROR).assertIsDisplayed()
        compose.onNodeWithText(HINT).assertDoesNotExist()
    }

    @Test
    fun errorLineIsShownForValidationError() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                FormFieldContent(label = LABEL, autoId = AUTO_ID, error = ERROR) { Text(CONTROL) }
            }
        }
        compose.onNodeWithText(ERROR).assertIsDisplayed()
        compose.onNodeWithText(CONTROL).assertIsDisplayed()
    }

    private companion object {
        const val LABEL = "Signal"
        const val REQUIRED_LABEL = "Signal, required"
        const val HINT = "Pick the telemetry signal to alert on."
        const val ERROR = "Select a signal."
        const val CONTROL = "field-control"
        const val AUTO_ID = "form-field-test"
    }
}
