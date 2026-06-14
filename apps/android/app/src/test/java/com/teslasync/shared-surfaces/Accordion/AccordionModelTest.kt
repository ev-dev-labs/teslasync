// Off-device verification of the Accordion surface's pure logic — the native mirror of every decision the web
// component makes (web/src/components/ui/Accordion.tsx): the controlled-vs-uncontrolled open resolution, the
// render classifier across every slot / body branch, the localized a11y affordance selectors, the
// `t(key, default)` resolver, and the PII-safe diagnostics slug. Because the composable is a thin render layer
// over AccordionModel, the per-branch assertions here double as the surface's per-state snapshot. No Compose /
// Android framework / HTTP — runs in the :android:testReleaseUnitTest gate; the on-device render + accessibility
// live in AccordionUiTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Accordion) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.accordion

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccordionModelTest {
    // ── registration slug mirrors the prompt-mandated surface slug ──────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("Accordion", ACCORDION_SLUG)
        assertEquals(ACCORDION_SLUG, AccordionDiagnostics.SLUG)
    }

    // ── controlled vs uncontrolled (web `isControlled = open !== undefined && onOpenChange !== undefined`) ──

    @Test
    fun controlledRequiresBothOpenAndHandler() {
        assertTrue(accordionIsControlled(openOverride = true, hasOnOpenChange = true))
        assertTrue(accordionIsControlled(openOverride = false, hasOnOpenChange = true))
        assertFalse(accordionIsControlled(openOverride = true, hasOnOpenChange = false))
        assertFalse(accordionIsControlled(openOverride = null, hasOnOpenChange = true))
        assertFalse(accordionIsControlled(openOverride = null, hasOnOpenChange = false))
    }

    @Test
    fun resolveOpenPrefersControlledOverrideElseInternalState() {
        // Controlled: the parent-owned override wins regardless of the internal state.
        assertTrue(resolveAccordionOpen(openOverride = true, hasOnOpenChange = true, internalOpen = false))
        assertFalse(resolveAccordionOpen(openOverride = false, hasOnOpenChange = true, internalOpen = true))
        // Uncontrolled (no handler, or no override): the remembered internal state is used.
        assertTrue(resolveAccordionOpen(openOverride = true, hasOnOpenChange = false, internalOpen = true))
        assertFalse(resolveAccordionOpen(openOverride = true, hasOnOpenChange = false, internalOpen = false))
        assertTrue(resolveAccordionOpen(openOverride = null, hasOnOpenChange = true, internalOpen = true))
        assertFalse(resolveAccordionOpen(openOverride = null, hasOnOpenChange = false, internalOpen = false))
    }

    // ── classifier: every render branch / state (web slot conditionals + body) ──────

    @Test
    fun classifyShowsEveryRegionWhenAllSlotsPresent() {
        val render =
            classifyAccordion(
                AccordionInput(expanded = true, hasIcon = true, hasBadge = true, hasHeaderExtra = true, hasBody = true),
            )
        assertTrue(render.expanded)
        assertTrue(render.showIcon)
        assertTrue(render.showBadge)
        assertTrue(render.showHeaderExtra)
        assertTrue(render.showBody)
        assertFalse(render.showEmptyFallback)
    }

    @Test
    fun classifyHidesOptionalSlotsWhenAbsent() {
        val render = classifyAccordion(AccordionInput(expanded = false, hasBody = true))
        assertFalse(render.expanded)
        assertFalse(render.showIcon)
        assertFalse(render.showBadge)
        assertFalse(render.showHeaderExtra)
        assertTrue(render.showBody)
        assertFalse(render.showEmptyFallback)
    }

    @Test
    fun classifyFlagsEmptyFallbackWhenNoBody() {
        // The prompt's "empty → friendly empty state, never a blank box" contract.
        val render = classifyAccordion(AccordionInput(expanded = true, hasBody = false))
        assertFalse(render.showBody)
        assertTrue(render.showEmptyFallback)
    }

    @Test
    fun classifyPropagatesExpandedFlagBothWays() {
        assertTrue(classifyAccordion(AccordionInput(expanded = true, hasBody = true)).expanded)
        assertFalse(classifyAccordion(AccordionInput(expanded = false, hasBody = true)).expanded)
    }

    @Test
    fun classifyEmptyFlagIsStableAcrossTheToggle() {
        // The real-vs-empty body distinction is independent of open/closed, so it asserts once.
        val open = classifyAccordion(AccordionInput(expanded = true, hasBody = false))
        val closed = classifyAccordion(AccordionInput(expanded = false, hasBody = false))
        assertEquals(open.showEmptyFallback, closed.showEmptyFallback)
        assertTrue(open.showEmptyFallback)
    }

    // ── a11y affordance selectors (web `aria-expanded` action + state) ──────────────

    @Test
    fun affordanceActionLabelTracksTheToggle() {
        val affordances = defaultAffordances()
        assertEquals("Collapse", affordances.actionLabel(expanded = true))
        assertEquals("Expand", affordances.actionLabel(expanded = false))
    }

    @Test
    fun affordanceStateLabelTracksTheToggle() {
        val affordances = defaultAffordances()
        assertEquals("Expanded", affordances.stateLabel(expanded = true))
        assertEquals("Collapsed", affordances.stateLabel(expanded = false))
    }

    @Test
    fun affordanceDefaultsAreTheEnglishFallbacks() {
        assertEquals("Expand", AccordionDefaults.EXPAND_ACTION)
        assertEquals("Collapse", AccordionDefaults.COLLAPSE_ACTION)
        assertEquals("Expanded", AccordionDefaults.EXPANDED_STATE)
        assertEquals("Collapsed", AccordionDefaults.COLLAPSED_STATE)
    }

    // ── resolveOptional (web `t(key, default)`) ─────────────────────────────────────

    @Test
    fun resolveOptionalReturnsTheCatalogValueWhenPresent() {
        val resolved = resolveOptional({ "Réduire" }, KEY_ACCORDION_COLLAPSE_ACTION, AccordionDefaults.COLLAPSE_ACTION)
        assertEquals("Réduire", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        val fallback = AccordionDefaults.EXPAND_ACTION
        assertEquals(fallback, resolveOptional({ null }, KEY_ACCORDION_EXPAND_ACTION, fallback))
        assertEquals(fallback, resolveOptional({ "   " }, KEY_ACCORDION_EXPAND_ACTION, fallback))
    }

    @Test
    fun affordanceKeysAreNamespacedToTheSurface() {
        assertEquals("translation_accordion_expand", KEY_ACCORDION_EXPAND_ACTION)
        assertEquals("translation_accordion_collapse", KEY_ACCORDION_COLLAPSE_ACTION)
        assertEquals("translation_accordion_expanded", KEY_ACCORDION_EXPANDED_STATE)
        assertEquals("translation_accordion_collapsed", KEY_ACCORDION_COLLAPSED_STATE)
    }

    // ── diagnostics: one PII-safe view.opened (P1/S11) ──────────────────────────────

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
        AccordionDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no title, badge, or body can leak through the diagnostic.
        assertEquals(mapOf("surface" to "Accordion"), records[0].fields)
    }

    private fun defaultAffordances(): AccordionAffordances =
        AccordionAffordances(
            expandAction = AccordionDefaults.EXPAND_ACTION,
            collapseAction = AccordionDefaults.COLLAPSE_ACTION,
            expandedState = AccordionDefaults.EXPANDED_STATE,
            collapsedState = AccordionDefaults.COLLAPSED_STATE,
        )
}
