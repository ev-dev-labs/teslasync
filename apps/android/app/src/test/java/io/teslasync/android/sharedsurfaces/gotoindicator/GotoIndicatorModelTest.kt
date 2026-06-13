package io.teslasync.android.sharedsurfaces.gotoindicator

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the GotoIndicator surface's pure logic — the native analogue of the web component's
 * `visible` branch + key-cap composition (web/src/components/feedback/GotoIndicator.tsx): the [GotoIndicatorPhase]
 * the projection resolves, the ordered key tokens, the merged TalkBack description, the canonical i18n key the
 * surface shares with the web source, and the PII-safe `view.opened` diagnostic. Runs in the offline
 * `:android:testReleaseUnitTest` gate; the Compose rendering + accessibility are covered on-device by
 * GotoIndicatorUiTest.
 */
class GotoIndicatorModelTest {
    // ── Phase projection (web `visible` branch) ───────────────────────────────────────────────────────────

    @Test
    fun projectVisibleResolvesTheVisiblePhaseWithTheDefaultKeys() {
        val display = GotoIndicatorProjection.project(visible = true)

        assertEquals(GotoIndicatorPhase.Visible, display.phase)
        assertTrue(display.isVisible)
        assertEquals(listOf("g", "?"), display.keys)
    }

    @Test
    fun projectHiddenResolvesTheHiddenPhase() {
        val display = GotoIndicatorProjection.project(visible = false)

        assertEquals(GotoIndicatorPhase.Hidden, display.phase)
        assertFalse(display.isVisible)
    }

    // ── Key tokens (web hardcoded `g` then `?`, joined by `+`) ─────────────────────────────────────────────

    @Test
    fun shortcutKeysAreTheWebGlyphsInOrder() {
        assertEquals(listOf("g", "?"), GotoIndicatorProjection.SHORTCUT_KEYS)
    }

    @Test
    fun displayDefaultsToTheShortcutKeyTokens() {
        val display = GotoIndicatorDisplay(phase = GotoIndicatorPhase.Visible)

        assertEquals(GotoIndicatorProjection.SHORTCUT_KEYS, display.keys)
    }

    @Test
    fun keySeparatorIsThePlusGlyph() {
        assertEquals("+", GotoIndicatorProjection.KEY_SEPARATOR)
    }

    // ── i18n parity (the web `shortcuts.goto` key + the ellipsis label; see the model header) ──────────────

    @Test
    fun gotoLabelKeyMatchesTheWebSourceKey() {
        assertEquals("shortcuts.goto", GotoIndicatorProjection.GOTO_LABEL_KEY)
    }

    @Test
    fun gotoLabelEllipsisIsTheTypographicEllipsis() {
        assertEquals("\u2026", GotoIndicatorProjection.GOTO_LABEL_ELLIPSIS)
    }

    // ── Merged TalkBack description (label then the keys joined by " + ") ──────────────────────────────────

    @Test
    fun contentDescriptionVoicesTheLabelThenTheKeysJoinedByPlus() {
        val description = GotoIndicatorProjection.contentDescription("Go to \u2026", listOf("g", "?"))

        assertEquals("Go to \u2026 g + ?", description)
    }

    @Test
    fun contentDescriptionHandlesASingleKey() {
        val description = GotoIndicatorProjection.contentDescription("Go to \u2026", listOf("g"))

        assertEquals("Go to \u2026 g", description)
    }

    // ── Diagnostics: PII-safe view.opened (P1/S11) ────────────────────────────────────────────────────────

    @Test
    fun diagnosticsSlugMatchesThePromptMandatedSurfaceSlug() {
        assertEquals("GotoIndicator", GotoIndicatorDiagnostics.SLUG)
    }

    @Test
    fun diagnosticsIdIsTheStableSurfaceId() {
        assertEquals("goto-indicator", GotoIndicatorDiagnostics.ID)
    }

    @Test
    fun recordViewOpenedEmitsThePiiSafeInfoEventOnce() {
        val logger = RecordingLogger()

        GotoIndicatorDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        // Only the slug is logged — this surface carries no user data, and none must leak.
        assertEquals(mapOf("surface" to "GotoIndicator"), fields)
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
