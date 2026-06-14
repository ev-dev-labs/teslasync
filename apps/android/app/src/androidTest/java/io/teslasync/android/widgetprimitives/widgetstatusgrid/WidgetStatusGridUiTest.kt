package io.teslasync.android.widgetprimitives.widgetstatusgrid

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the WidgetStatusGrid surface across every branch the web
 * component renders (web/src/features/dashboard/widgets/shared/WidgetStatusGrid.tsx): the empty state, the
 * populated grid with its labels + values + per-cell tags, the compact mode that hides the values, and the five
 * status tones each rendering their cell. Asserts the EmptyState message is shown and announced to TalkBack, each
 * cell exposes one coherent content description, the value is suppressed in compact mode, and the one-shot
 * PII-safe `view.opened` diagnostic fires once with only the surface slug. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure model + diagnostics logic off-device.
 */
class WidgetStatusGridUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Empty state: the shared EmptyState message renders and is announced (web `cells.length === 0`) ─────────

    @Test
    fun emptyStateRendersTheMessageAndIsAnnounced() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetStatusGridContent(cells = emptyList(), emptyMessage = EMPTY_MESSAGE)
                }
            }
        }
        compose.onNodeWithText(EMPTY_MESSAGE).assertIsDisplayed()
        compose.onNodeWithContentDescription(EMPTY_MESSAGE).assertIsDisplayed()
        compose.onNodeWithTag(statusCellTestTag("battery")).assertDoesNotExist()
    }

    // ── Populated: labels, values, and per-cell tags all render (web populated grid) ──────────────────────────

    @Test
    fun populatedShowsLabelsValuesAndCellTags() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 420) {
                    WidgetStatusGridContent(cells = CELLS, cols = 3)
                }
            }
        }
        compose.onNodeWithTag(WIDGET_STATUS_GRID_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Battery").assertIsDisplayed()
        compose.onNodeWithText("Healthy").assertIsDisplayed()
        compose.onNodeWithTag(statusCellTestTag("battery")).assertIsDisplayed()
        compose.onNodeWithTag(statusCellTestTag("charge")).assertIsDisplayed()
    }

    // ── Every tone renders its cell (web `ok | warning | error | inactive | unknown`) ─────────────────────────

    @Test
    fun everyToneRendersItsCell() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 420) {
                    WidgetStatusGridContent(cells = CELLS, cols = 3)
                }
            }
        }
        compose.onNodeWithText("Battery").assertIsDisplayed()
        compose.onNodeWithText("Tire pressure").assertIsDisplayed()
        compose.onNodeWithText("Charge port").assertIsDisplayed()
        compose.onNodeWithText("Sentry").assertIsDisplayed()
        compose.onNodeWithText("Climate").assertIsDisplayed()
    }

    // ── Compact: the values are suppressed, the labels still render (web `{!compact && cell.value && …}`) ──────

    @Test
    fun compactModeHidesTheValuesButKeepsTheLabels() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetStatusGridContent(cells = CELLS, cols = 4, compact = true)
                }
            }
        }
        compose.onNodeWithText("Battery").assertIsDisplayed()
        compose.onNodeWithText("Healthy").assertDoesNotExist()
        compose.onNodeWithText("Fault").assertDoesNotExist()
    }

    // ── Accessibility: each cell exposes one coherent label + value content description ────────────────────────

    @Test
    fun cellExposesACoherentContentDescription() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 420) {
                    WidgetStatusGridContent(cells = CELLS, cols = 3)
                }
            }
        }
        compose.onNodeWithContentDescription("Battery, Healthy").assertIsDisplayed()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ──────────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 420) {
                    WidgetStatusGrid(cells = CELLS, cols = 3, logger = logger)
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "WidgetStatusGrid"), opened.single().fields)
        assertTrue("no cell label may leak", logger.records.none { it.fields.containsValue("Battery") })
    }

    @Composable
    private fun Frame(
        width: Int = 320,
        content: @Composable () -> Unit,
    ) {
        Box(
            modifier =
                Modifier
                    .width(width.dp)
                    .height(240.dp),
            content = { content() },
        )
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
        private const val EMPTY_MESSAGE = "No statuses to show"
        private val CELLS =
            listOf(
                StatusCell(id = "battery", label = "Battery", tone = StatusTone.Ok, value = "Healthy"),
                StatusCell(id = "tires", label = "Tire pressure", tone = StatusTone.Warning, value = "Low"),
                StatusCell(id = "charge", label = "Charge port", tone = StatusTone.Error, value = "Fault"),
                StatusCell(id = "sentry", label = "Sentry", tone = StatusTone.Inactive, value = "Off"),
                StatusCell(id = "climate", label = "Climate", tone = StatusTone.Unknown, value = "Unknown"),
            )
    }
}
