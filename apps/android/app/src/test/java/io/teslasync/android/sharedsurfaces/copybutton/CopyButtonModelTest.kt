// Off-device coverage of the framework-free CopyButton model — the copy-outcome mapping (web `try` vs
// `catch`), the visible-label decision (web `iconOnly ? null : (label ?? (copied ? copiedLabel :
// copyLabel))`), the accessible-name decision (web `ariaLabel ?? (iconOnly ? … : undefined)`), the
// resting state, and the PII-safe diagnostics (slug + outcome only, never the copied text). Runs in the
// :android:testReleaseUnitTest gate; the state holder is covered by CopyButtonViewModelTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copybutton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CopyButtonModelTest {
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

    private val labels = CopyButtonLabels(copy = "Copy", copied = "Copied")

    // ── copyOutcomeFor: web try (success) vs catch (failure) ────────────────────────────────────────────

    @Test
    fun copyOutcomeForSucceededIsCopied() {
        assertEquals(CopyOutcome.Copied, copyOutcomeFor(succeeded = true))
    }

    @Test
    fun copyOutcomeForFailedIsFailed() {
        assertEquals(CopyOutcome.Failed, copyOutcomeFor(succeeded = false))
    }

    // ── copyButtonVisibleLabel(copied, iconOnly, labelOverride, labels) ──────────────────────────────────

    @Test
    fun visibleLabelIsCopyWhenIdle() {
        assertEquals("Copy", copyButtonVisibleLabel(false, false, null, labels))
    }

    @Test
    fun visibleLabelIsCopiedWhenCopied() {
        assertEquals("Copied", copyButtonVisibleLabel(true, false, null, labels))
    }

    @Test
    fun visibleLabelHonoursOverrideInBothStates() {
        // The web `label` prop pins a fixed label that does NOT toggle to "Copied".
        assertEquals("Copy link", copyButtonVisibleLabel(false, false, "Copy link", labels))
        assertEquals("Copy link", copyButtonVisibleLabel(true, false, "Copy link", labels))
    }

    @Test
    fun visibleLabelIsNullWhenIconOnly() {
        assertNull(copyButtonVisibleLabel(false, true, null, labels))
        assertNull(copyButtonVisibleLabel(true, true, "Copy link", labels))
    }

    // ── copyButtonAccessibleLabel(copied, iconOnly, ariaLabel, labelOverride, labels) ────────────────────

    @Test
    fun accessibleLabelPrefersExplicitAriaLabel() {
        assertEquals("Copy token", copyButtonAccessibleLabel(false, true, "Copy token", "x", labels))
        assertEquals("Copy token", copyButtonAccessibleLabel(true, false, "Copy token", null, labels))
    }

    @Test
    fun accessibleLabelIsNullForLabeledButtonWithoutAria() {
        // A labelled button lets its visible text speak (web `aria-label={undefined}`).
        assertNull(copyButtonAccessibleLabel(false, false, null, null, labels))
        assertNull(copyButtonAccessibleLabel(true, false, null, "x", labels))
    }

    @Test
    fun accessibleLabelForIconOnlyIdleUsesOverrideThenCopy() {
        assertEquals("Copy", copyButtonAccessibleLabel(false, true, null, null, labels))
        assertEquals("Copy link", copyButtonAccessibleLabel(false, true, null, "Copy link", labels))
    }

    @Test
    fun accessibleLabelForIconOnlyCopiedUsesCopied() {
        // Icon-only + copied announces "Copied" even when a label override is set (web `copied ? copiedLabel : …`).
        assertEquals("Copied", copyButtonAccessibleLabel(true, true, null, "Copy link", labels))
    }

    // ── resting state + constants ───────────────────────────────────────────────────────────────────────

    @Test
    fun idleStateIsNotCopied() {
        assertFalse(CopyButtonUiState.Idle.copied)
        assertFalse(CopyButtonUiState().copied)
    }

    @Test
    fun copiedConfirmationWindowMatchesTheWebTwoSecondTimeout() {
        assertEquals(2_000L, COPIED_RESET_MILLIS)
    }

    @Test
    fun surfaceSlugIsTheMandatedDiagnosticsSlug() {
        assertEquals("CopyButton", CopyButtonRegistration.SLUG)
    }

    @Test
    fun perPlacementInstanceIdsAreUnique() {
        // Each placement gets its own holder key so dense lists never share one confirmation window.
        assertTrue(randomCopyButtonInstanceId() != randomCopyButtonInstanceId())
    }

    // ── diagnostics: PII-safe slug + outcome only ───────────────────────────────────────────────────────

    @Test
    fun viewOpenedRecordsSlugOnly() {
        val logger = RecordingLogger()
        recordCopyButtonOpened(logger)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_VIEW_OPENED, record.event)
        assertEquals(mapOf(FIELD_SURFACE to CopyButtonRegistration.SLUG), record.fields)
    }

    @Test
    fun copyRecordsSlugAndLowercasedOutcome() {
        val logger = RecordingLogger()
        recordCopyButtonCopy(logger, CopyOutcome.Copied)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_COPY, record.event)
        assertEquals(
            mapOf(FIELD_SURFACE to CopyButtonRegistration.SLUG, FIELD_OUTCOME to "copied"),
            record.fields,
        )
    }

    @Test
    fun everyOutcomeMapsToItsLowercaseName() {
        val logger = RecordingLogger()
        CopyOutcome.entries.forEach { recordCopyButtonCopy(logger, it) }
        val outcomes = logger.records.map { it.fields.getValue(FIELD_OUTCOME) }
        assertEquals(listOf("copied", "failed"), outcomes)
    }

    @Test
    fun copyDiagnosticsNeverLeakATextField() {
        val logger = RecordingLogger()
        recordCopyButtonCopy(logger, CopyOutcome.Copied)
        // Only the surface slug + the outcome enum are ever recorded — never the copied text, so a
        // diagnostics line can never leak what a user copied.
        val record = logger.records.single()
        assertEquals(setOf(FIELD_SURFACE, FIELD_OUTCOME), record.fields.keys)
    }
}
