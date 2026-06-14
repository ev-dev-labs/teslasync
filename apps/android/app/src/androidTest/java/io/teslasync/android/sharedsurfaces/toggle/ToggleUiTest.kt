package io.teslasync.android.sharedsurfaces.toggle

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
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
 * On-device Compose UI + accessibility verification of the Toggle surface across every branch the web component
 * renders (web/src/components/ui/Toggle.tsx): the off / on track, the optional label, the two sizes, and the
 * toggle that reports the flipped boolean. Asserts the `Role.Switch` on/off semantics (the localized switch-state
 * announcement), the label / contentDescription accessible name, the click action and its reported value, and the
 * one-shot PII-safe `view.opened` diagnostic. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate
 * covers the pure model + diagnostics logic off-device.
 */
class ToggleUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Per-state: the two tracks carry the correct switch semantics (web off / on) ──────────────────────

    @Test
    fun offSwitchReportsTheOffState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleSwitch(checked = false, onCheckedChange = {})
            }
        }
        compose.onNodeWithTag(TOGGLE_TEST_TAG).assertIsOff()
    }

    @Test
    fun onSwitchReportsTheOnState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleSwitch(checked = true, onCheckedChange = {})
            }
        }
        compose.onNodeWithTag(TOGGLE_TEST_TAG).assertIsOn()
    }

    @Test
    fun smallSwitchAlsoCarriesSwitchSemantics() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleSwitch(checked = true, size = ToggleSize.Sm, onCheckedChange = {})
            }
        }
        compose.onNodeWithTag(TOGGLE_TEST_TAG).assertIsOn()
    }

    // ── Interaction: tapping reports the flipped boolean (web `onChange(!checked)`) ──────────────────────

    @Test
    fun tappingAnOffSwitchReportsTrue() {
        var reported: Boolean? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleSwitch(checked = false, onCheckedChange = { reported = it })
            }
        }
        val node = compose.onNodeWithTag(TOGGLE_TEST_TAG)
        node.assertHasClickAction().performClick()
        assertEquals(true, reported)
    }

    @Test
    fun tappingAnOnSwitchReportsFalse() {
        var reported: Boolean? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleSwitch(checked = true, onCheckedChange = { reported = it })
            }
        }
        compose.onNodeWithTag(TOGGLE_TEST_TAG).performClick()
        assertEquals(false, reported)
    }

    @Test
    fun tappingTogglesAndUpdatesTheRenderedState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var checked by remember { mutableStateOf(false) }
                ToggleSwitch(checked = checked, onCheckedChange = { checked = it })
            }
        }
        val node = compose.onNodeWithTag(TOGGLE_TEST_TAG)
        node.assertIsOff()
        node.performClick()
        node.assertIsOn()
    }

    // ── Accessibility: the label names the control, and an unlabelled switch takes a contentDescription ──

    @Test
    fun labelNamesTheSwitch() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleSwitch(checked = true, label = LABEL, onCheckedChange = {})
            }
        }
        compose.onNodeWithText(LABEL).assertIsDisplayed()
        compose.onNodeWithTag(TOGGLE_TEST_TAG).assertHasClickAction()
    }

    @Test
    fun tappingTheLabelAlsoTogglesTheSwitch() {
        var reported: Boolean? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleSwitch(checked = false, label = LABEL, onCheckedChange = { reported = it })
            }
        }
        // The whole row is one Role.Switch target, so clicking the label text toggles too (web wrapper onClick).
        compose.onNodeWithText(LABEL).performClick()
        assertEquals(true, reported)
    }

    @Test
    fun unlabelledSwitchExposesItsContentDescription() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ToggleSwitch(checked = false, contentDescription = DESCRIPTION, onCheckedChange = {})
            }
        }
        compose.onNodeWithContentDescription(DESCRIPTION).assertIsDisplayed()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ─────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Toggle(checked = false, onCheckedChange = {}, label = LABEL, logger = logger)
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "Toggle"), opened.single().fields)
        assertTrue("the label must never leak", logger.records.none { it.fields.containsValue(LABEL) })
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
        private const val LABEL = "Enable notifications"
        private const val DESCRIPTION = "Mute overnight alerts"
    }
}
