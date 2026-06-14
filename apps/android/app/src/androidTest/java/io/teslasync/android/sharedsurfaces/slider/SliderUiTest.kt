package io.teslasync.android.sharedsurfaces.slider

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertRangeInfoEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performSemanticsAction
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the Slider surface across every branch the web component
 * renders (web/src/components/ui/Slider.tsx): the discrete vs continuous track, the live value span, the
 * label-shown vs label-hidden row, the disabled dim, and the value report on drag. Asserts the
 * `ProgressBarRangeInfo` range/step semantics, the `stateDescription` value announcement (the native
 * `aria-valuetext`), the `contentDescription` accessible name (the label / `aria-label`), the disabled state, the
 * reported value through the `SetProgress` action, and the one-shot PII-safe `view.opened` diagnostic. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection + diagnostics off-device.
 */
class SliderUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Per-state: the track carries the projected range + discrete-step semantics (web min/max/step) ──────

    @Test
    fun discreteTrackReportsTheProjectedRangeInfo() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SliderField(value = 7f, min = 0f, max = 10f, onValueChange = {}, label = LABEL, step = 1f)
            }
        }
        compose
            .onNodeWithTag(SLIDER_TEST_TAG)
            .assertRangeInfoEquals(ProgressBarRangeInfo(current = 7f, range = 0f..10f, steps = 9))
    }

    // ── Accessibility: the value is announced (aria-valuetext) and the label names the control (aria-label) ─

    @Test
    fun theFormattedValueIsAnnouncedAsTheStateDescription() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SliderField(
                    value = 80f,
                    min = 0f,
                    max = 100f,
                    onValueChange = {},
                    label = LABEL,
                    step = 5f,
                    formatValue = { "${it.toInt()}%" },
                )
            }
        }
        compose.onNodeWithTag(SLIDER_TEST_TAG).assert(hasStateDescription("80%"))
        // The same formatted copy is shown in the live value span.
        compose.onNodeWithText("80%").assertIsDisplayed()
    }

    @Test
    fun theVisibleLabelNamesTheSlider() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SliderField(value = 50f, min = 0f, max = 100f, onValueChange = {}, label = LABEL, step = 1f)
            }
        }
        compose.onNodeWithText(LABEL).assertIsDisplayed()
        compose.onNodeWithContentDescription(LABEL).assertIsDisplayed()
    }

    @Test
    fun hiddenLabelStillNamesTheSlider() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SliderField(
                    value = 50f,
                    min = 0f,
                    max = 100f,
                    onValueChange = {},
                    label = LABEL,
                    step = 1f,
                    showLabel = false,
                )
            }
        }
        // The visible label row is gone, but the control keeps its accessible name (web `aria-label`).
        compose.onNodeWithContentDescription(LABEL).assertIsDisplayed()
        compose.onNodeWithText(LABEL).assertDoesNotExist()
    }

    // ── Disabled: dimmed and non-interactive (web `disabled`) ─────────────────────────────────────────────

    @Test
    fun disabledSliderIsNotEnabled() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SliderField(
                    value = 50f,
                    min = 0f,
                    max = 100f,
                    onValueChange = {},
                    label = LABEL,
                    step = 1f,
                    enabled = false,
                )
            }
        }
        compose.onNodeWithTag(SLIDER_TEST_TAG).assertIsNotEnabled()
    }

    // ── Interaction: moving the thumb reports the new value (web `onChange`) ──────────────────────────────

    @Test
    fun movingTheThumbReportsTheNewValue() {
        var reported: Float? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                SliderField(
                    value = 0f,
                    min = 0f,
                    max = 10f,
                    onValueChange = { reported = it },
                    label = LABEL,
                    step = 1f,
                )
            }
        }
        compose
            .onNodeWithTag(SLIDER_TEST_TAG)
            .performSemanticsAction(SemanticsActions.SetProgress) { it(7f) }
        assertEquals(7f, reported!!, FLOAT_TOLERANCE)
    }

    @Test
    fun movingTheThumbUpdatesTheRenderedValue() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                var value by remember { mutableStateOf(0f) }
                SliderField(
                    value = value,
                    min = 0f,
                    max = 10f,
                    onValueChange = { value = it },
                    label = LABEL,
                    step = 1f,
                )
            }
        }
        val node = compose.onNodeWithTag(SLIDER_TEST_TAG)
        node.assertRangeInfoEquals(ProgressBarRangeInfo(current = 0f, range = 0f..10f, steps = 9))
        node.performSemanticsAction(SemanticsActions.SetProgress) { it(4f) }
        node.assertRangeInfoEquals(ProgressBarRangeInfo(current = 4f, range = 0f..10f, steps = 9))
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ──────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Slider(
                    value = 50f,
                    min = 0f,
                    max = 100f,
                    onValueChange = {},
                    label = LABEL,
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "Slider"), opened.single().fields)
        assertTrue("the label must never leak", logger.records.none { it.fields.containsValue(LABEL) })
    }

    private fun hasStateDescription(value: String): SemanticsMatcher =
        SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, value)

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
        private const val LABEL = "Charge limit"
        private const val FLOAT_TOLERANCE = 0.001f
    }
}
