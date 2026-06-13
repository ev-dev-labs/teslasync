// Off-device unit tests for the FormField model + identifier derivation + render classifier (the
// :android:testReleaseUnitTest gate). These cover the framework-free core the composable renders: the field-id
// resolution (web `htmlFor ?? useId()`), the supporting-line classification with error-over-hint precedence (web
// `error ? <p role="alert"> : hint ? <p> : null`), the derived child ids (web `${fieldId}-error` / `${fieldId}-
// hint`), the merged required announcement (web asterisk `aria-label="required"`), the useId-analogue id
// generator, and the PII-safe `view.opened` diagnostic. The composable is a thin render layer over these, so
// exercising them here is the surface's behavioral contract and doubles as the per-state projection check.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.formfield

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class FormFieldModelTest {
    // ── field id resolution (web htmlFor ?? autoId) ───────────────────────────────────────────────────────

    @Test
    fun resolveFieldId_prefersCallerHtmlFor() {
        assertEquals("signal-select", resolveFieldId(htmlFor = "signal-select", autoId = AUTO_ID))
    }

    @Test
    fun resolveFieldId_fallsBackToAutoIdWhenHtmlForNullOrBlank() {
        assertEquals(AUTO_ID, resolveFieldId(htmlFor = null, autoId = AUTO_ID))
        assertEquals(AUTO_ID, resolveFieldId(htmlFor = "   ", autoId = AUTO_ID))
    }

    // ── classify: supporting-line outcomes + derived child ids ────────────────────────────────────────────

    @Test
    fun classify_errorWins_showsAlertWithDerivedErrorId() {
        val render = classify(FormFieldInput(autoId = AUTO_ID, hint = "pick one", error = "Select a signal."))
        assertEquals(FormFieldSupport.Error, render.support)
        assertEquals("$AUTO_ID-error", render.errorId)
        assertNull("the hint id is suppressed while an error is shown (web hint && !error)", render.hintId)
    }

    @Test
    fun classify_hintShownOnlyWhenNoError_withDerivedHintId() {
        val render = classify(FormFieldInput(autoId = AUTO_ID, hint = "pick one"))
        assertEquals(FormFieldSupport.Hint, render.support)
        assertEquals("$AUTO_ID-hint", render.hintId)
        assertNull(render.errorId)
    }

    @Test
    fun classify_noMessages_drawsNoSupportingLine() {
        val render = classify(FormFieldInput(autoId = AUTO_ID))
        assertEquals(FormFieldSupport.None, render.support)
        assertNull(render.errorId)
        assertNull(render.hintId)
    }

    @Test
    fun classify_blankMessagesAreTreatedAsAbsent() {
        val render = classify(FormFieldInput(autoId = AUTO_ID, hint = "   ", error = ""))
        assertEquals(FormFieldSupport.None, render.support)
        assertNull(render.errorId)
        assertNull(render.hintId)
    }

    @Test
    fun classify_derivesChildIdsFromCallerHtmlFor() {
        val render =
            classify(FormFieldInput(htmlFor = "signal", autoId = AUTO_ID, error = "Select a signal."))
        assertEquals("signal", render.fieldId)
        assertEquals("signal-error", render.errorId)
    }

    @Test
    fun classify_carriesRequiredMarkerFlag() {
        assertTrue(classify(FormFieldInput(autoId = AUTO_ID, required = true)).showRequiredMarker)
        assertFalse(classify(FormFieldInput(autoId = AUTO_ID, required = false)).showRequiredMarker)
    }

    // ── accessibility label (web asterisk aria-label="required") ──────────────────────────────────────────

    @Test
    fun fieldAccessibilityLabel_optionalFieldReadsLabelOnly() {
        assertEquals("Signal", fieldAccessibilityLabel("Signal", required = false, requiredText = "required"))
    }

    @Test
    fun fieldAccessibilityLabel_requiredFieldAppendsRequiredSuffix() {
        assertEquals("Signal, required", fieldAccessibilityLabel("Signal", required = true, requiredText = "required"))
    }

    @Test
    fun fieldAccessibilityLabel_trimsAndStaysNonEmptyForBlankLabel() {
        assertEquals("Signal", fieldAccessibilityLabel("  Signal  ", required = false, requiredText = "required"))
        assertEquals("required", fieldAccessibilityLabel("   ", required = true, requiredText = "required"))
    }

    // ── useId analogue: stable, unique, prefixed ids ──────────────────────────────────────────────────────

    @Test
    fun formFieldIds_yieldsDistinctNonBlankPrefixedIds() {
        val first = FormFieldIds.next()
        val second = FormFieldIds.next()
        assertTrue(first.startsWith("form-field-"))
        assertTrue(first.isNotBlank())
        assertTrue("each call must yield a fresh id (the web useId uniqueness contract)", first != second)
    }

    // ── diagnostics (P1/S11): view.opened carries only the slug ───────────────────────────────────────────

    @Test
    fun recordViewOpened_emitsViewOpenedWithSlugOnly() {
        val logger = RecordingLogger()
        FormFieldDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.first()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "FormField"), fields)
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
        const val AUTO_ID = "form-field-7"
    }
}
