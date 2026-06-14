// Off-device coverage of the framework-free PrintButton model — the print-outcome mapping, the visible-label
// decision (web `iconOnly ? null : (label ?? printLabel)`), the accessible-name decision (web
// `ariaLabel ?? (iconOnly ? printLabel : undefined)`), the resting state, and the PII-safe diagnostics
// (slug + outcome / error type only, never anything about the printed page). Runs in the
// :android:testReleaseUnitTest gate; the state holder is covered by PrintButtonViewModelTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.printbutton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PrintButtonModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private val printLabel = "Print"

    // ── printOutcomeFor: launched vs platform-rejected ──────────────────────────────────────────────────

    @Test
    fun printOutcomeForLaunchedIsLaunched() {
        assertEquals(PrintOutcome.Launched, printOutcomeFor(launched = true))
    }

    @Test
    fun printOutcomeForRejectedIsFailed() {
        assertEquals(PrintOutcome.Failed, printOutcomeFor(launched = false))
    }

    // ── printButtonVisibleLabel(iconOnly, labelOverride, printLabel) ─────────────────────────────────────

    @Test
    fun visibleLabelIsThePrintLabelWhenLabeled() {
        assertEquals("Print", printButtonVisibleLabel(iconOnly = false, labelOverride = null, printLabel = printLabel))
    }

    @Test
    fun visibleLabelHonoursTheOverride() {
        assertEquals(
            "Export PDF",
            printButtonVisibleLabel(iconOnly = false, labelOverride = "Export PDF", printLabel = printLabel),
        )
    }

    @Test
    fun visibleLabelIsNullWhenIconOnly() {
        assertNull(printButtonVisibleLabel(iconOnly = true, labelOverride = null, printLabel = printLabel))
        assertNull(printButtonVisibleLabel(iconOnly = true, labelOverride = "Export PDF", printLabel = printLabel))
    }

    // ── printButtonAccessibleLabel(iconOnly, ariaLabel, labelOverride, printLabel) ───────────────────────

    @Test
    fun accessibleLabelPrefersExplicitAriaLabel() {
        assertEquals(
            "Print this page",
            printButtonAccessibleLabel(
                iconOnly = false,
                ariaLabel = "Print this page",
                labelOverride = null,
                printLabel = printLabel,
            ),
        )
        assertEquals(
            "Print this page",
            printButtonAccessibleLabel(
                iconOnly = true,
                ariaLabel = "Print this page",
                labelOverride = "Export PDF",
                printLabel = printLabel,
            ),
        )
    }

    @Test
    fun accessibleLabelIsNullForLabeledButtonWithoutAria() {
        // A labelled button lets its visible text speak (web `aria-label={undefined}`).
        assertNull(printButtonAccessibleLabel(iconOnly = false, ariaLabel = null, labelOverride = null, printLabel = printLabel))
        assertNull(printButtonAccessibleLabel(iconOnly = false, ariaLabel = null, labelOverride = "Export PDF", printLabel = printLabel))
    }

    @Test
    fun accessibleLabelForIconOnlyUsesOverrideThenPrintLabel() {
        assertEquals(
            "Print",
            printButtonAccessibleLabel(iconOnly = true, ariaLabel = null, labelOverride = null, printLabel = printLabel),
        )
        assertEquals(
            "Export PDF",
            printButtonAccessibleLabel(iconOnly = true, ariaLabel = null, labelOverride = "Export PDF", printLabel = printLabel),
        )
    }

    // ── resting state + registration ────────────────────────────────────────────────────────────────────

    @Test
    fun idleStateIsNotPrinting() {
        assertFalse(PrintButtonUiState.Idle.printing)
        assertFalse(PrintButtonUiState().printing)
    }

    @Test
    fun surfaceSlugIsTheMandatedDiagnosticsSlug() {
        assertEquals("PrintButton", PrintButtonRegistration.SLUG)
    }

    @Test
    fun perPlacementInstanceIdsAreUnique() {
        assertTrue(randomPrintButtonInstanceId() != randomPrintButtonInstanceId())
    }

    // ── diagnostics: PII-safe slug + outcome / error type only ──────────────────────────────────────────

    @Test
    fun viewOpenedRecordsSlugOnly() {
        val logger = RecordingLogger()
        recordPrintButtonOpened(logger)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_VIEW_OPENED, record.event)
        assertEquals(mapOf(FIELD_SURFACE to PrintButtonRegistration.SLUG), record.fields)
    }

    @Test
    fun printRecordsSlugAndLowercasedOutcome() {
        val logger = RecordingLogger()
        recordPrintButtonPrint(logger, PrintOutcome.Launched)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_PRINT, record.event)
        assertEquals(
            mapOf(FIELD_SURFACE to PrintButtonRegistration.SLUG, FIELD_OUTCOME to "launched"),
            record.fields,
        )
    }

    @Test
    fun everyOutcomeMapsToItsLowercaseName() {
        val logger = RecordingLogger()
        PrintOutcome.entries.forEach { recordPrintButtonPrint(logger, it) }
        val outcomes = logger.records.map { it.fields.getValue(FIELD_OUTCOME) }
        assertEquals(listOf("launched", "failed"), outcomes)
    }

    @Test
    fun beforePrintErrorRecordsSlugAndErrorTypeOnly() {
        val logger = RecordingLogger()
        recordPrintButtonBeforePrintError(logger, "IllegalStateException")
        val record = logger.records.single()
        assertEquals(LogLevel.Error, record.level)
        assertEquals(EVENT_BEFORE_PRINT_ERROR, record.event)
        assertEquals(
            mapOf(FIELD_SURFACE to PrintButtonRegistration.SLUG, FIELD_ERROR_TYPE to "IllegalStateException"),
            record.fields,
        )
    }

    @Test
    fun diagnosticsNeverCarryPageContentFields() {
        val logger = RecordingLogger()
        recordPrintButtonOpened(logger)
        recordPrintButtonPrint(logger, PrintOutcome.Launched)
        recordPrintButtonBeforePrintError(logger, "IllegalStateException")
        // Only the surface slug + the bounded outcome / error-type enums are ever recorded — never any field
        // describing the page being printed.
        val allowedKeys = setOf(FIELD_SURFACE, FIELD_OUTCOME, FIELD_ERROR_TYPE)
        assertTrue(logger.records.all { record -> record.fields.keys.all { it in allowedKeys } })
    }
}
