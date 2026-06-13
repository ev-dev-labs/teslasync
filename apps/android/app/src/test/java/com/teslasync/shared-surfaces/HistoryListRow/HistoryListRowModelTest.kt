// Off-device unit coverage for the HistoryListRow surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Exercises the prompt-mandated surface slug, the web-source click adapter
// (`href ? Link : onClick ? clickable : static`, with href precedence and blank-href handling), the per-state
// accessibility role projection (the label/role the interactive row advertises vs the static row), the resting
// accent projection across the selected flag and every glow value (pinning the documented "hover glow paints no
// resting accent on touch" rule), the parity glow enum, and the PII-safe `view.opened` diagnostic. No Compose /
// Android framework / HTTP — runs in :android:testReleaseUnitTest. Reference behaviour is what the web
// `HistoryListRow` produces (web/src/components/data-display/HistoryListRow.tsx).
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.historylistrow

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HistoryListRowModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun diagnosticsSlugIsThePromptSurfaceSlug() {
        assertEquals("HistoryListRow", HistoryListRowDiagnostics.SLUG)
    }

    // ── click adapter: href ? Link : onClick ? clickable : static ─────────────────────

    @Test
    fun navigatesWhenHrefIsPresent() {
        // web: `href ? <Link to={href}>` — the row navigates to the href.
        assertEquals(
            HistoryListRowInteraction.Navigate("/drives/1"),
            historyListRowInteraction(href = "/drives/1", hasOnClick = false),
        )
    }

    @Test
    fun hrefTakesPrecedenceOverOnClick() {
        // web docs: onClick is "mutually exclusive with href"; href wins when both are (mistakenly) supplied.
        assertEquals(
            HistoryListRowInteraction.Navigate("/charging/9"),
            historyListRowInteraction(href = "/charging/9", hasOnClick = true),
        )
    }

    @Test
    fun clickableWhenOnlyOnClickIsSupplied() {
        // web: no href, onClick on the panel — the row fires the handler.
        assertEquals(
            HistoryListRowInteraction.Clickable,
            historyListRowInteraction(href = null, hasOnClick = true),
        )
    }

    @Test
    fun staticWhenNeitherHrefNorOnClick() {
        assertEquals(
            HistoryListRowInteraction.Static,
            historyListRowInteraction(href = null, hasOnClick = false),
        )
    }

    @Test
    fun blankHrefIsTreatedAsAbsent() {
        // An empty / whitespace router target navigates nowhere, so it falls through to onClick / static.
        assertEquals(
            HistoryListRowInteraction.Clickable,
            historyListRowInteraction(href = "   ", hasOnClick = true),
        )
        assertEquals(
            HistoryListRowInteraction.Static,
            historyListRowInteraction(href = "", hasOnClick = false),
        )
    }

    // ── a11y role: interactive rows are buttons, static rows expose no role ────────────

    @Test
    fun navigableAndClickableRowsAreButtons() {
        assertEquals(HistoryListRowRole.Button, historyListRowRole(HistoryListRowInteraction.Navigate("/d/1")))
        assertEquals(HistoryListRowRole.Button, historyListRowRole(HistoryListRowInteraction.Clickable))
    }

    @Test
    fun staticRowExposesNoRole() {
        assertEquals(HistoryListRowRole.None, historyListRowRole(HistoryListRowInteraction.Static))
    }

    @Test
    fun interactiveHelperTracksTheRole() {
        assertTrue(historyListRowInteractive(HistoryListRowInteraction.Navigate("/d/1")))
        assertTrue(historyListRowInteractive(HistoryListRowInteraction.Clickable))
        assertFalse(historyListRowInteractive(HistoryListRowInteraction.Static))
    }

    // ── resting accent: selected paints the ring; glow is hover-only on touch ──────────

    @Test
    fun selectedPaintsTheRingForEveryGlow() {
        // web `selected` adds the persistent cyan ring regardless of glow.
        HistoryListRowGlow.entries.forEach { glow ->
            assertEquals(
                "selected row with glow=$glow",
                HistoryListRowAccent.Selected,
                historyListRowAccent(selected = true, glow = glow),
            )
        }
    }

    @Test
    fun unselectedRowPaintsNoRestingAccentForEveryGlow() {
        // web glow is a :hover-only affordance; with no hover on touch an unselected row shows the plain border.
        HistoryListRowGlow.entries.forEach { glow ->
            assertEquals(
                "unselected row with glow=$glow",
                HistoryListRowAccent.None,
                historyListRowAccent(selected = false, glow = glow),
            )
        }
    }

    @Test
    fun glowEnumMirrorsTheWebUnion() {
        // web `HistoryListRowGlow = 'cyan' | 'green' | 'purple' | 'none'`, in declaration order.
        assertEquals(
            listOf(
                HistoryListRowGlow.Cyan,
                HistoryListRowGlow.Green,
                HistoryListRowGlow.Purple,
                HistoryListRowGlow.None,
            ),
            HistoryListRowGlow.entries.toList(),
        )
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
        HistoryListRowDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no slot content (locations, timestamps, activity) can leak through.
        assertEquals(mapOf("surface" to "HistoryListRow"), records[0].fields)
    }
}
