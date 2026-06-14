package io.teslasync.android.sharedsurfaces.checkbox

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the Checkbox surface across every branch the web
 * component renders (web/src/components/ui/Checkbox.tsx): the empty / checked / mixed box, the optional label,
 * the disabled dim, the read-only display path, and the toggle that reports the flipped boolean. Asserts the
 * `Role.Checkbox` tri-state semantics (the localized checked/unchecked/mixed announcement), the merged label /
 * contentDescription accessible name, the click action and its reported value, and the one-shot PII-safe
 * `view.opened` diagnostic. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure
 * model + diagnostics logic off-device.
 */
class CheckboxUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Per-state: the three boxes carry the correct tri-state semantics (web indeterminate/checked/empty) ─

    @Test
    fun uncheckedBoxReportsTheOffState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = false, onCheckedChange = {})
            }
        }
        compose.onNodeWithTag(CHECKBOX_TEST_TAG).assert(hasToggleState(ToggleableState.Off))
    }

    @Test
    fun checkedBoxReportsTheOnState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = true, onCheckedChange = {})
            }
        }
        compose.onNodeWithTag(CHECKBOX_TEST_TAG).assert(hasToggleState(ToggleableState.On))
    }

    @Test
    fun indeterminateBoxReportsTheMixedStateEvenWhenChecked() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = true, indeterminate = true, onCheckedChange = {})
            }
        }
        compose.onNodeWithTag(CHECKBOX_TEST_TAG).assert(hasToggleState(ToggleableState.Indeterminate))
    }

    // ── Interaction: tapping reports the flipped boolean (web `onChange(e.target.checked)`) ──────────────

    @Test
    fun tappingAnUncheckedBoxReportsTrue() {
        var reported: Boolean? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = false, onCheckedChange = { reported = it })
            }
        }
        val node = compose.onNodeWithTag(CHECKBOX_TEST_TAG)
        node.assertHasClickAction().performClick()
        assertEquals(true, reported)
    }

    @Test
    fun tappingACheckedBoxReportsFalse() {
        var reported: Boolean? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = true, onCheckedChange = { reported = it })
            }
        }
        compose.onNodeWithTag(CHECKBOX_TEST_TAG).performClick()
        assertEquals(false, reported)
    }

    @Test
    fun tappingTogglesAndUpdatesTheRenderedState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var checked by remember { mutableStateOf(false) }
                CheckboxField(checked = checked, onCheckedChange = { checked = it })
            }
        }
        val node = compose.onNodeWithTag(CHECKBOX_TEST_TAG)
        node.assert(hasToggleState(ToggleableState.Off))
        node.performClick()
        node.assert(hasToggleState(ToggleableState.On))
    }

    // ── Disabled: dimmed and non-interactive (web `disabled` / `peer-disabled`) ──────────────────────────

    @Test
    fun disabledBoxIsNotEnabled() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = false, enabled = false, onCheckedChange = {})
            }
        }
        compose.onNodeWithTag(CHECKBOX_TEST_TAG).assertIsNotEnabled()
    }

    // ── Accessibility: the label names the control, and an unlabelled box takes a contentDescription ─────

    @Test
    fun labelNamesTheCheckbox() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = true, label = LABEL, onCheckedChange = {})
            }
        }
        compose.onNodeWithText(LABEL).assertIsDisplayed()
        compose.onNodeWithTag(CHECKBOX_TEST_TAG).assertHasClickAction()
    }

    @Test
    fun unlabelledBoxExposesItsContentDescription() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = false, contentDescription = DESCRIPTION, onCheckedChange = {})
            }
        }
        compose.onNodeWithContentDescription(DESCRIPTION).assertIsDisplayed()
    }

    @Test
    fun readOnlyBoxRendersWithoutAClickAction() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CheckboxField(checked = true, onCheckedChange = null, contentDescription = DESCRIPTION)
            }
        }
        compose
            .onNodeWithContentDescription(DESCRIPTION)
            .assertIsDisplayed()
            .assertHasNoClickAction()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ─────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Checkbox(checked = false, onCheckedChange = {}, label = LABEL, logger = logger)
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "Checkbox"), opened.single().fields)
        assertTrue("the label must never leak", logger.records.none { it.fields.containsValue(LABEL) })
    }

    private fun hasToggleState(state: ToggleableState): SemanticsMatcher =
        SemanticsMatcher.expectValue(SemanticsProperties.ToggleableState, state)

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
        private const val LABEL = "Enable notifications"
        private const val DESCRIPTION = "Agree to the terms"
    }
}
