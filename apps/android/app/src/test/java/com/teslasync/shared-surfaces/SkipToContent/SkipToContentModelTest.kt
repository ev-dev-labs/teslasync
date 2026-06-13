// Off-device unit coverage for the SkipToContent surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label/diagnostics tests). Exercises the registration slug + web i18n key the prompt mandates, the
// focus → render-mode mapping that mirrors the web `sr-only` ↔ `focus:not-sr-only` transition, the activation
// outcome that mirrors the web `if (main)` guard, and the PII-safe diagnostics. No Compose / Android framework
// / HTTP — runs in :android:testReleaseUnitTest. Reference values are the strings + behaviour the web source
// (web/src/components/feedback/SkipToContent.tsx) produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.skiptocontent

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SkipToContentModelTest {
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

    // ── registration metadata mirrors the prompt-mandated surface slug + the web i18n key ──────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("skip-to-content", SkipToContentRegistration.ID)
        assertEquals("SkipToContent", SkipToContentRegistration.SLUG)
        assertEquals("a11y.skipToContent", SkipToContentRegistration.LABEL_KEY)
    }

    // ── render mode: hidden while resting, revealed on focus (web sr-only ↔ focus:not-sr-only) ──────────

    @Test
    fun skipLinkModeRevealsOnlyWhenFocused() {
        assertEquals(SkipLinkMode.Hidden, skipLinkMode(focused = false))
        assertEquals(SkipLinkMode.Revealed, skipLinkMode(focused = true))
    }

    @Test
    fun skipLinkModeCoversHiddenAndRevealed() {
        assertEquals(listOf(SkipLinkMode.Hidden, SkipLinkMode.Revealed), SkipLinkMode.entries.toList())
    }

    // ── activation outcome: moved when a landmark is present, no-op when absent (web `if (main)`) ────────

    @Test
    fun skipOutcomeReflectsLandmarkPresence() {
        assertEquals(SkipOutcome.Moved, skipOutcome(targetPresent = true))
        assertEquals(SkipOutcome.NoTarget, skipOutcome(targetPresent = false))
    }

    @Test
    fun skipOutcomeWireNamesAreStableAndPiiFree() {
        assertEquals("moved", SkipOutcome.Moved.wireName)
        assertEquals("noTarget", SkipOutcome.NoTarget.wireName)
    }

    // ── diagnostics: one PII-safe view.opened (slug only) ───────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val logger = RecordingLogger()
        SkipToContentDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        assertEquals(LogLevel.Info, logger.records[0].level)
        assertEquals("view.opened", logger.records[0].event)
        // Only the surface slug — no label, route, or page content can leak through the diagnostic.
        assertEquals(mapOf("surface" to "SkipToContent"), logger.records[0].fields)
    }

    // ── diagnostics: activation carries the slug + coarse outcome only ──────────────────────────────────

    @Test
    fun recordSkipEmitsSlugAndOutcomeWithoutPii() {
        val logger = RecordingLogger()
        SkipToContentDiagnostics.recordSkip(logger, SkipOutcome.Moved)
        val record = logger.records.single { it.event == "skipToContent.activate" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(mapOf("surface" to "SkipToContent", "outcome" to "moved"), record.fields)
    }

    @Test
    fun recordSkipDistinguishesTheNoTargetOutcome() {
        val logger = RecordingLogger()
        SkipToContentDiagnostics.recordSkip(logger, SkipOutcome.NoTarget)
        val record = logger.records.single { it.event == "skipToContent.activate" }
        assertEquals("noTarget", record.fields["outcome"])
        // The activation diagnostic only ever carries the two fixed structured keys — never page content.
        assertTrue(record.fields.keys == setOf("surface", "outcome"))
    }
}
