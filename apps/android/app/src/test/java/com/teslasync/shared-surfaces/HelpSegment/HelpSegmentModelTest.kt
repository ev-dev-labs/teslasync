// Off-device unit coverage for the HelpSegment surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label/diagnostics tests). Exercises the registration slug, the three affordances' web i18n key triplets
// and i18next default fallbacks the prompt mandates, the display-mode + kbd-hint projection that mirrors the
// web `iconOnly` guard, the dispatch outcome that mirrors a web event firing vs landing unhandled, and the
// PII-safe diagnostics. No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference
// values are the strings + behaviour the web source (web/src/components/layout/status-bar/HelpSegment.tsx)
// produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpsegment

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HelpSegmentModelTest {
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

    // ── registration metadata mirrors the prompt-mandated surface slug ──────────────────────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("help-segment", HelpSegmentRegistration.ID)
        assertEquals("HelpSegment", HelpSegmentRegistration.SLUG)
    }

    // ── the three affordances + their web i18n key triplets + i18next default fallbacks ──────────────────

    @Test
    fun helpActionsCoverTheWebSourcesThreeButtonsInOrder() {
        assertEquals(
            listOf(HelpAction.Shortcuts, HelpAction.Tour, HelpAction.Feedback),
            HelpAction.entries.toList(),
        )
    }

    @Test
    fun shortcutsActionMirrorsTheWebKeysAndDefaults() {
        val action = HelpAction.Shortcuts
        assertEquals("shortcuts", action.wireName)
        assertEquals("shortcuts.tooltip", action.tooltip.key)
        assertEquals("Keyboard shortcuts", action.tooltip.fallback)
        assertEquals("shortcuts.openAria", action.accessibleName.key)
        assertEquals("Open keyboard shortcuts", action.accessibleName.fallback)
        assertEquals("shortcuts.hintSuffix", action.label.key)
        assertEquals("for shortcuts", action.label.fallback)
        assertTrue(action.showsShortcutHint)
    }

    @Test
    fun tourActionMirrorsTheWebKeysAndDefaults() {
        val action = HelpAction.Tour
        assertEquals("tour", action.wireName)
        assertEquals("tour.launcher.openShort", action.tooltip.key)
        assertEquals("Take a tour", action.tooltip.fallback)
        assertEquals("tour.launcher.openAria", action.accessibleName.key)
        assertEquals("Open tour launcher", action.accessibleName.fallback)
        assertEquals("tour.launcher.openShort", action.label.key)
        assertEquals("Take a tour", action.label.fallback)
        assertFalse(action.showsShortcutHint)
    }

    @Test
    fun feedbackActionMirrorsTheWebKeysAndDefaults() {
        val action = HelpAction.Feedback
        assertEquals("feedback", action.wireName)
        assertEquals("feedback.openShort", action.tooltip.key)
        assertEquals("Report bug", action.tooltip.fallback)
        assertEquals("feedback.openAria", action.accessibleName.key)
        assertEquals("Open feedback / bug report form", action.accessibleName.fallback)
        assertEquals("feedback.openShort", action.label.key)
        assertEquals("Report bug", action.label.fallback)
        assertFalse(action.showsShortcutHint)
    }

    @Test
    fun onlyTheShortcutsAffordanceDrawsTheKbdHint() {
        assertEquals(listOf(HelpAction.Shortcuts), HelpAction.entries.filter { it.showsShortcutHint })
    }

    @Test
    fun shortcutHintGlyphIsTheLiteralQuestionKey() {
        assertEquals("?", SHORTCUT_HINT_GLYPH)
    }

    // ── display mode: compact (icon only) vs expanded (icon + label), web `iconOnly` ─────────────────────

    @Test
    fun displayModeReflectsTheIconOnlyFlag() {
        assertEquals(HelpDisplayMode.Compact, helpDisplayMode(iconOnly = true))
        assertEquals(HelpDisplayMode.Expanded, helpDisplayMode(iconOnly = false))
    }

    @Test
    fun displayModeCoversCompactAndExpanded() {
        assertEquals(listOf(HelpDisplayMode.Compact, HelpDisplayMode.Expanded), HelpDisplayMode.entries.toList())
    }

    @Test
    fun labelIsVisibleOnlyInTheExpandedMode() {
        assertTrue(labelVisible(HelpDisplayMode.Expanded))
        assertFalse(labelVisible(HelpDisplayMode.Compact))
    }

    @Test
    fun kbdHintShowsOnlyForShortcutsAndOnlyWhenExpanded() {
        assertTrue(shortcutHintVisible(HelpAction.Shortcuts, HelpDisplayMode.Expanded))
        assertFalse(shortcutHintVisible(HelpAction.Shortcuts, HelpDisplayMode.Compact))
        assertFalse(shortcutHintVisible(HelpAction.Tour, HelpDisplayMode.Expanded))
        assertFalse(shortcutHintVisible(HelpAction.Feedback, HelpDisplayMode.Expanded))
    }

    // ── dispatch outcome: handled when a listener is mounted, no-op when absent (web event firing) ───────

    @Test
    fun dispatchOutcomeReflectsListenerPresence() {
        assertEquals(HelpDispatchOutcome.Handled, helpDispatchOutcome(handled = true))
        assertEquals(HelpDispatchOutcome.NoListener, helpDispatchOutcome(handled = false))
    }

    @Test
    fun dispatchOutcomeWireNamesAreStableAndPiiFree() {
        assertEquals("handled", HelpDispatchOutcome.Handled.wireName)
        assertEquals("noListener", HelpDispatchOutcome.NoListener.wireName)
    }

    // ── diagnostics: one PII-safe view.opened (slug only) ───────────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val logger = RecordingLogger()
        HelpSegmentDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        assertEquals(LogLevel.Info, logger.records[0].level)
        assertEquals("view.opened", logger.records[0].event)
        // Only the surface slug — no label, tooltip, or help copy can leak through the diagnostic.
        assertEquals(mapOf("surface" to "HelpSegment"), logger.records[0].fields)
    }

    // ── diagnostics: invocation carries the slug + coarse action + outcome only ──────────────────────────

    @Test
    fun recordInvokeEmitsSlugActionAndOutcomeWithoutPii() {
        val logger = RecordingLogger()
        HelpSegmentDiagnostics.recordInvoke(logger, HelpAction.Tour, HelpDispatchOutcome.Handled)
        val record = logger.records.single { it.event == "helpSegment.invoke" }
        assertEquals(LogLevel.Info, record.level)
        assertEquals(
            mapOf("surface" to "HelpSegment", "action" to "tour", "outcome" to "handled"),
            record.fields,
        )
    }

    @Test
    fun recordInvokeDistinguishesTheNoListenerOutcome() {
        val logger = RecordingLogger()
        HelpSegmentDiagnostics.recordInvoke(logger, HelpAction.Feedback, HelpDispatchOutcome.NoListener)
        val record = logger.records.single { it.event == "helpSegment.invoke" }
        assertEquals("feedback", record.fields["action"])
        assertEquals("noListener", record.fields["outcome"])
        // The invocation diagnostic only ever carries the three fixed structured keys — never help copy.
        assertEquals(setOf("surface", "action", "outcome"), record.fields.keys)
    }
}
