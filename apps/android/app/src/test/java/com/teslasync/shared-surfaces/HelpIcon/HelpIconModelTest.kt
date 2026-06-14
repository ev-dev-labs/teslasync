// Off-device unit tests for the HelpIcon model + render classifier (the :android:testReleaseUnitTest gate). These
// cover the framework-free core the composable renders: the help-text resolution (web
// `i18nKey ? t(i18nKey, { defaultValue: content }) : content`), the render-nothing gate (web `if (!text) return
// null`), the accessible-name selection with override > per-field > generic precedence (web
// `ariaLabel ?? (for ? t('a11y.helpFor') : t('help.tooltip.iconLabel'))`), the `data-help-for` test-tag analogue,
// and the PII-safe `view.opened` diagnostic. The composable is a thin render layer over these, so exercising them
// here is the surface's behavioral contract and doubles as the per-state projection check.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package, which (like the
// surface) cannot match its hyphenated directory.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.helpicon

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class HelpIconModelTest {
    // ── help-text resolution (web i18nKey-resolved ?? content) ────────────────────────────────────────────

    @Test
    fun resolveHelpText_prefersResolvedTextOverContent() {
        assertEquals("Primary", resolveHelpText(text = "Primary", content = "Fallback"))
    }

    @Test
    fun resolveHelpText_fallsBackToContentWhenTextNullOrBlank() {
        assertEquals("Fallback", resolveHelpText(text = null, content = "Fallback"))
        assertEquals("Fallback", resolveHelpText(text = "   ", content = "Fallback"))
    }

    @Test
    fun resolveHelpText_emptyWhenNeitherSupplied() {
        assertEquals("", resolveHelpText(text = null, content = null))
        assertEquals("", resolveHelpText(text = "", content = ""))
    }

    // ── classify: the render-nothing gate (web if (!text) return null) ────────────────────────────────────

    @Test
    fun classify_hiddenWhenNeitherTextNorContentSupplied() {
        assertEquals(HelpIconRender.Hidden, classify(input(text = null, content = null)))
    }

    @Test
    fun classify_hiddenWhenContentIsEmpty() {
        // Web: <HelpIcon content="" /> renders nothing.
        assertEquals(HelpIconRender.Hidden, classify(input(content = "")))
    }

    @Test
    fun classify_shownWhenContentSupplied() {
        val render = classify(input(content = "Hello"))
        assertTrue(render is HelpIconRender.Shown)
        assertEquals("Hello", (render as HelpIconRender.Shown).text)
    }

    @Test
    fun classify_shownCopyPrefersResolvedTextOverContent() {
        // Web: i18nKey present ⇒ the resolved value wins, with content as its default fallback.
        val render = classify(input(text = "Cooldown helper text", content = "ignored")) as HelpIconRender.Shown
        assertEquals("Cooldown helper text", render.text)
    }

    // ── accessible name (web ariaLabel ?? for ? helpFor : generic) ────────────────────────────────────────

    @Test
    fun resolveAccessibleLabel_usesPerFieldNameWhenForIdPresent() {
        assertEquals(HELP_FOR, label(ariaLabel = null, forId = FIELD))
    }

    @Test
    fun resolveAccessibleLabel_fallsBackToGenericWhenForIdOmittedOrBlank() {
        assertEquals(GENERIC, label(ariaLabel = null, forId = null))
        assertEquals(GENERIC, label(ariaLabel = null, forId = "   "))
    }

    @Test
    fun resolveAccessibleLabel_explicitOverrideWins() {
        assertEquals("Custom", label(ariaLabel = "Custom", forId = FIELD))
    }

    @Test
    fun classify_shownCarriesResolvedAccessibleName() {
        val render = classify(input(content = "x", forId = FIELD)) as HelpIconRender.Shown
        assertEquals(HELP_FOR, render.accessibleLabel)
    }

    // ── data-help-for analogue ────────────────────────────────────────────────────────────────────────────

    @Test
    fun helpForTestTag_encodesFieldIdWhenPresent() {
        assertEquals("help-icon-trigger-my-field-id", helpForTestTag("my-field-id"))
    }

    @Test
    fun helpForTestTag_bareTagWhenForIdNullOrBlank() {
        assertEquals("help-icon-trigger", helpForTestTag(null))
        assertEquals("help-icon-trigger", helpForTestTag("   "))
    }

    // ── diagnostics (P1/S11): view.opened carries only the slug ───────────────────────────────────────────

    @Test
    fun recordViewOpened_emitsViewOpenedWithSlugOnly() {
        val logger = RecordingLogger()
        HelpIconDiagnostics.recordViewOpened(logger)
        assertEquals(1, logger.records.size)
        val (event, fields) = logger.records.first()
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "HelpIcon"), fields)
    }

    private fun label(
        ariaLabel: String?,
        forId: String?,
    ): String = resolveAccessibleLabel(ariaLabel = ariaLabel, forId = forId, helpForLabel = HELP_FOR, genericLabel = GENERIC)

    private fun input(
        text: String? = null,
        content: String? = null,
        ariaLabel: String? = null,
        forId: String? = null,
    ) = HelpIconInput(
        text = text,
        content = content,
        ariaLabel = ariaLabel,
        forId = forId,
        helpForLabel = HELP_FOR,
        genericLabel = GENERIC,
    )

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
        const val FIELD = "cooldown"
        const val HELP_FOR = "Help for cooldown"
        const val GENERIC = "More info"
    }
}
