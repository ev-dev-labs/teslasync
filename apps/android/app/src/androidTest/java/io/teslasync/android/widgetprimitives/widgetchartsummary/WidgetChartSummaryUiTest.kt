package io.teslasync.android.widgetprimitives.widgetchartsummary

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
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
 * On-device Compose UI + accessibility verification of the WidgetChartSummary frame across every branch the web
 * component renders (web/src/features/dashboard/widgets/shared/WidgetChartSummary.tsx): the empty state, the
 * populated stat row + chart, the compact mode that hides the chart, the no-stats mode that hides the row, and
 * the inline stat unit. Asserts the EmptyState message is shown and announced to TalkBack, the stat label /
 * value / unit are readable, the chart slot renders only when it should, and the one-shot PII-safe `view.opened`
 * diagnostic fires once with only the surface slug. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure model + diagnostics logic off-device.
 */
class WidgetChartSummaryUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Empty state: the shared EmptyState message renders and is announced (web `isEmpty` branch) ─────────

    @Test
    fun emptyStateRendersTheMessageAndIsAnnounced() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetChartSummaryContent(
                        stats = emptyList(),
                        isEmpty = true,
                        emptyMessage = EMPTY_MESSAGE,
                    ) { ChartSlot() }
                }
            }
        }
        compose.onNodeWithText(EMPTY_MESSAGE).assertIsDisplayed()
        compose.onNodeWithContentDescription(EMPTY_MESSAGE).assertIsDisplayed()
        compose.onNodeWithTag(CHART_TAG).assertDoesNotExist()
    }

    // ── Wide populated: the stat row and the chart both render (web stats + `!compact` chart) ──────────────

    @Test
    fun widePopulatedShowsTheStatRowAndTheChart() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 420) {
                    WidgetChartSummaryContent(stats = STATS) { ChartSlot() }
                }
            }
        }
        compose.onNodeWithText("Avg power").assertIsDisplayed()
        compose.onNodeWithText("42").assertIsDisplayed()
        compose.onNodeWithTag(CHART_TAG).assertIsDisplayed()
    }

    @Test
    fun statUnitIsDisplayedNextToTheValue() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 420) {
                    WidgetChartSummaryContent(stats = STATS) { ChartSlot() }
                }
            }
        }
        compose.onNodeWithText("kW").assertIsDisplayed()
    }

    // ── Compact: the chart is suppressed, the stat row still renders (web `{!compact && chart}`) ───────────

    @Test
    fun compactModeHidesTheChartButKeepsTheStats() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetChartSummaryContent(stats = STATS, compact = true) { ChartSlot() }
                }
            }
        }
        compose.onNodeWithText("Avg power").assertIsDisplayed()
        compose.onNodeWithTag(CHART_TAG).assertDoesNotExist()
    }

    // ── No stats: the row is hidden, the chart still renders (web `{stats.length > 0 && statRow}`) ─────────

    @Test
    fun noStatsHidesTheRowButKeepsTheChart() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame {
                    WidgetChartSummaryContent(stats = emptyList()) { ChartSlot() }
                }
            }
        }
        compose.onNodeWithText("Avg power").assertDoesNotExist()
        compose.onNodeWithTag(CHART_TAG).assertIsDisplayed()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ───────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 420) {
                    WidgetChartSummary(stats = STATS, logger = logger) { ChartSlot() }
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "WidgetChartSummary"), opened.single().fields)
        assertTrue("no stat value may leak", logger.records.none { it.fields.containsValue("42") })
    }

    @Composable
    private fun Frame(
        width: Int = 300,
        content: @Composable () -> Unit,
    ) {
        Box(
            modifier =
                Modifier
                    .width(width.dp)
                    .height(200.dp),
            content = { content() },
        )
    }

    @Composable
    private fun ChartSlot() {
        Text(text = CHART_LABEL, modifier = Modifier.testTag(CHART_TAG))
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
        private const val EMPTY_MESSAGE = "Nothing to chart yet"
        private const val CHART_TAG = "chart-slot"
        private const val CHART_LABEL = "chart"
        private val STATS =
            listOf(
                ChartSummaryStat(label = "Avg power", value = "42", unit = "kW"),
                ChartSummaryStat(label = "Peak", value = "118", unit = "kW"),
            )
    }
}
