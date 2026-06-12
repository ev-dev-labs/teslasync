package io.teslasync.android.featureviews.accordionsection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the AccordionSection's pure logic — the native analogue of the web component's
 * prop-and-state to render mapping (web/src/features/system/components/status/AccordionSection.tsx): the
 * `setOpen(prev => !prev)` toggle, the `open && 'rotate-180'` chevron transform, the `{open && (...)}` body
 * gate, and the three genuinely reachable render states (Collapsed, ExpandedContent, ExpandedEmpty). Also
 * pins the surface registration identifiers, the chevron-degree constants, the affordance-string selectors,
 * and the `t(key, default)` resolver used for the native-only accessibility labels + empty hint. Runs in the
 * :android:testReleaseUnitTest gate; the on-device render + accessibility live in AccordionSectionUiTest.
 */
class AccordionSectionModelTest {
    // ── Toggle (web `setOpen(prev => !prev)`) ────────────────────────────────────

    @Test
    fun toggleFlipsTheOpenFlag() {
        assertTrue(AccordionSectionModel.toggle(false))
        assertFalse(AccordionSectionModel.toggle(true))
    }

    @Test
    fun toggleIsItsOwnInverse() {
        // Two clicks (or two Enter/Space presses) return to the starting state.
        assertFalse(AccordionSectionModel.toggle(AccordionSectionModel.toggle(false)))
        assertTrue(AccordionSectionModel.toggle(AccordionSectionModel.toggle(true)))
    }

    // ── Chevron rotation (web `open && 'rotate-180'`) ────────────────────────────

    @Test
    fun chevronRotatesHalfTurnWhenOpen() {
        assertEquals(CHEVRON_OPEN_DEGREES, AccordionSectionModel.chevronRotation(true))
        assertEquals(180f, AccordionSectionModel.chevronRotation(true))
    }

    @Test
    fun chevronRestsAtZeroWhenClosed() {
        assertEquals(CHEVRON_CLOSED_DEGREES, AccordionSectionModel.chevronRotation(false))
        assertEquals(0f, AccordionSectionModel.chevronRotation(false))
    }

    // ── Body gate (web `{open && (...)}`) ────────────────────────────────────────

    @Test
    fun bodyRendersOnlyWhenOpen() {
        assertTrue(AccordionSectionModel.shouldRenderBody(true))
        assertFalse(AccordionSectionModel.shouldRenderBody(false))
    }

    // ── Render-state classification (the three reachable branches) ───────────────

    @Test
    fun closedAlwaysCollapsedRegardlessOfBody() {
        // A collapsed section never inspects its body — both branches reduce to Collapsed.
        assertEquals(AccordionRender.Collapsed, AccordionSectionModel.render(open = false, hasContent = true))
        assertEquals(AccordionRender.Collapsed, AccordionSectionModel.render(open = false, hasContent = false))
    }

    @Test
    fun openWithBodyIsExpandedContent() {
        assertEquals(AccordionRender.ExpandedContent, AccordionSectionModel.render(open = true, hasContent = true))
    }

    @Test
    fun openWithoutBodyIsExpandedEmpty() {
        // A caller may hand no body; rather than a blank box the surface shows the friendly empty state.
        assertEquals(AccordionRender.ExpandedEmpty, AccordionSectionModel.render(open = true, hasContent = false))
    }

    @Test
    fun renderStatesAreDistinct() {
        val collapsed = AccordionSectionModel.render(open = false, hasContent = true)
        val content = AccordionSectionModel.render(open = true, hasContent = true)
        val empty = AccordionSectionModel.render(open = true, hasContent = false)
        assertNotEquals(collapsed, content)
        assertNotEquals(content, empty)
        assertNotEquals(collapsed, empty)
    }

    // ── Affordance-string selectors (web `role="button"` + `aria-expanded`) ──────

    @Test
    fun actionLabelTracksTheToggleState() {
        val strings = sampleStrings()
        assertEquals("Collapse", strings.actionLabel(open = true))
        assertEquals("Expand", strings.actionLabel(open = false))
    }

    @Test
    fun stateLabelTracksTheToggleState() {
        val strings = sampleStrings()
        assertEquals("Expanded", strings.stateLabel(open = true))
        assertEquals("Collapsed", strings.stateLabel(open = false))
    }

    // ── Registration + defaults (web parity) ─────────────────────────────────────

    @Test
    fun registrationExposesStableIdAndSlug() {
        assertEquals("accordion-section", AccordionSectionRegistration.ID)
        assertEquals("AccordionSection", AccordionSectionRegistration.SLUG)
    }

    @Test
    fun defaultsCarryTheEnglishFallbackCopy() {
        assertEquals("Expand", AccordionSectionDefaults.EXPAND_ACTION)
        assertEquals("Collapse", AccordionSectionDefaults.COLLAPSE_ACTION)
        assertEquals("Expanded", AccordionSectionDefaults.EXPANDED_STATE)
        assertEquals("Collapsed", AccordionSectionDefaults.COLLAPSED_STATE)
        assertEquals("Nothing to show", AccordionSectionDefaults.EMPTY_HINT)
    }

    // ── By-name string resolver (web `t(key, default)`) ──────────────────────────

    @Test
    fun resolveOptionalReturnsCatalogValueWhenPresent() {
        val resolved = resolveOptional({ "Uitvouwen" }, KEY_EXPAND_ACTION, AccordionSectionDefaults.EXPAND_ACTION)
        assertEquals("Uitvouwen", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsent() {
        val resolved = resolveOptional({ null }, KEY_EXPAND_ACTION, AccordionSectionDefaults.EXPAND_ACTION)
        assertEquals(AccordionSectionDefaults.EXPAND_ACTION, resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenBlank() {
        val resolved = resolveOptional({ "   " }, KEY_EMPTY_HINT, AccordionSectionDefaults.EMPTY_HINT)
        assertEquals(AccordionSectionDefaults.EMPTY_HINT, resolved)
    }

    private fun sampleStrings(): AccordionSectionStrings =
        AccordionSectionStrings(
            expandAction = AccordionSectionDefaults.EXPAND_ACTION,
            collapseAction = AccordionSectionDefaults.COLLAPSE_ACTION,
            expandedState = AccordionSectionDefaults.EXPANDED_STATE,
            collapsedState = AccordionSectionDefaults.COLLAPSED_STATE,
            emptyHint = AccordionSectionDefaults.EMPTY_HINT,
        )
}
