// Off-device unit coverage for the AcknowledgeAlertDialog surface's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the maxLength clamp (web `maxLength={NOTE_MAX + 50}`), the trim (web `note.trim()`),
// the over-limit guard at the `NOTE_MAX` boundary (web `tooLong`, the web "disables Submit over 1000 chars" test), the
// submit-enablement guard across the submitting / over-limit / empty-note branches (web `submitting || tooLong`, the
// web "allows submitting with an empty / whitespace note" + "disables while submitting" tests), the trimmed-note
// resolution handed to `onSubmit` (web "passes the trimmed note to onSubmit"), the registry identifiers, and the
// PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.acknowledgealertdialog

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AcknowledgeAlertDialogModelTest {
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

    // ---- maxLength clamp (web `maxLength={NOTE_MAX + 50}`) ------------------------

    @Test
    fun maxInputLength_isNoteMaxPlusGrace() {
        assertEquals(1000, AcknowledgeAlertProjection.NOTE_MAX)
        assertEquals(50, AcknowledgeAlertProjection.NOTE_INPUT_GRACE)
        assertEquals(1050, AcknowledgeAlertProjection.MAX_INPUT_LENGTH)
    }

    @Test
    fun clampNote_truncatesToTheInputCapAndPassesShortNotesThrough() {
        assertEquals("short note", AcknowledgeAlertProjection.clampNote("short note"))
        // Over-typing past NOTE_MAX (but within the grace) is preserved so the error state is reachable.
        assertEquals(1001, AcknowledgeAlertProjection.clampNote("x".repeat(1001)).length)
        // Anything past the hard cap is truncated to MAX_INPUT_LENGTH (web `maxLength`).
        assertEquals(
            AcknowledgeAlertProjection.MAX_INPUT_LENGTH,
            AcknowledgeAlertProjection.clampNote("y".repeat(5000)).length,
        )
    }

    // ---- trim (web `const trimmed = note.trim()`) --------------------------------

    @Test
    fun trimmedNote_stripsSurroundingWhitespace() {
        assertEquals("Investigating MQTT", AcknowledgeAlertProjection.trimmedNote("  Investigating MQTT  "))
        assertEquals("", AcknowledgeAlertProjection.trimmedNote(""))
        assertEquals("", AcknowledgeAlertProjection.trimmedNote("   "))
    }

    // ---- over-limit guard (web `tooLong = trimmed.length > NOTE_MAX`) -------------

    @Test
    fun isTooLong_isFalseAtTheBoundaryAndTrueJustPastIt() {
        assertFalse(AcknowledgeAlertProjection.isTooLong(""))
        assertFalse(AcknowledgeAlertProjection.isTooLong("   "))
        // Exactly NOTE_MAX trimmed chars is allowed (web `>` is strict).
        assertFalse(AcknowledgeAlertProjection.isTooLong("x".repeat(AcknowledgeAlertProjection.NOTE_MAX)))
        // One past the limit flips the field to its error state (web "disables Submit over 1000 chars" test).
        assertTrue(AcknowledgeAlertProjection.isTooLong("x".repeat(AcknowledgeAlertProjection.NOTE_MAX + 1)))
        // Trailing/leading whitespace does not count toward the limit (the trimmed length is what matters).
        assertFalse(AcknowledgeAlertProjection.isTooLong("   " + "x".repeat(AcknowledgeAlertProjection.NOTE_MAX) + "   "))
    }

    // ---- submit-enablement guard (web `submitting || tooLong`) --------------------

    @Test
    fun canSubmit_allowsEmptyAndWhitespaceNotes() {
        // Web "allows submitting with an empty note" / "whitespace-only note collapses to empty".
        assertTrue(AcknowledgeAlertProjection.canSubmit("", submitting = false))
        assertTrue(AcknowledgeAlertProjection.canSubmit("   ", submitting = false))
        assertTrue(AcknowledgeAlertProjection.canSubmit("Investigating MQTT", submitting = false))
    }

    @Test
    fun canSubmit_isBlockedWhileSubmitting() {
        // Web "disables Submit + Cancel while submitting=true".
        assertFalse(AcknowledgeAlertProjection.canSubmit("", submitting = true))
        assertFalse(AcknowledgeAlertProjection.canSubmit("Investigating MQTT", submitting = true))
    }

    @Test
    fun canSubmit_isBlockedWhenOverTheLimit() {
        // Web `disabled={submitting || tooLong}`.
        assertFalse(AcknowledgeAlertProjection.canSubmit("x".repeat(AcknowledgeAlertProjection.NOTE_MAX + 1), submitting = false))
        // At the boundary it stays enabled.
        assertTrue(AcknowledgeAlertProjection.canSubmit("x".repeat(AcknowledgeAlertProjection.NOTE_MAX), submitting = false))
    }

    // ---- trimmed-note resolution (web `onSubmit(trimmed)`) -----------------------

    @Test
    fun resolveSubmitNote_handsBackTheTrimmedNote() {
        // Web "passes the trimmed note to onSubmit".
        assertEquals("Investigating MQTT", AcknowledgeAlertProjection.resolveSubmitNote("  Investigating MQTT  "))
        // Web "allows submitting with an empty note" — the empty string is a valid submit value.
        assertEquals("", AcknowledgeAlertProjection.resolveSubmitNote(""))
        // Web "whitespace-only note collapses to empty".
        assertEquals("", AcknowledgeAlertProjection.resolveSubmitNote("   "))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("acknowledge-alert-dialog", AcknowledgeAlertDialogRegistration.ID)
        assertEquals("AcknowledgeAlertDialog", AcknowledgeAlertDialogRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        AcknowledgeAlertDialogDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AcknowledgeAlertDialog"), fields)
    }
}
