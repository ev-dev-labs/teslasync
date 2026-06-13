// Off-device unit coverage for the AddAnnotationPopover surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the `<input type="date">` normalisation (web `toDateInputValue` / `toIsoTimestamp`
// + the epoch-millis bridge the Material 3 picker consumes), the label-required submit guard (web `!label.trim()`),
// the maxLength clamps (web `maxLength={50}` / `{200}`), the occurred-at resolution (web `editableDate ? … :
// timestamp`), the `onAdd` payload assembly (web `handleSubmit` — trimmed label, blank-description → null), the
// category wire/colour vocabulary + reverse lookup, the registry identifiers, and the PII-safe `view.opened`
// diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.addannotationpopover

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AddAnnotationPopoverModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- Date normalisation (web `toDateInputValue`) -----------------------------

    @Test
    fun toDateInputValue_readsFullInstantsInUtc() {
        assertEquals("2026-01-15", AddAnnotationDates.toDateInputValue("2026-01-15T00:00:00Z"))
        // Late-evening UTC stays on the same calendar day (web `getUTCDate`).
        assertEquals("2026-01-15", AddAnnotationDates.toDateInputValue("2026-01-15T23:59:00Z"))
        assertEquals("2026-03-09", AddAnnotationDates.toDateInputValue("2026-03-09T05:00:00+00:00"))
    }

    @Test
    fun toDateInputValue_acceptsBareDatesAndRejectsGarbage() {
        assertEquals("2026-01-15", AddAnnotationDates.toDateInputValue("2026-01-15"))
        assertEquals("", AddAnnotationDates.toDateInputValue(""))
        assertEquals("", AddAnnotationDates.toDateInputValue("not-a-date"))
    }

    // ---- Date inverse + epoch bridge (web `toIsoTimestamp`) ----------------------

    @Test
    fun toIsoTimestamp_pinsBareDateToUtcMidnight() {
        assertEquals("2026-02-01T00:00:00Z", AddAnnotationDates.toIsoTimestamp("2026-02-01"))
        assertEquals("", AddAnnotationDates.toIsoTimestamp(""))
        assertEquals("", AddAnnotationDates.toIsoTimestamp("2026/02/01"))
    }

    @Test
    fun epochMillis_roundTripsBareDatesAndRejectsGarbage() {
        val millis = AddAnnotationDates.toEpochMillis("2026-02-01")
        assertEquals("2026-02-01", AddAnnotationDates.fromEpochMillis(millis!!))
        assertNull(AddAnnotationDates.toEpochMillis(""))
        assertNull(AddAnnotationDates.toEpochMillis("nonsense"))
    }

    // ---- Label validation + maxLength clamps -------------------------------------

    @Test
    fun isLabelValid_requiresNonBlankAfterTrim() {
        assertFalse(AddAnnotationProjection.isLabelValid(""))
        assertFalse(AddAnnotationProjection.isLabelValid("   "))
        assertTrue(AddAnnotationProjection.isLabelValid("Battery replaced"))
        assertTrue(AddAnnotationProjection.isLabelValid("  x  "))
    }

    @Test
    fun clamps_truncateToWebMaxLengths() {
        assertEquals(
            AddAnnotationProjection.MAX_LABEL_LENGTH,
            AddAnnotationProjection.clampLabel("x".repeat(80)).length,
        )
        assertEquals("short", AddAnnotationProjection.clampLabel("short"))
        assertEquals(
            AddAnnotationProjection.MAX_DESCRIPTION_LENGTH,
            AddAnnotationProjection.clampDescription("y".repeat(400)).length,
        )
        assertEquals("note", AddAnnotationProjection.clampDescription("note"))
    }

    // ---- Occurred-at resolution (web `editableDate ? … : timestamp`) --------------

    @Test
    fun resolveOccurredAt_picksEditedDateOnlyWhenEditable() {
        assertEquals(
            "2026-02-01T00:00:00Z",
            AddAnnotationProjection.resolveOccurredAt(editableDate = true, editedDate = "2026-02-01", timestamp = "ignored"),
        )
        assertEquals(
            "2026-01-15T00:00:00Z",
            AddAnnotationProjection.resolveOccurredAt(editableDate = false, editedDate = "2026-02-01", timestamp = "2026-01-15T00:00:00Z"),
        )
    }

    // ---- Payload assembly (web `handleSubmit` → `onAdd`) -------------------------

    @Test
    fun buildResult_fixedDateTrimsLabelAndDropsBlankDescription() {
        val draft =
            AnnotationDraft(
                label = "  Battery replaced  ",
                category = AnnotationCategory.Maintenance,
                description = "  swapped to new pack  ",
            )
        val result = AddAnnotationProjection.buildResult(draft, editableDate = false, timestamp = "2026-01-15T00:00:00Z")!!
        assertEquals("Battery replaced", result.label)
        assertEquals(AnnotationCategory.Maintenance, result.category)
        assertEquals("swapped to new pack", result.description)
        assertEquals("2026-01-15T00:00:00Z", result.occurredAt)
    }

    @Test
    fun buildResult_blankDescriptionBecomesNull() {
        val draft = AnnotationDraft(label = "Trip to Tahoe", description = "   ")
        val result = AddAnnotationProjection.buildResult(draft, editableDate = false, timestamp = "2026-01-15T00:00:00Z")!!
        assertNull(result.description)
        // Default category mirrors the web initial state.
        assertEquals(AnnotationCategory.Milestone, result.category)
    }

    @Test
    fun buildResult_editableDateUsesEditedDate() {
        val draft = AnnotationDraft(label = "Upgrade", category = AnnotationCategory.Upgrade, editedDate = "2026-02-01")
        val result = AddAnnotationProjection.buildResult(draft, editableDate = true, timestamp = "2026-01-15T00:00:00Z")!!
        assertEquals("2026-02-01T00:00:00Z", result.occurredAt)
    }

    @Test
    fun buildResult_returnsNullForBlankLabelOrUnresolvedDate() {
        assertNull(
            AddAnnotationProjection.buildResult(
                AnnotationDraft(label = "   "),
                editableDate = false,
                timestamp = "2026-01-15T00:00:00Z",
            ),
        )
        // Editable, but the edited date is not a valid YYYY-MM-DD → occurred-at is empty → no-op (web guard).
        assertNull(
            AddAnnotationProjection.buildResult(
                AnnotationDraft(label = "Has label", editedDate = "nope"),
                editableDate = true,
                timestamp = "2026-01-15T00:00:00Z",
            ),
        )
        // Fixed date, but the timestamp itself is empty → no-op.
        assertNull(
            AddAnnotationProjection.buildResult(
                AnnotationDraft(label = "Has label"),
                editableDate = false,
                timestamp = "",
            ),
        )
    }

    // ---- Category vocabulary + colours (web `AnnotationCategory` / `ANNOTATION_COLORS`) ----

    @Test
    fun category_wireTokensMatchTheWebUnion() {
        assertEquals("milestone", AnnotationCategory.Milestone.wire)
        assertEquals("maintenance", AnnotationCategory.Maintenance.wire)
        assertEquals("trip", AnnotationCategory.Trip.wire)
        assertEquals("issue", AnnotationCategory.Issue.wire)
        assertEquals("upgrade", AnnotationCategory.Upgrade.wire)
        assertEquals("custom", AnnotationCategory.Custom.wire)
    }

    @Test
    fun category_coloursMirrorAnnotationColorsConstant() {
        assertEquals(0xFF3B82F6L, AnnotationCategory.Milestone.colorArgb)
        assertEquals(0xFFF59E0BL, AnnotationCategory.Maintenance.colorArgb)
        assertEquals(0xFF22C55EL, AnnotationCategory.Trip.colorArgb)
        assertEquals(0xFFEF4444L, AnnotationCategory.Issue.colorArgb)
        assertEquals(0xFFA855F7L, AnnotationCategory.Upgrade.colorArgb)
        assertEquals(0xFF94A3B8L, AnnotationCategory.Custom.colorArgb)
    }

    @Test
    fun category_fromWireResolvesKnownTokensAndFallsBackToDefault() {
        assertEquals(AnnotationCategory.Milestone, AnnotationCategory.DEFAULT)
        assertEquals(AnnotationCategory.Trip, AnnotationCategory.fromWire("trip"))
        assertEquals(AnnotationCategory.Custom, AnnotationCategory.fromWire("custom"))
        assertEquals(AnnotationCategory.Milestone, AnnotationCategory.fromWire("nonsense"))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("add-annotation-popover", AddAnnotationPopoverRegistration.ID)
        assertEquals("AddAnnotationPopover", AddAnnotationPopoverRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        AddAnnotationPopoverDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AddAnnotationPopover"), fields)
    }
}
