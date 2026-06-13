package io.teslasync.android.sharedsurfaces.rangepicker

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate

/**
 * On-device Compose UI + accessibility verification of the RangePicker surface across every state the web
 * component renders (web/src/components/forms/RangePicker.tsx): the always-visible trigger (active label + range
 * + merged TalkBack name), the open preset list (with the active preset marked selected), a preset click
 * committing immediately, the calendar entry + compare toggle, the `presetsOnly` collapse that hides the calendar
 * + footer, and the one-shot PII-safe `view.opened` diagnostic on mount. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure model + diagnostics logic.
 */
class RangePickerUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Trigger: the active label, the formatted range, the merged accessible name + click action ────────

    @Test
    fun triggerShowsTheActiveLabelRangeAndAccessibleName() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangePickerTrigger(activeLabel = ACTIVE_LABEL, rangeText = RANGE_TEXT, accessibleName = A11Y_NAME)
            }
        }

        compose.onNodeWithText(ACTIVE_LABEL).assertIsDisplayed()
        compose.onNodeWithText(RANGE_TEXT).assertIsDisplayed()
        compose.onNodeWithContentDescription(A11Y_NAME).assertIsDisplayed().assertHasClickAction()
    }

    // ── Open preset list: presets render, the active one is selected, the calendar entry + compare show ──

    @Test
    fun panelRendersPresetsActiveSelectionCalendarEntryAndCompare() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangePickerPanel(
                    presets = defaultPresets(),
                    activePresetId = "7d",
                    totalDays = 7,
                    enableCompare = true,
                    compare = true,
                )
            }
        }

        compose.onNodeWithText(TODAY).assertIsDisplayed()
        compose.onNodeWithText(LAST_7_DAYS).assertIsSelected()
        compose.onNodeWithText(PICK_RANGE).assertIsDisplayed()
        compose.onNodeWithText(COMPARE).assertIsDisplayed()
    }

    // ── Preset click commits immediately with the preset id (web `handlePreset` → onChange(r, id)) ───────

    @Test
    fun pickingAPresetInvokesTheCallbackWithItsId() {
        var picked: String? = null
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangePickerPanel(presets = defaultPresets(), activePresetId = null, totalDays = 7, onPick = { picked = it })
            }
        }

        compose.onNodeWithText(TODAY).performClick()

        assertEquals("today", picked)
    }

    // ── presetsOnly: the calendar entry + compare toggle are hidden (web `presetsOnly`) ─────────────────

    @Test
    fun presetsOnlyHidesTheCalendarEntryAndCompareToggle() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangePickerPanel(
                    presets = defaultPresets(),
                    activePresetId = "30d",
                    totalDays = 30,
                    presetsOnly = true,
                    enableCompare = true,
                )
            }
        }

        compose.onNodeWithText(TODAY).assertIsDisplayed()
        compose.onAllNodesWithText(PICK_RANGE).assertCountEquals(0)
        compose.onAllNodesWithText(COMPARE).assertCountEquals(0)
    }

    // ── Stateful surface: the trigger opens the preset popover, and mount emits view.opened once ─────────

    @Test
    fun clickingTheTriggerOpensThePresetPopover() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangePicker(
                    value = CUSTOM_VALUE,
                    onChange = { _, _ -> },
                    today = TODAY_DATE,
                    logger = RecordingLogger(),
                )
            }
        }

        compose.onAllNodesWithText(ALL_TIME).assertCountEquals(0)
        compose.onNodeWithTag(RANGE_PICKER_TRIGGER_TEST_TAG).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(ALL_TIME).assertIsDisplayed()
    }

    @Test
    fun mountingEmitsViewOpenedExactlyOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RangePicker(value = CUSTOM_VALUE, onChange = { _, _ -> }, today = TODAY_DATE, logger = logger)
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals("RangePicker", opened.single().fields["surface"])
    }

    private fun defaultPresets(): List<DatePresetSpec> = RangePickerLogic.presetsFor(RangePickerLogic.DEFAULT_PRESET_IDS)

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
        private const val ACTIVE_LABEL = "Last 7 days"
        private const val RANGE_TEXT = "May 9 – May 15, 2024"
        private const val A11Y_NAME = "Date range, Last 7 days, May 9 – May 15, 2024"
        private const val TODAY = "Today"
        private const val LAST_7_DAYS = "Last 7 days"
        private const val PICK_RANGE = "Pick a date range"
        private const val COMPARE = "Compare to previous period"
        private const val ALL_TIME = "All time"
        private val TODAY_DATE = LocalDate.of(2024, 5, 15)
        private val CUSTOM_VALUE = RangePickerValue("2024-05-03", "2024-05-09")
    }
}
