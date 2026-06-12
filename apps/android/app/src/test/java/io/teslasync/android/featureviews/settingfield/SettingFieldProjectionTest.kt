package io.teslasync.android.featureviews.settingfield

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the SettingField's pure logic — the native mirror of the two derivations the
 * web component (web/src/features/settings/components/SettingField.tsx + the embedded
 * web/src/components/ui/HelpIcon.tsx) performs before returning JSX: the help text/visibility rule
 * (`i18nKey ? t(i18nKey, content) : content`, then `if (!text) return null`), the per-field-vs-generic
 * accessible-name selection (surfaced as [ResolvedHelp.fieldId]), and the label `uppercase` transform.
 * Because the surface is purely presentational each result is exactly what the thin composable renders, so
 * these assertions double as the per-branch "snapshot". Runs in the :android:testReleaseUnitTest gate.
 */
class SettingFieldProjectionTest {
    private companion object {
        /** A deterministic catalog stand-in for the production `getIdentifier`-backed lookup. */
        val CATALOG =
            mapOf(
                "translation_help_fields_settings_electricityCost" to "Cost per kWh used across analytics.",
            )

        /** Reproduces i18next `t(key, default)`: catalog hit folded by [SettingFieldProjection.foldCatalogKey], else fallback. */
        val translate: (String, String) -> String = { key, fallback ->
            CATALOG[SettingFieldProjection.foldCatalogKey(key)] ?: fallback
        }
    }

    // ── foldCatalogKey (dotted i18n key → generated `translation_*` resource name) ───────────────────

    @Test
    fun foldCatalogKeyMatchesTheGeneratedResourceName() {
        assertEquals(
            "translation_help_fields_settings_electricityCost",
            SettingFieldProjection.foldCatalogKey("help.fields.settings.electricityCost"),
        )
        assertEquals("translation_a11y_helpFor", SettingFieldProjection.foldCatalogKey("a11y.helpFor"))
        assertEquals("translation_help_tooltip_iconLabel", SettingFieldProjection.foldCatalogKey("help.tooltip.iconLabel"))
    }

    @Test
    fun foldCatalogKeyTrimsLeadingAndTrailingSeparators() {
        assertEquals("translation_a_b", SettingFieldProjection.foldCatalogKey(".a..b."))
    }

    // ── resolveHelp (web HelpIcon `i18nKey ? t(...) : content`, then `if (!text) return null`) ───────

    @Test
    fun resolveHelpReturnsNullWhenNoHelpDescriptor() {
        assertNull(SettingFieldProjection.resolveHelp(null, translate))
    }

    @Test
    fun resolveHelpPrefersTheResolvedI18nKeyOverContent() {
        val help =
            SettingFieldHelp(
                i18nKey = "help.fields.settings.electricityCost",
                content = "fallback content",
                forId = "electricity-cost",
            )
        val resolved = SettingFieldProjection.resolveHelp(help, translate)
        assertEquals("Cost per kWh used across analytics.", resolved?.text)
        assertEquals("electricity-cost", resolved?.fieldId)
    }

    @Test
    fun resolveHelpFallsBackToContentWhenTheKeyIsAbsent() {
        // Web `t(missingKey, { defaultValue: content })` returns the default — here the plain content.
        val help = SettingFieldHelp(i18nKey = "help.fields.settings.unknown", content = "plain fallback")
        assertEquals("plain fallback", SettingFieldProjection.resolveHelp(help, translate)?.text)
    }

    @Test
    fun resolveHelpUsesContentWhenNoI18nKeyIsGiven() {
        val help = SettingFieldHelp(content = "content only")
        val resolved = SettingFieldProjection.resolveHelp(help, translate)
        assertEquals("content only", resolved?.text)
        assertNull(resolved?.fieldId)
    }

    @Test
    fun resolveHelpTreatsAnEmptyI18nKeyAsAbsentLikeTheFalsyWebTernary() {
        // JS treats `''` as falsy, so `i18nKey ? … : content` takes the content branch.
        val help = SettingFieldHelp(i18nKey = "", content = "content only")
        assertEquals("content only", SettingFieldProjection.resolveHelp(help, translate)?.text)
    }

    @Test
    fun resolveHelpReturnsNullWhenThereIsNoTextToShow() {
        // Web HelpIcon `if (!text) return null`: no key + no content, and a key that resolves to empty.
        assertNull(SettingFieldProjection.resolveHelp(SettingFieldHelp(), translate))
        assertNull(SettingFieldProjection.resolveHelp(SettingFieldHelp(content = ""), translate))
        assertNull(SettingFieldProjection.resolveHelp(SettingFieldHelp(i18nKey = "missing.key", content = ""), translate))
    }

    @Test
    fun resolveHelpDropsAnEmptyFieldIdSoTheGenericLabelIsUsed() {
        // Web aria-label `forId ? 'Help for {forId}' : 'More info'`: an empty `for` is falsy → generic label.
        val help = SettingFieldHelp(content = "info", forId = "")
        assertNull(SettingFieldProjection.resolveHelp(help, translate)?.fieldId)
    }

    // ── displayLabel (web `<label class="… uppercase …">`) ───────────────────────────────────────────

    @Test
    fun displayLabelUppercasesCasedScriptsLikeTheCssTransform() {
        assertEquals("ELECTRICITY COST (PER KWH)", SettingFieldProjection.displayLabel("Electricity Cost (per kWh)", Locale.US))
    }

    @Test
    fun displayLabelIsANoOpForCaselessText() {
        // Locale-aware uppercase leaves caseless content (digits, symbols, CJK/RTL scripts) untouched, so the
        // localized ar/he catalogs stay legible — the browser's `text-transform: uppercase` behaves the same.
        assertEquals("12.5 / KM", SettingFieldProjection.displayLabel("12.5 / km", Locale.US))
        val cjk = "東京"
        assertEquals(cjk, SettingFieldProjection.displayLabel(cjk, Locale.US))
    }
}
