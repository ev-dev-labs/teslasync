package io.teslasync.android.sharedsurfaces.resourcespanel

import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.test.assertRangeInfoEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [ResourcesPanel] view — the parity port of the web `ResourcesPanel`
 * (web/src/components/status/ResourcesPanel.tsx). Covers what the offline model test cannot: the heading + each
 * row (label, value, meta) + footnote all paint; a row with a percent renders a usage bar carrying the right
 * progress semantics while a row without a percent renders none; the normal / warn / critical rows all paint a
 * full, non-blank row; an empty panel shows the friendly empty state instead of a blank box; the bar is named
 * for TalkBack; and the one-shot PII-safe `view.opened` diagnostic fires on mount. The offline
 * :android:testReleaseUnitTest gate covers the pure projection + diagnostics.
 */
class ResourcesPanelUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Content: the heading, every row, and the footnote paint ─────────────────────────────────────────────

    @Test
    fun panelRendersHeadingAllRowsAndFootnote() {
        mountContent(rows = sampleRows(), footnote = FOOTNOTE)

        compose.onNodeWithText(TITLE).assertExists()
        compose.onNodeWithText(MEMORY_LABEL).assertExists()
        compose.onNodeWithText(MEMORY_VALUE).assertExists()
        compose.onNodeWithText(MEMORY_META).assertExists()
        compose.onNodeWithText(POOL_LABEL).assertExists()
        compose.onNodeWithText(UPTIME_LABEL).assertExists()
        compose.onNodeWithText(FOOTNOTE).assertExists()
    }

    // ── Per-state: normal / warn / critical rows each paint a full, non-blank row ───────────────────────────

    @Test
    fun normalWarnAndCriticalRowsAllRenderTheirLabelAndValue() {
        mountContent(rows = sampleRows(), footnote = null)

        // normal (Memory 23%), warn (Goroutines 74%), critical (DB pool 92%) — all visible, none hidden.
        compose.onNodeWithText(MEMORY_LABEL).assertExists()
        compose.onNodeWithText(MEMORY_VALUE).assertExists()
        compose.onNodeWithText(GOROUTINES_LABEL).assertExists()
        compose.onNodeWithText(GOROUTINES_VALUE).assertExists()
        compose.onNodeWithText(POOL_LABEL).assertExists()
        compose.onNodeWithText(POOL_VALUE).assertExists()
    }

    // ── Bar: web `percent != null` gates the usage bar + its clamped fill ──────────────────────────────────

    @Test
    fun aRowWithPercentRendersAUsageBarWithItsProgressSemantics() {
        mountContent(rows = listOf(ResourceRow(label = MEMORY_LABEL, valueText = MEMORY_VALUE, percent = 50.0)), footnote = null)

        compose
            .onNodeWithTag(RESOURCES_PANEL_BAR_TAG, useUnmergedTree = true)
            .assertExists()
            .assertRangeInfoEquals(ProgressBarRangeInfo(0.5f, 0f..1f))
    }

    @Test
    fun anOverHundredPercentClampsTheBarFillToFull() {
        mountContent(rows = listOf(ResourceRow(label = POOL_LABEL, valueText = POOL_VALUE, percent = 120.0)), footnote = null)

        compose
            .onNodeWithTag(RESOURCES_PANEL_BAR_TAG, useUnmergedTree = true)
            .assertExists()
            .assertRangeInfoEquals(ProgressBarRangeInfo(1f, 0f..1f))
    }

    @Test
    fun aRowWithoutPercentRendersNoUsageBar() {
        mountContent(rows = listOf(ResourceRow(label = UPTIME_LABEL, valueText = UPTIME_VALUE)), footnote = null)

        compose.onNodeWithText(UPTIME_LABEL).assertExists()
        compose.onNodeWithTag(RESOURCES_PANEL_BAR_TAG, useUnmergedTree = true).assertDoesNotExist()
    }

    // ── Accessibility: the bar is named by its row label (web aria-label) ───────────────────────────────────

    @Test
    fun theUsageBarIsNamedByItsRowLabel() {
        mountContent(rows = listOf(ResourceRow(label = MEMORY_LABEL, valueText = MEMORY_VALUE, percent = 50.0)), footnote = null)

        compose.onNodeWithContentDescription(MEMORY_LABEL, useUnmergedTree = true).assertExists()
    }

    // ── Empty: web blank stack → a friendly, non-blank empty state ─────────────────────────────────────────

    @Test
    fun anEmptyPanelRendersTheFriendlyEmptyStateNotABlankBox() {
        mountContent(rows = emptyList(), footnote = null, emptyMessage = EMPTY_MESSAGE)

        compose.onNodeWithTag(RESOURCES_PANEL_ROOT_TAG).assertExists()
        compose.onNodeWithTag(RESOURCES_PANEL_EMPTY_TAG, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(EMPTY_MESSAGE).assertExists()
        // No bar is drawn when there are no rows.
        compose.onNodeWithTag(RESOURCES_PANEL_BAR_TAG, useUnmergedTree = true).assertDoesNotExist()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) fires on mount ──────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ResourcesPanel(title = TITLE, rows = sampleRows(), footnote = FOOTNOTE, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ResourcesPanel"), fields)
    }

    private fun mountContent(
        rows: List<ResourceRow>,
        footnote: String?,
        emptyMessage: String = EMPTY_MESSAGE,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ResourcesPanelContent(title = TITLE, rows = rows, footnote = footnote, emptyMessage = emptyMessage)
            }
        }
        compose.waitForIdle()
    }

    private fun sampleRows(): List<ResourceRow> =
        listOf(
            ResourceRow(label = MEMORY_LABEL, valueText = MEMORY_VALUE, metaText = MEMORY_META, percent = 23.0),
            ResourceRow(label = GOROUTINES_LABEL, valueText = GOROUTINES_VALUE, percent = 74.0),
            ResourceRow(label = POOL_LABEL, valueText = POOL_VALUE, metaText = POOL_META, percent = 92.0),
            ResourceRow(label = UPTIME_LABEL, valueText = UPTIME_VALUE),
        )

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
        // Instrumentation copy — the surface itself owns no strings (title/rows/footnote are caller-supplied).
        const val TITLE = "Resources"
        const val MEMORY_LABEL = "Memory"
        const val MEMORY_VALUE = "1.8 GB"
        const val MEMORY_META = "of 8 GB"
        const val GOROUTINES_LABEL = "Goroutines"
        const val GOROUTINES_VALUE = "412"
        const val POOL_LABEL = "DB pool"
        const val POOL_VALUE = "23 / 25"
        const val POOL_META = "in use"
        const val UPTIME_LABEL = "Uptime"
        const val UPTIME_VALUE = "6d 4h"
        const val FOOTNOTE = "CPU and disk usage need a new /system/resources endpoint."
        const val EMPTY_MESSAGE = "No data available"
    }
}
