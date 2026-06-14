// Off-device verification of the EditableText surface's pure logic — the native mirror of every decision the web
// component makes (web/src/components/ui/EditableText.tsx): the five-way commit classifier (no-op / empty /
// validator-rejected / duplicate re-submit / save), the live per-keystroke validation, the display-text / ghost
// resolution, and the PII-safe diagnostics slug. Because the composable is a thin render layer over
// EditableTextModel, the per-branch assertions here double as the surface's per-state snapshot. No Compose /
// Android framework / HTTP — runs in the :android:testReleaseUnitTest gate; the on-device render + accessibility
// live in EditableTextUiTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/EditableText) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.editabletext

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EditableTextModelTest {
    // ── registration slug mirrors the prompt-mandated surface slug ──────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("EditableText", EDITABLE_TEXT_SLUG)
        assertEquals(EDITABLE_TEXT_SLUG, EditableTextDiagnostics.SLUG)
    }

    // ── decideCommit: every web `commitDraft` guard, in order ───────────────────────

    @Test
    fun unchangedDraftIsANoOpExit() {
        // Web: `if (next === current) { setEditing(false); return }` — no server call.
        assertEquals(CommitDecision.Exit, decideCommit("Home", "Home", null, EMPTY, NEVER))
        // Trim-only differences are still a no-op (both normalise to the same value).
        assertEquals(CommitDecision.Exit, decideCommit("  Home  ", "Home", null, EMPTY, NEVER))
    }

    @Test
    fun emptyDraftIsInvalidWithTheEmptyMessage() {
        // Web: `if (next === '') validationError = t('editableText.error.empty', ...)`.
        assertEquals(CommitDecision.Invalid(EMPTY), decideCommit("", "Home", null, EMPTY, NEVER))
        assertEquals(CommitDecision.Invalid(EMPTY), decideCommit("   ", "Home", null, EMPTY, NEVER))
    }

    @Test
    fun emptyToEmptyExitsRatherThanErroring() {
        // The no-op check precedes the empty check: clearing an already-empty value just leaves edit mode.
        assertEquals(CommitDecision.Exit, decideCommit("", "", null, EMPTY, NEVER))
    }

    @Test
    fun validatorRejectionIsInvalidWithTheValidatorMessage() {
        // Web: `const v = validate(next); if (v) validationError = v`.
        val validate: (String) -> String? = { if (it == "bad") "Name taken" else null }
        assertEquals(CommitDecision.Invalid("Name taken"), decideCommit("bad", "Home", null, EMPTY, validate))
    }

    @Test
    fun duplicateResubmitExitsWithoutCallingTheServerAgain() {
        // Web: `if (lastSubmittedRef.current === next) { setEditing(false); return }` — the Enter-then-blur guard.
        assertEquals(CommitDecision.Exit, decideCommit("Garage", "Home", "Garage", EMPTY, NEVER))
    }

    @Test
    fun changedValidDraftIsASaveWithTheTrimmedValue() {
        // Web: falls through to `await onSave(next)` with the trimmed value.
        assertEquals(CommitDecision.Save("Garage"), decideCommit("  Garage  ", "Home", null, EMPTY, NEVER))
        // A different lastSubmitted does not block a genuinely new value.
        assertEquals(CommitDecision.Save("Garage"), decideCommit("Garage", "Home", "Cabin", EMPTY, NEVER))
    }

    @Test
    fun validationPrecedesTheDuplicateGuard() {
        // An invalid duplicate is still reported invalid (the user must fix it), never silently exited.
        val validate: (String) -> String? = { "always" }
        assertEquals(CommitDecision.Invalid("always"), decideCommit("dupe", "Home", "dupe", EMPTY, validate))
    }

    // ── liveValidationError: web `handleInputChange` ────────────────────────────────

    @Test
    fun liveValidationSuppressesEmptyButSurfacesValidatorErrors() {
        val validate: (String) -> String? = { if (it.length < 3) "Too short" else null }
        // Empty (or whitespace) yields no error live — the web does not pre-empt "empty" on every backspace.
        assertNull(liveValidationError("", validate))
        assertNull(liveValidationError("   ", validate))
        // A non-empty draft surfaces the validator message immediately, trimmed.
        assertEquals("Too short", liveValidationError("  ab ", validate))
        assertNull(liveValidationError("abcd", validate))
    }

    @Test
    fun liveValidationWithNoValidatorAlwaysClears() {
        // Web "no validate ⇒ setError(null)".
        assertNull(liveValidationError("anything", NEVER))
    }

    // ── resolveDisplayText: web `visibleText` / `isPlaceholder` ─────────────────────

    @Test
    fun displayShowsTheValueWhenPresent() {
        val resolved = resolveDisplayText("Home", "Unnamed")
        assertEquals("Home", resolved.text)
        assertTrue(!resolved.isGhost)
    }

    @Test
    fun displayShowsTheGhostWhenValueEmptyAndGhostProvided() {
        val resolved = resolveDisplayText("", "Unnamed")
        assertEquals("Unnamed", resolved.text)
        assertTrue(resolved.isGhost)
    }

    @Test
    fun displayShowsEmptyValueWhenNoGhostProvided() {
        // No ghost ⇒ render the (empty) value, never flagged as ghost (web `isPlaceholder` is false).
        assertEquals(EditableDisplayText("", isGhost = false), resolveDisplayText("", null))
        assertEquals(EditableDisplayText("", isGhost = false), resolveDisplayText("", ""))
    }

    // ── normalise: the canonical trim ───────────────────────────────────────────────

    @Test
    fun normaliseTrimsBothEnds() {
        assertEquals("Home", normaliseEditableText("  Home  "))
        assertEquals("", normaliseEditableText("   "))
    }

    // ── diagnostics: one PII-safe view.opened (P1/S11) ──────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        EditableTextDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no value, draft, or error can leak through the diagnostic.
        assertEquals(mapOf("surface" to "EditableText"), records[0].fields)
    }

    private companion object {
        const val EMPTY = "Value cannot be empty"
        val NEVER: (String) -> String? = { null }
    }
}
