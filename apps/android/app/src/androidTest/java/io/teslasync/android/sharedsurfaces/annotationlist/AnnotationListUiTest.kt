package io.teslasync.android.sharedsurfaces.annotationlist

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodes
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [AnnotationList] view — the parity port of the web `AnnotationList` component
 * (web/src/components/charts/AnnotationList.tsx). Covers what the offline model test cannot: each web state
 * renders correctly (empty -> nothing, populated -> a titled row list), the remove affordance is an
 * accessible, individually-focusable touch target wired to the callback / the P1/S8 holder, the dot's category
 * is spoken through the merged row readout, and the one-shot PII-safe `view.opened` diagnostic fires. The
 * offline `:app:testReleaseUnitTest` gate covers the pure adapter + state holder + diagnostics.
 */
class AnnotationListUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: empty -> renders nothing (web `if (annotations.length === 0) return null`) ─────────────

    @Test
    fun anEmptyListRendersNothing() {
        mount(emptyList())

        compose.onNodeWithTag(ANNOTATION_LIST_TITLE_TAG).assertDoesNotExist()
        // No rows, so no remove buttons — the surface is entirely absent.
        compose.onAllNodes(hasClickAction()).assertCountEquals(0)
    }

    // ── State: populated -> title + one row (with a remove button) per entry ──────────────────────────

    @Test
    fun aPopulatedListRendersTheTitleAndOneRowPerEntry() {
        mount(listOf(milestone(), maintenance()))

        compose.onNodeWithTag(ANNOTATION_LIST_TITLE_TAG).assertExists()
        compose.onNodeWithTag(ANNOTATION_ROW_TAG_PREFIX + "1").assertExists()
        compose.onNodeWithTag(ANNOTATION_ROW_TAG_PREFIX + "2").assertExists()
        compose.onAllNodesWithContentDescription(REMOVE_LABEL).assertCountEquals(2)
    }

    // ── Accessibility: the merged row readout leads with the category, so the dot colour is spoken ─────

    @Test
    fun eachRowReadsItsCategoryLabelTimestampAsOneMergedNode() {
        mount(listOf(milestone()))

        // The merged node leads with the localized category name, then the label and timestamp.
        compose
            .onNodeWithContentDescription(CATEGORY_MILESTONE, substring = true)
            .assertExists()
        compose
            .onNodeWithContentDescription("100k miles", substring = true)
            .assertExists()
    }

    // ── Accessibility: every remove button carries the localized content description ───────────────────

    @Test
    fun everyRemoveButtonHasTheLocalizedAccessibleName() {
        mount(listOf(milestone(), maintenance()))

        // Exact-match on the localized "Remove annotation" name proves no row shipped a blank/raw label.
        compose.onAllNodesWithContentDescription(REMOVE_LABEL).assertCountEquals(2)
    }

    // ── Interaction: the stateless view forwards the tapped id to onRemove (web `onRemove`) ────────────

    @Test
    fun tappingRemoveForwardsTheEntryIdToTheCallback() {
        val removed = mutableListOf<String>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AnnotationList(
                    annotations = listOf(milestone()),
                    onRemove = { removed += it },
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()

        compose.onAllNodesWithContentDescription(REMOVE_LABEL).onFirst().performClick()
        compose.waitForIdle()

        assertEquals(listOf("1"), removed)
    }

    // ── Interaction: the stateful overload removes the row through the P1/S8 holder ────────────────────

    @Test
    fun tappingRemoveOnTheStatefulOverloadDropsTheRowThroughTheHolder() {
        val state = AnnotationListState(listOf(milestone(), maintenance()))
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AnnotationList(state = state, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()

        compose.onAllNodesWithContentDescription(REMOVE_LABEL).onFirst().performClick()
        compose.waitForIdle()

        // The first row is gone; the second remains — the holder mutated and the list recomposed.
        compose.onNodeWithTag(ANNOTATION_ROW_TAG_PREFIX + "1").assertDoesNotExist()
        compose.onNodeWithTag(ANNOTATION_ROW_TAG_PREFIX + "2").assertExists()
        compose.onAllNodesWithContentDescription(REMOVE_LABEL).assertCountEquals(1)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AnnotationList(annotations = listOf(milestone()), onRemove = {}, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AnnotationList"), fields)
    }

    private fun mount(annotations: List<AnnotationEntry>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AnnotationList(annotations = annotations, onRemove = {}, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()
    }

    private fun milestone(): AnnotationEntry =
        AnnotationEntry(
            id = "1",
            label = "100k miles",
            description = "Odometer milestone",
            timestamp = "2024-01-01T00:00:00Z",
            category = AnnotationCategory.Milestone,
        )

    private fun maintenance(): AnnotationEntry =
        AnnotationEntry(
            id = "2",
            label = "Tires rotated",
            description = null,
            timestamp = "2024-05-01T12:00:00Z",
            category = AnnotationCategory.Maintenance,
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
        // The en catalog values (instrumentation default locale) for the strings the surface renders.
        const val REMOVE_LABEL = "Remove annotation"
        const val CATEGORY_MILESTONE = "Milestone"
    }
}
