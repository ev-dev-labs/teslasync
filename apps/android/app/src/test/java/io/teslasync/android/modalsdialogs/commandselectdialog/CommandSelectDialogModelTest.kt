// Off-device unit coverage for the CommandSelectDialog modal/dialog's pure model (P3 acceptance: adapter +
// per-branch + diagnostics tests). Exercises the option-list projections (web `sc.options.map` / its empty case),
// the per-option disabled guard (web `disabled={loading}`), the optional description sub-line (web `opt.description
// && …`), the registry identifiers, and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.commandselectdialog

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CommandSelectDialogModelTest {
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

    private val options =
        listOf(
            CommandSelectOption(value = "0", label = "Off", description = "Turn the seat heater off"),
            CommandSelectOption(value = "1", label = "Low"),
            CommandSelectOption(value = "3", label = "High", description = "Maximum heat"),
        )

    // ---- Option list presence (web `sc.options.map` / empty case) ----------------

    @Test
    fun hasOptionsAndIsEmpty_areComplementary() {
        assertTrue(CommandSelectDialogProjection.hasOptions(options))
        assertFalse(CommandSelectDialogProjection.isEmpty(options))

        assertFalse(CommandSelectDialogProjection.hasOptions(emptyList()))
        assertTrue(CommandSelectDialogProjection.isEmpty(emptyList()))
    }

    // ---- Per-option disabled guard (web `disabled={loading}`) --------------------

    @Test
    fun isOptionEnabled_isTheInverseOfLoading() {
        assertTrue(CommandSelectDialogProjection.isOptionEnabled(loading = false))
        assertFalse(CommandSelectDialogProjection.isOptionEnabled(loading = true))
    }

    // ---- Optional description sub-line (web `opt.description && …`) ---------------

    @Test
    fun hasDescription_isTrueOnlyForANonBlankDescription() {
        assertTrue(CommandSelectDialogProjection.hasDescription(CommandSelectOption("0", "Off", "Turn off")))
        assertFalse(CommandSelectDialogProjection.hasDescription(CommandSelectOption("1", "Low")))
        assertFalse(CommandSelectDialogProjection.hasDescription(CommandSelectOption("2", "Medium", description = "")))
        assertFalse(CommandSelectDialogProjection.hasDescription(CommandSelectOption("3", "High", description = "   ")))
    }

    @Test
    fun visibleDescription_returnsTheDescriptionOnlyWhenNonBlank() {
        assertEquals(
            "Turn off",
            CommandSelectDialogProjection.visibleDescription(CommandSelectOption("0", "Off", "Turn off")),
        )
        assertNull(CommandSelectDialogProjection.visibleDescription(CommandSelectOption("1", "Low")))
        assertNull(CommandSelectDialogProjection.visibleDescription(CommandSelectOption("2", "Medium", description = "")))
        assertNull(CommandSelectDialogProjection.visibleDescription(CommandSelectOption("3", "High", description = "  ")))
    }

    // ---- Registry + diagnostics --------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("command-select-dialog", CommandSelectDialogRegistration.ID)
        assertEquals("CommandSelectDialog", CommandSelectDialogRegistration.SLUG)
    }

    @Test
    fun recordViewOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        CommandSelectDialogDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "CommandSelectDialog"), fields)
    }
}
