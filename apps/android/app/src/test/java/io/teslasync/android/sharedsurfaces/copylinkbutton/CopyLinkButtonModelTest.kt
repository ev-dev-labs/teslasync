// Off-device coverage of the framework-free CopyLinkButton model — the copy-outcome mapping (web `try`
// vs `catch`), the visible-label decision (web `copied ? t('…copied') : t('…action')`), the resting
// state, and the PII-safe diagnostics (slug + outcome only, never the copied link). Runs in the
// :android:testReleaseUnitTest gate; the state holder is covered by CopyLinkButtonViewModelTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.copylinkbutton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CopyLinkButtonModelTest {
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

    // ── copyOutcomeFor: web try (success) vs catch (failure) ────────────────────────────────────────────

    @Test
    fun copyOutcomeForSucceededIsCopied() {
        assertEquals(CopyOutcome.Copied, copyOutcomeFor(succeeded = true))
    }

    @Test
    fun copyOutcomeForFailedIsFailed() {
        assertEquals(CopyOutcome.Failed, copyOutcomeFor(succeeded = false))
    }

    // ── visibleCopyLabel: web copied ? t('…copied') : t('…action') ──────────────────────────────────────

    @Test
    fun visibleLabelIsTheActionLabelWhenIdle() {
        assertEquals("Copy link", visibleCopyLabel(copied = false, copyLabel = "Copy link", copiedLabel = "Copied"))
    }

    @Test
    fun visibleLabelIsTheCopiedLabelWhenCopied() {
        assertEquals("Copied", visibleCopyLabel(copied = true, copyLabel = "Copy link", copiedLabel = "Copied"))
    }

    // ── resting state + constants ───────────────────────────────────────────────────────────────────────

    @Test
    fun idleStateIsNotCopied() {
        assertFalse(CopyLinkUiState.Idle.copied)
        assertFalse(CopyLinkUiState().copied)
    }

    @Test
    fun copiedConfirmationWindowMatchesTheWebTwoSecondTimeout() {
        assertEquals(2_000L, COPIED_RESET_MILLIS)
    }

    @Test
    fun surfaceSlugIsTheMandatedDiagnosticsSlug() {
        assertEquals("CopyLinkButton", CopyLinkButtonRegistration.SLUG)
    }

    // ── diagnostics: PII-safe slug + outcome only ───────────────────────────────────────────────────────

    @Test
    fun viewOpenedRecordsSlugOnly() {
        val logger = RecordingLogger()
        recordCopyLinkOpened(logger)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_VIEW_OPENED, record.event)
        assertEquals(mapOf(FIELD_SURFACE to CopyLinkButtonRegistration.SLUG), record.fields)
    }

    @Test
    fun copyRecordsSlugAndLowercasedOutcome() {
        val logger = RecordingLogger()
        recordCopyLinkCopy(logger, CopyOutcome.Copied)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals(EVENT_COPY, record.event)
        assertEquals(
            mapOf(FIELD_SURFACE to CopyLinkButtonRegistration.SLUG, FIELD_OUTCOME to "copied"),
            record.fields,
        )
    }

    @Test
    fun everyOutcomeMapsToItsLowercaseName() {
        val logger = RecordingLogger()
        CopyOutcome.entries.forEach { recordCopyLinkCopy(logger, it) }
        val outcomes = logger.records.map { it.fields.getValue(FIELD_OUTCOME) }
        assertEquals(listOf("copied", "failed"), outcomes)
    }

    @Test
    fun copyDiagnosticsNeverLeakALinkField() {
        val logger = RecordingLogger()
        recordCopyLinkCopy(logger, CopyOutcome.Copied)
        // Only the surface slug + the outcome enum are ever recorded — never the copied link, query, or
        // any user content, so a diagnostics line can never leak where a user was sharing.
        val record = logger.records.single()
        assertEquals(setOf(FIELD_SURFACE, FIELD_OUTCOME), record.fields.keys)
        assertTrue(record.fields.values.none { it.startsWith("http") })
    }
}
