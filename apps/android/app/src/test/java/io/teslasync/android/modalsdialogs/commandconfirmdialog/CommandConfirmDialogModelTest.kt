// Off-device unit coverage for the CommandConfirmDialog modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the count-down seed + decrement reducer (web `useState(countdown)`
// / `setRemaining`), the typed-confirmation gate (web trimmed case-insensitive `confirmInput` compare), the
// combined `canConfirm` predicate (web `remaining === 0 && (!confirmInput || typedMatches)`), the confirm
// hand-off guard (web Enter `canConfirm && !loading`), the dynamic-message key/fallback selection (web
// `def.confirmKey ?? ''` / `def.confirmFallback ?? …`), the `Confirm (Ns)` count-down label, the registry
// identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.commandconfirmdialog

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandConfirmDialogModelTest {
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

    // ---- Count-down seed + reducer (web `useState(countdown)` / `setRemaining(prev => …)`) ----------

    @Test
    fun initialRemaining_clampsNegativeAndAbsentToZero() {
        assertEquals(5, CommandConfirmDialogProjection.initialRemaining(5))
        assertEquals(0, CommandConfirmDialogProjection.initialRemaining(0))
        assertEquals(0, CommandConfirmDialogProjection.initialRemaining(-3))
    }

    @Test
    fun tick_decrementsToFloorOfZero() {
        assertEquals(4, CommandConfirmDialogProjection.tick(5))
        assertEquals(1, CommandConfirmDialogProjection.tick(2))
        // web `prev <= 1 ? 0 : prev - 1` — both 1 and 0 resolve to 0, never negative.
        assertEquals(0, CommandConfirmDialogProjection.tick(1))
        assertEquals(0, CommandConfirmDialogProjection.tick(0))
    }

    @Test
    fun isCountingDown_isTrueOnlyWhileSecondsRemain() {
        assertTrue(CommandConfirmDialogProjection.isCountingDown(5))
        assertTrue(CommandConfirmDialogProjection.isCountingDown(1))
        assertFalse(CommandConfirmDialogProjection.isCountingDown(0))
    }

    // ---- Typed-confirmation gate (web `!confirmInput || inputValue.trim().toUpperCase() === …`) ----

    @Test
    fun requiresTypedConfirmation_onlyWhenTokenPresent() {
        assertFalse(CommandConfirmDialogProjection.requiresTypedConfirmation(null))
        assertFalse(CommandConfirmDialogProjection.requiresTypedConfirmation(""))
        assertTrue(CommandConfirmDialogProjection.requiresTypedConfirmation("ERASE"))
    }

    @Test
    fun typedConfirmationMatches_ignoresCaseAndSurroundingWhitespace() {
        // No gate -> always matched.
        assertTrue(CommandConfirmDialogProjection.typedConfirmationMatches(null, ""))
        assertTrue(CommandConfirmDialogProjection.typedConfirmationMatches("", "anything"))
        // Gate present: exact / case / trimmed variants all match; partials do not.
        assertTrue(CommandConfirmDialogProjection.typedConfirmationMatches("ERASE", "ERASE"))
        assertTrue(CommandConfirmDialogProjection.typedConfirmationMatches("ERASE", "erase"))
        assertTrue(CommandConfirmDialogProjection.typedConfirmationMatches("ERASE", "  erase  "))
        assertFalse(CommandConfirmDialogProjection.typedConfirmationMatches("ERASE", ""))
        assertFalse(CommandConfirmDialogProjection.typedConfirmationMatches("ERASE", "ERAS"))
    }

    // ---- Combined arm-able predicate (web `canConfirm`) ------------------------------------------

    @Test
    fun canConfirm_requiresZeroRemainingAndSatisfiedTypedGate() {
        // Still counting down -> never arm-able, even with a satisfied/absent gate.
        assertFalse(CommandConfirmDialogProjection.canConfirm(5, null, ""))
        assertFalse(CommandConfirmDialogProjection.canConfirm(1, "ERASE", "ERASE"))
        // Count-down done, no gate -> arm-able.
        assertTrue(CommandConfirmDialogProjection.canConfirm(0, null, ""))
        // Count-down done, gate satisfied -> arm-able; unmet -> not.
        assertTrue(CommandConfirmDialogProjection.canConfirm(0, "ERASE", "erase"))
        assertFalse(CommandConfirmDialogProjection.canConfirm(0, "ERASE", "no"))
    }

    @Test
    fun confirmActionable_alsoBlockedByLoading() {
        // web Enter guard `canConfirm && !loading`.
        assertTrue(CommandConfirmDialogProjection.confirmActionable(0, null, "", loading = false))
        assertFalse(CommandConfirmDialogProjection.confirmActionable(0, null, "", loading = true))
        assertTrue(CommandConfirmDialogProjection.confirmActionable(0, "ERASE", "ERASE", loading = false))
        assertFalse(CommandConfirmDialogProjection.confirmActionable(5, null, "", loading = false))
    }

    // ---- Dynamic-message key/fallback selection (web `def.confirmKey ?? '' , def.confirmFallback ?? …`) ----

    @Test
    fun confirmMessageKey_isKeyOrEmptyString() {
        assertEquals("", CommandConfirmDialogProjection.confirmMessageKey(null))
        assertEquals("commands.security.confirmErase", CommandConfirmDialogProjection.confirmMessageKey("commands.security.confirmErase"))
    }

    @Test
    fun confirmMessageFallback_prefersConfirmBodyThenFallsBackToLabel() {
        assertEquals(
            "This will erase all user data. Continue?",
            CommandConfirmDialogProjection.confirmMessageFallback("This will erase all user data. Continue?", "Erase Data"),
        )
        // Absent / blank confirm body degrades to the command label (documented native last resort).
        assertEquals("Erase Data", CommandConfirmDialogProjection.confirmMessageFallback(null, "Erase Data"))
        assertEquals("Erase Data", CommandConfirmDialogProjection.confirmMessageFallback("   ", "Erase Data"))
    }

    // ---- Count-down Confirm label (web `\`${confirm} (${remaining}s)\``) -------------------------

    @Test
    fun countdownConfirmLabel_appendsSecondsSuffixOnlyWhileCounting() {
        assertEquals("Confirm (5s)", CommandConfirmDialogProjection.countdownConfirmLabel("Confirm", 5))
        assertEquals("Confirm (1s)", CommandConfirmDialogProjection.countdownConfirmLabel("Confirm", 1))
        assertEquals("Confirm", CommandConfirmDialogProjection.countdownConfirmLabel("Confirm", 0))
    }

    // ---- Def contract defaults (web optional `countdown` / `confirmInput` / confirm keys) --------

    @Test
    fun commandConfirmDef_defaultsMatchWebOptionalFields() {
        val def = CommandConfirmDef(labelKey = "commands.security.eraseData", labelFallback = "Erase Data")
        assertEquals(0, def.countdown)
        assertEquals(null, def.confirmInput)
        assertEquals(null, def.confirmKey)
        assertEquals(null, def.confirmFallback)
    }

    // ---- Registry + diagnostics ------------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("command-confirm-dialog", CommandConfirmDialogRegistration.ID)
        assertEquals("CommandConfirmDialog", CommandConfirmDialogRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        CommandConfirmDialogDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "CommandConfirmDialog"), fields)
    }
}
