// Off-device unit coverage for the Label surface's pure model (P3 acceptance: adapter + per-state + a11y-key
// tests). Exercises the prompt-mandated surface slug, the required-marker glyph and the i18n key the surface binds
// (web `t('form.required', 'required')`), the [projectLabel] required/optional branch reduction (the web
// `{required && …}` guard), and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP —
// runs in :app:testReleaseUnitTest. Reference values are the strings + behaviour the web Label.tsx produces.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.label

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LabelModelTest {
    // ── surface metadata mirrors the prompt-mandated slug + the web glyph / i18n key ──────────────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("Label", LABEL_SLUG)
        assertEquals("Label", LabelDiagnostics.SLUG)
    }

    @Test
    fun requiredMarkerIsTheWebAsteriskGlyph() {
        assertEquals("*", LABEL_REQUIRED_MARKER)
    }

    @Test
    fun requiredI18nKeyMatchesTheWebTranslationKey() {
        // The view resolves this through the P1/S10 catalog (R.string.translation_form_required); the constant pins
        // the web→android key parity (web `t('form.required', 'required')`).
        assertEquals("form.required", LABEL_REQUIRED_I18N_KEY)
    }

    // ── projection: the required vs optional branch (web `{required && …}`) ────────────────────────────────────

    @Test
    fun projectLabelShowsRequiredMarkerWhenRequired() {
        assertTrue(projectLabel(required = true).showRequiredMarker)
    }

    @Test
    fun projectLabelHidesRequiredMarkerWhenOptional() {
        assertFalse(projectLabel(required = false).showRequiredMarker)
    }

    // ── diagnostics: one PII-safe view.opened carrying only the slug (P1/S11) ──────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val logger = RecordingLogger()

        LabelDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        // Only the surface slug — no label content can leak through the diagnostic.
        assertEquals(mapOf("surface" to "Label"), fields)
    }

    @Test
    fun diagnosticCarriesOnlyTheSurfaceField() {
        val logger = RecordingLogger()

        LabelDiagnostics.recordViewOpened(logger)

        val record = logger.records.single()
        assertEquals(setOf("surface"), record.fields.keys)
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
