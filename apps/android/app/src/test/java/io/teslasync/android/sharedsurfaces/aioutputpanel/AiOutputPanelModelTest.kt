// Off-device unit coverage for the AiOutputPanel surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Exercises the surface slug the prompt mandates, the `hasAnything` gate + render-branch
// classifier that mirror the web component's conditional (web/src/components/ai/AiOutputPanel.tsx) for every
// (text, state) input, the terminal-error resolution (`error ?? 'unknown'`) and the announced "Helix error:
// <detail>" line the error state exposes to TalkBack, and the PII-safe `view.opened` diagnostic. No Compose /
// Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference values are the strings + behaviour
// the web component produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aioutputpanel

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiOutputPanelModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("AiOutputPanel", AI_OUTPUT_PANEL_SLUG)
        assertEquals(AI_OUTPUT_PANEL_SLUG, AiOutputPanelDiagnostics.SLUG)
    }

    // ── hasAnything gate (web `text.length > 0 || streaming || error || done`) ────────

    @Test
    fun hasAnythingIsFalseOnlyWhenIdleWithNoText() {
        assertFalse(aiOutputHasAnything("", AiStreamState.Idle))
    }

    @Test
    fun hasAnythingIsTrueForAnyTextOrAnyNonIdleState() {
        assertTrue(aiOutputHasAnything("hi", AiStreamState.Idle))
        assertTrue(aiOutputHasAnything("", AiStreamState.Streaming))
        assertTrue(aiOutputHasAnything("", AiStreamState.Done))
        assertTrue(aiOutputHasAnything("", AiStreamState.Error))
    }

    // ── render-branch classifier (web JSX conditional), one assertion per state ───────

    @Test
    fun idleWithNoTextClassifiesHidden() {
        // web `if (!hasAnything) return null`.
        assertEquals(AiOutputBranch.Hidden, aiOutputBranch("", AiStreamState.Idle))
    }

    @Test
    fun errorStateClassifiesError() {
        // web `state === 'error'` — checked before pending so an error before the first delta shows the error.
        assertEquals(AiOutputBranch.Error, aiOutputBranch("", AiStreamState.Error))
        assertEquals(AiOutputBranch.Error, aiOutputBranch("partial", AiStreamState.Error))
    }

    @Test
    fun streamingWithNoTextClassifiesPending() {
        // web `text === '' && state === 'streaming'` — the thinking indicator.
        assertEquals(AiOutputBranch.Pending, aiOutputBranch("", AiStreamState.Streaming))
    }

    @Test
    fun streamingWithTextClassifiesText() {
        // Once a delta has arrived the streamed paragraph replaces the thinking indicator.
        assertEquals(AiOutputBranch.Text, aiOutputBranch("Sunset", AiStreamState.Streaming))
    }

    @Test
    fun doneWithTextClassifiesText() {
        assertEquals(AiOutputBranch.Text, aiOutputBranch("Final proposal", AiStreamState.Done))
    }

    @Test
    fun doneWithNoTextStillRendersTheTextBranchNotPending() {
        // A clean close with no delta is the web `else` paragraph (an empty, but present, panel), never pending.
        assertEquals(AiOutputBranch.Text, aiOutputBranch("", AiStreamState.Done))
    }

    @Test
    fun idleWithTextClassifiesText() {
        // Re-reading a settled proposal after the holder reset to idle still shows the text (web `else`).
        assertEquals(AiOutputBranch.Text, aiOutputBranch("Kept proposal", AiStreamState.Idle))
    }

    // ── terminal-error resolution (web `error ?? t('ai.common.errorUnknown', 'unknown')`) ─

    @Test
    fun resolveErrorDetailFallsBackOnlyForNull() {
        assertEquals("unknown", resolveErrorDetail(null, "unknown"))
        assertEquals("stream_http_500", resolveErrorDetail("stream_http_500", "unknown"))
    }

    // ── a11y label: the announced "Helix error: <detail>" line (web bold label + message) ─

    @Test
    fun errorLineJoinsLabelAndDetailForTheAccessibleAnnouncement() {
        assertEquals("Helix error: stream_http_404", aiOutputErrorLine("Helix error:", "stream_http_404"))
        assertEquals("Helix error: unknown", aiOutputErrorLine("Helix error:", resolveErrorDetail(null, "unknown")))
    }

    // ── diagnostics: one PII-safe view.opened ─────────────────────────────────────────

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
        AiOutputPanelDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no streamed text or error message can leak through the diagnostic.
        assertEquals(mapOf("surface" to "AiOutputPanel"), records[0].fields)
    }
}
