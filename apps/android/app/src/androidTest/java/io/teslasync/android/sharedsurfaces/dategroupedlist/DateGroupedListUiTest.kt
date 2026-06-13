package io.teslasync.android.sharedsurfaces.dategroupedlist

import androidx.compose.material3.Text
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
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
 * On-device verification of the [DateGroupedList] view — the parity port of the web `DateGroupedList`
 * component (web/src/components/data-display/DateGroupedList.tsx). Covers what the offline model test cannot:
 * each web state renders correctly (empty -> the container with no sections, populated -> one date-divider
 * section with its items per group), each group's header is an accessible merged heading node carrying the
 * date label + relative label + summary readout, the stateful overload renders the P1/S8 holder's groups, and
 * the one-shot PII-safe `view.opened` diagnostic fires. The offline `:android:testReleaseUnitTest` gate covers
 * the pure projection + state holder + diagnostics.
 */
class DateGroupedListUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: empty -> the container renders, but no sections (web empty container) ──────────────────

    @Test
    fun anEmptyListRendersTheContainerWithNoSections() {
        mount(emptyList())

        compose.onNodeWithTag(DATE_GROUPED_LIST_TAG).assertExists()
        // No groups -> no section headers, so no heading nodes and no group section tags.
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)).assertCountEquals(0)
        compose.onNodeWithTag(DATE_GROUP_SECTION_TAG_PREFIX + GROUP_ONE_KEY).assertDoesNotExist()
    }

    // ── State: populated -> one section (header + items) per group ─────────────────────────────────────

    @Test
    fun aPopulatedListRendersASectionWithItsItemsPerGroup() {
        mount(sampleGroups())

        compose.onNodeWithTag(DATE_GROUP_SECTION_TAG_PREFIX + GROUP_ONE_KEY).assertExists()
        compose.onNodeWithTag(DATE_GROUP_SECTION_TAG_PREFIX + GROUP_TWO_KEY).assertExists()
        // Header labels render (unmerged tree: the header merges its descendants for the TalkBack readout).
        compose.onNodeWithText(GROUP_ONE_LABEL, useUnmergedTree = true).assertExists()
        compose.onNodeWithText(GROUP_TWO_LABEL, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("· $GROUP_ONE_RELATIVE", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(GROUP_ONE_SUMMARY, useUnmergedTree = true).assertExists()
        // Every item renders, in both groups.
        compose.onNodeWithText("Morning commute").assertExists()
        compose.onNodeWithText("Evening drive").assertExists()
        compose.onNodeWithText("Road trip").assertExists()
        compose.onNodeWithText("Grocery run").assertExists()
    }

    // ── Accessibility: each group header is a heading node carrying the merged readout ─────────────────

    @Test
    fun eachGroupHeaderIsAHeadingNodeWithTheMergedReadout() {
        mount(sampleGroups())

        // The merged readout leads with the date label, then the relative label and summary.
        compose.onNodeWithContentDescription(GROUP_ONE_READOUT).assertExists()
        compose.onNodeWithContentDescription(GROUP_TWO_READOUT).assertExists()
        // One navigable heading per group (the web `<section aria-labelledby>` made a TalkBack heading).
        compose.onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading)).assertCountEquals(2)
    }

    // ── Stateful overload: renders the P1/S8 holder's groups ───────────────────────────────────────────

    @Test
    fun theStatefulOverloadRendersTheHoldersGroups() {
        val state = DateGroupedListState(sampleGroups())
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DateGroupedList(state = state, logger = RecordingLogger()) { item, _ -> Text(item) }
            }
        }
        compose.waitForIdle()

        compose.onNodeWithTag(DATE_GROUP_SECTION_TAG_PREFIX + GROUP_ONE_KEY).assertExists()
        compose.onNodeWithText("Morning commute").assertExists()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DateGroupedList(groups = sampleGroups(), logger = logger) { item, _ -> Text(item) }
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "DateGroupedList"), fields)
    }

    private fun mount(groups: List<DateGroupedListGroup<String>>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                DateGroupedList(groups = groups, logger = RecordingLogger()) { item, _ -> Text(item) }
            }
        }
        compose.waitForIdle()
    }

    private fun sampleGroups(): List<DateGroupedListGroup<String>> =
        listOf(
            DateGroupedListGroup(
                dateKey = GROUP_ONE_KEY,
                dateLabel = GROUP_ONE_LABEL,
                relativeLabel = GROUP_ONE_RELATIVE,
                summary = GROUP_ONE_SUMMARY,
                items = listOf("Morning commute", "Evening drive"),
            ),
            DateGroupedListGroup(
                dateKey = GROUP_TWO_KEY,
                dateLabel = GROUP_TWO_LABEL,
                relativeLabel = GROUP_TWO_RELATIVE,
                summary = GROUP_TWO_SUMMARY,
                items = listOf("Road trip", "Grocery run"),
            ),
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
        const val GROUP_ONE_KEY = "2026-05-09"
        const val GROUP_ONE_LABEL = "May 9, 2026"
        const val GROUP_ONE_RELATIVE = "3 days ago"
        const val GROUP_ONE_SUMMARY = "2 drives · 6.2 mi"
        const val GROUP_ONE_READOUT = "May 9, 2026, 3 days ago, 2 drives · 6.2 mi"

        const val GROUP_TWO_KEY = "2026-04-24"
        const val GROUP_TWO_LABEL = "Apr 24, 2026"
        const val GROUP_TWO_RELATIVE = "18 days ago"
        const val GROUP_TWO_SUMMARY = "2 drives · 39.9 mi"
        const val GROUP_TWO_READOUT = "Apr 24, 2026, 18 days ago, 2 drives · 39.9 mi"
    }
}
