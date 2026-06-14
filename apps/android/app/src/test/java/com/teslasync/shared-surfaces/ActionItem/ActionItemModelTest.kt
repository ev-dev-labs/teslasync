// Off-device unit tests for the ActionItem model + render classifier + accessibility label + diagnostics (the
// :android:testReleaseUnitTest gate). These cover the framework-free core the composable renders: the wire-string
// severity parse (web `'info' | 'warn' | 'error'`), the every-branch render classification (severity passthrough,
// real-vs-blank title, description present/absent, and the four CTA outcomes — external link / internal link /
// button / none), the merged TalkBack label (title + description), and the PII-safe `view.opened` diagnostic. The
// composable is a thin render layer over these, so exercising them here is the surface's behavioral contract.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.actionitem

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ActionItemModelTest {
    // ── wire-string severity parse (web 'info' | 'warn' | 'error') ────────────────────────────────────────────

    @Test
    fun severityFromWire_mapsKnownValues() {
        assertEquals(ActionSeverity.Info, severityFromWire("info"))
        assertEquals(ActionSeverity.Warn, severityFromWire("warn"))
        assertEquals(ActionSeverity.Error, severityFromWire("error"))
    }

    @Test
    fun severityFromWire_fallsBackToInfoForUnknownOrAbsent() {
        assertEquals(ActionSeverity.Info, severityFromWire(null))
        assertEquals(ActionSeverity.Info, severityFromWire(""))
        assertEquals(ActionSeverity.Info, severityFromWire("critical"))
        // Case-sensitive, like the web string union.
        assertEquals(ActionSeverity.Info, severityFromWire("WARN"))
    }

    // ── render classification: title (real vs empty fallback) ─────────────────────────────────────────────────

    @Test
    fun classify_realTitleShowsTitleNotFallback() {
        val render = classify(ActionItemInput(severity = ActionSeverity.Warn, title = "Re-auth required"))
        assertTrue(render.showTitle)
        assertFalse(render.showEmptyFallback)
        assertEquals(ActionSeverity.Warn, render.severity)
    }

    @Test
    fun classify_blankTitleShowsEmptyFallback() {
        for (blank in listOf(null, "", "   ")) {
            val render = classify(ActionItemInput(title = blank))
            assertFalse("title=<$blank> should not show title", render.showTitle)
            assertTrue("title=<$blank> should show fallback", render.showEmptyFallback)
        }
    }

    // ── render classification: description present/absent (web {description && …}) ─────────────────────────────

    @Test
    fun classify_descriptionFlagPassesThrough() {
        assertTrue(classify(ActionItemInput(title = "T", hasDescription = true)).showDescription)
        assertFalse(classify(ActionItemInput(title = "T", hasDescription = false)).showDescription)
    }

    // ── render classification: the four CTA outcomes (web ActionCTA element switch) ────────────────────────────

    @Test
    fun classify_externalLinkCtaIsExternalLink() {
        val render =
            classify(
                ActionItemInput(
                    title = "T",
                    ctaLabel = "Open docs",
                    ctaKind = ActionCtaKind.ExternalLink,
                    ctaHasActivation = true,
                ),
            )
        assertEquals(ActionCtaKind.ExternalLink, render.cta)
    }

    @Test
    fun classify_internalLinkCtaIsInternalLink() {
        val render =
            classify(
                ActionItemInput(
                    title = "T",
                    ctaLabel = "Review",
                    ctaKind = ActionCtaKind.InternalLink,
                    ctaHasActivation = true,
                ),
            )
        assertEquals(ActionCtaKind.InternalLink, render.cta)
    }

    @Test
    fun classify_buttonCtaIsButton() {
        val render =
            classify(
                ActionItemInput(
                    title = "T",
                    ctaLabel = "Install",
                    ctaKind = ActionCtaKind.Button,
                    ctaHasActivation = true,
                ),
            )
        assertEquals(ActionCtaKind.Button, render.cta)
    }

    @Test
    fun classify_ctaWithoutActivationIsHidden() {
        // The web ActionCTA returns null for a `cta` with neither `to` nor `onClick`.
        val render =
            classify(
                ActionItemInput(
                    title = "T",
                    ctaLabel = "Dead",
                    ctaKind = ActionCtaKind.Button,
                    ctaHasActivation = false,
                ),
            )
        assertNull(render.cta)
    }

    @Test
    fun classify_ctaWithBlankLabelIsHidden() {
        val render =
            classify(
                ActionItemInput(
                    title = "T",
                    ctaLabel = "  ",
                    ctaKind = ActionCtaKind.Button,
                    ctaHasActivation = true,
                ),
            )
        assertNull(render.cta)
    }

    @Test
    fun classify_noCtaIsHidden() {
        assertNull(classify(ActionItemInput(title = "T")).cta)
    }

    // ── merged accessibility label (title + description; CTA announced separately) ─────────────────────────────

    @Test
    fun accessibilityLabel_joinsTitleAndDescription() {
        val label =
            actionItemAccessibilityLabel(
                title = "Software update available",
                description = "v1.2.0 to v1.3.0",
                emptyFallback = FALLBACK,
            )
        assertEquals("Software update available. v1.2.0 to v1.3.0", label)
    }

    @Test
    fun accessibilityLabel_titleOnlyOmitsSeparator() {
        assertEquals("Backup completed", actionItemAccessibilityLabel("Backup completed", null, FALLBACK))
        assertEquals("Backup completed", actionItemAccessibilityLabel("Backup completed", "   ", FALLBACK))
    }

    @Test
    fun accessibilityLabel_blankTitleUsesFallback() {
        assertEquals(FALLBACK, actionItemAccessibilityLabel(null, null, FALLBACK))
        assertEquals("$FALLBACK. detail", actionItemAccessibilityLabel("  ", "detail", FALLBACK))
    }

    @Test
    fun accessibilityLabel_trimsParts() {
        assertEquals("Title. Detail", actionItemAccessibilityLabel("  Title  ", "  Detail  ", FALLBACK))
    }

    // ── diagnostics (P1/S11): view.opened carries only the slug ────────────────────────────────────────────────

    @Test
    fun recordViewOpened_emitsViewOpenedWithSlugOnly() {
        val logger = RecordingLogger()
        ActionItemDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.first()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "ActionItem"), fields)
    }

    private class RecordingLogger : Logger {
        val records = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += event to fields
        }
    }

    private companion object {
        const val FALLBACK = "No data available"
    }
}
