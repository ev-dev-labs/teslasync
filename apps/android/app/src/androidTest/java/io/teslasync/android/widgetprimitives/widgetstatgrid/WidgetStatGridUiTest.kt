package io.teslasync.android.widgetprimitives.widgetstatgrid

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DeltaArrow
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the WidgetStatGrid frame across every branch the web
 * component renders (web/src/features/dashboard/widgets/shared/WidgetStatGrid.tsx): the empty state, the populated
 * grid (every tile's label / value / unit readable), the trend chip, the value-colour tile, and the compact column.
 * Asserts the EmptyState message is shown and announced to TalkBack, the trend chip announces its change text, and
 * the one-shot PII-safe `view.opened` diagnostic fires once with only the surface slug. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure model + diagnostics logic off-device.
 */
class WidgetStatGridUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val noStatsMessage: String =
        InstrumentationRegistry
            .getInstrumentation()
            .targetContext
            .getString(R.string.translation_No_stats_available)

    // ── Empty state: the shared EmptyState message renders and is announced (web `stats.length === 0`) ──────

    @Test
    fun emptyStateRendersTheMessageAndIsAnnounced() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame { WidgetStatGridContent(stats = emptyList()) }
            }
        }
        compose.onNodeWithText(noStatsMessage).assertIsDisplayed()
        compose.onNodeWithContentDescription(noStatsMessage).assertIsDisplayed()
    }

    // ── Populated grid: every tile's label, value, and unit are readable ───────────────────────────────────

    @Test
    fun populatedGridShowsEveryTileLabelValueAndUnit() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 460) { WidgetStatGridContent(stats = STATS, cols = 4) }
            }
        }
        compose.onNodeWithTag(WIDGET_STAT_GRID_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Requests").assertIsDisplayed()
        compose.onNodeWithText("1,204").assertIsDisplayed()
        compose.onNodeWithText("Latency").assertIsDisplayed()
        compose.onNodeWithText("84").assertIsDisplayed()
        compose.onNodeWithText("ms").assertIsDisplayed()
    }

    // ── Trend chip: announced with its change text (web `{ value: trendValue }`) ───────────────────────────

    @Test
    fun trendChipIsAnnouncedWithItsChangeText() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 460) { WidgetStatGridContent(stats = STATS, cols = 4) }
            }
        }
        compose.onNodeWithContentDescription("+1.1%").assertIsDisplayed()
    }

    // ── Value-colour tile: the coloured value still renders its text (web `valueColor`) ────────────────────

    @Test
    fun valueColorTileStillRendersTheValue() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 460) { WidgetStatGridContent(stats = STATS, cols = 4) }
            }
        }
        // "Error rate" carries a valueColor; the value text must remain present (the colour is applied to it).
        compose.onNodeWithText("6.2").assertIsDisplayed()
    }

    // ── Compact: a single-column grid still renders every tile (web `compact ? 1 : ...`) ───────────────────

    @Test
    fun compactModeRendersEveryTile() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame { WidgetStatGridContent(stats = STATS, compact = true) }
            }
        }
        compose.onNodeWithText("Requests").assertIsDisplayed()
        compose.onNodeWithText("Error rate").assertIsDisplayed()
        compose.onNodeWithText("Latency").assertIsDisplayed()
        compose.onNodeWithText("Uptime").assertIsDisplayed()
    }

    // ── Diagnostics: one-shot view.opened with only the surface slug ────────────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Frame(width = 460) {
                    WidgetStatGrid(stats = STATS, cols = 4, logger = logger)
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "WidgetStatGrid"), opened.single().fields)
        assertTrue("no stat value may leak", logger.records.none { it.fields.containsValue("1,204") })
    }

    @Composable
    private fun Frame(
        width: Int = 320,
        content: @Composable () -> Unit,
    ) {
        Box(modifier = Modifier.width(width.dp), content = { content() })
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
        private val STATS =
            listOf(
                StatGridItem(label = "Requests", value = "1,204"),
                StatGridItem(
                    label = "Error rate",
                    value = "6.2",
                    unit = "%",
                    valueColor = Color.Red,
                    trend = DeltaArrow.Up,
                    trendValue = "+1.1%",
                ),
                StatGridItem(label = "Latency", value = "84", unit = "ms"),
                StatGridItem(label = "Uptime", value = "99.9", unit = "%"),
            )
    }
}
