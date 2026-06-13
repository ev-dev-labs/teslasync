package io.teslasync.android.sharedsurfaces.annotationlist

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AnnotationList surface's pure logic — the native analogue of the web
 * annotation domain types (web/src/types/annotations.ts) the `AnnotationList` component consumes: the
 * [AnnotationCategory] palette mirrors `ANNOTATION_COLORS`, [AnnotationCategory.fromWire] mirrors the wire
 * union, [ChartAnnotationRow.toAnnotationEntry] mirrors `toDataAnnotation`, the [AnnotationListState] holder
 * mirrors the web parent's `annotations` state + `onRemove`, and the PII-safe `view.opened` diagnostic carries
 * only the surface slug. Runs in the offline `:app:testReleaseUnitTest` gate; the Compose rendering +
 * accessibility are covered on-device by AnnotationListUiTest.
 */
class AnnotationListModelTest {
    // ── Palette parity (web `ANNOTATION_COLORS`) ──────────────────────────────────────────────────────

    @Test
    fun categoryColorsMatchTheWebAnnotationColorMap() {
        // 0xFF + the exact hex from web/src/types/annotations.ts ANNOTATION_COLORS.
        assertEquals(0xFF3B82F6L, AnnotationCategory.Milestone.argbColor)
        assertEquals(0xFFF59E0BL, AnnotationCategory.Maintenance.argbColor)
        assertEquals(0xFF22C55EL, AnnotationCategory.Trip.argbColor)
        assertEquals(0xFFEF4444L, AnnotationCategory.Issue.argbColor)
        assertEquals(0xFFA855F7L, AnnotationCategory.Upgrade.argbColor)
        assertEquals(0xFF94A3B8L, AnnotationCategory.Custom.argbColor)
    }

    @Test
    fun everyCategoryColorIsFullyOpaque() {
        // Web hex colours are 6-digit (opaque); the native 0xAARRGGBB form must carry a 0xFF alpha byte.
        AnnotationCategory.entries.forEach { category ->
            val alpha = (category.argbColor ushr 24) and 0xFF
            assertEquals("alpha of ${category.name}", 0xFFL, alpha)
        }
    }

    // ── Wire mapping (web `AnnotationCategory` union) ─────────────────────────────────────────────────

    @Test
    fun fromWireMapsEveryCanonicalCategory() {
        assertEquals(AnnotationCategory.Milestone, AnnotationCategory.fromWire("milestone"))
        assertEquals(AnnotationCategory.Maintenance, AnnotationCategory.fromWire("maintenance"))
        assertEquals(AnnotationCategory.Trip, AnnotationCategory.fromWire("trip"))
        assertEquals(AnnotationCategory.Issue, AnnotationCategory.fromWire("issue"))
        assertEquals(AnnotationCategory.Upgrade, AnnotationCategory.fromWire("upgrade"))
        assertEquals(AnnotationCategory.Custom, AnnotationCategory.fromWire("custom"))
    }

    @Test
    fun fromWireIsCaseInsensitive() {
        assertEquals(AnnotationCategory.Milestone, AnnotationCategory.fromWire("Milestone"))
        assertEquals(AnnotationCategory.Issue, AnnotationCategory.fromWire("ISSUE"))
    }

    @Test
    fun fromWireFallsBackToCustomForAnUnknownCategory() {
        assertEquals(AnnotationCategory.Custom, AnnotationCategory.fromWire("warranty"))
        assertEquals(AnnotationCategory.Custom, AnnotationCategory.fromWire(""))
    }

    // ── Adapter: cached row -> render projection (web `toDataAnnotation`) ──────────────────────────────

    @Test
    fun toAnnotationEntryProjectsACachedRowOntoTheRenderShape() {
        val row =
            ChartAnnotationRow(
                id = 42,
                occurredAt = "2024-05-01T12:00:00Z",
                category = "maintenance",
                title = "Tires rotated",
                description = "Front-to-rear swap",
                scope = listOf("tire"),
            )

        val entry = row.toAnnotationEntry()

        // The numeric id is stringified so it flows through the remove key unchanged (web `String(row.id)`).
        assertEquals("42", entry.id)
        assertEquals("Tires rotated", entry.label)
        assertEquals("Front-to-rear swap", entry.description)
        assertEquals("2024-05-01T12:00:00Z", entry.timestamp)
        assertEquals(AnnotationCategory.Maintenance, entry.category)
    }

    @Test
    fun toAnnotationEntryPreservesANullDescription() {
        val row =
            ChartAnnotationRow(
                id = 7,
                occurredAt = "2024-01-01T00:00:00Z",
                category = "milestone",
                title = "100k miles",
                description = null,
            )

        assertNull(row.toAnnotationEntry().description)
    }

    @Test
    fun toAnnotationEntryRoutesAnUnknownRowCategoryToCustom() {
        val row =
            ChartAnnotationRow(
                id = 9,
                occurredAt = "2024-02-02T00:00:00Z",
                category = "warranty",
                title = "Out of warranty",
                description = null,
            )

        assertEquals(AnnotationCategory.Custom, row.toAnnotationEntry().category)
    }

    // ── State holder (web parent `annotations` state + `onRemove`) ────────────────────────────────────

    @Test
    fun stateStartsWithTheInitialEntries() {
        val state = AnnotationListState(listOf(entry("a"), entry("b")))

        assertEquals(listOf("a", "b"), state.entries.value.map { it.id })
    }

    @Test
    fun stateDefaultsToAnEmptyList() {
        assertTrue(AnnotationListState().entries.value.isEmpty())
    }

    @Test
    fun removeDropsTheMatchingEntry() {
        val state = AnnotationListState(listOf(entry("a"), entry("b"), entry("c")))

        state.remove("b")

        assertEquals(listOf("a", "c"), state.entries.value.map { it.id })
    }

    @Test
    fun removingAnAbsentIdIsANoOp() {
        val state = AnnotationListState(listOf(entry("a")))

        state.remove("zzz")

        assertEquals(listOf("a"), state.entries.value.map { it.id })
    }

    @Test
    fun submitReplacesTheEntries() {
        val state = AnnotationListState(listOf(entry("a")))

        state.submit(listOf(entry("x"), entry("y")))

        assertEquals(listOf("x", "y"), state.entries.value.map { it.id })
    }

    @Test
    fun submitRowsProjectsCachedRowsThroughTheAdapter() {
        val state = AnnotationListState()

        state.submitRows(
            listOf(
                ChartAnnotationRow(1, "t1", "trip", "Road trip", null),
                ChartAnnotationRow(2, "t2", "issue", "Squeak", "Front-left"),
            ),
        )

        val entries = state.entries.value
        assertEquals(listOf("1", "2"), entries.map { it.id })
        assertEquals(AnnotationCategory.Trip, entries[0].category)
        assertEquals(AnnotationCategory.Issue, entries[1].category)
        assertEquals("Front-left", entries[1].description)
    }

    @Test
    fun resetClearsEveryEntry() {
        val state = AnnotationListState(listOf(entry("a"), entry("b")))

        state.reset()

        assertTrue(state.entries.value.isEmpty())
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────

    @Test
    fun diagnosticsSlugMatchesThePromptMandatedSurfaceSlug() {
        assertEquals("AnnotationList", AnnotationListDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsThePiiSafeInfoEventOnce() {
        val logger = RecordingLogger()

        AnnotationListDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        // Only the slug is logged — never a label, description, or timestamp, which can carry user data.
        assertEquals(mapOf("surface" to "AnnotationList"), fields)
    }

    private fun entry(id: String): AnnotationEntry =
        AnnotationEntry(
            id = id,
            label = "Label $id",
            description = null,
            timestamp = "2024-01-01T00:00:00Z",
            category = AnnotationCategory.Custom,
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
}
