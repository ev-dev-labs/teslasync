package io.teslasync.android.sharedsurfaces.checkbox

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Checkbox surface's pure logic — the native mirror of the one decision the web
 * component makes before it paints its box (web/src/components/ui/Checkbox.tsx): the indeterminate-wins /
 * checked / empty precedence, and which boxes wear the accent treatment. Because the composable is a thin render
 * layer over [indicatorFor], the per-branch assertions here double as the surface's per-state snapshot. Runs in
 * the :android:testReleaseUnitTest gate.
 */
class CheckboxModelTest {
    // ── indicatorFor: the per-state snapshot (web `indeterminate ? Minus : checked ? Check : empty`) ─────

    @Test
    fun unselectedAndNotIndeterminateIsTheEmptyBox() {
        assertEquals(CheckboxIndicator.Empty, indicatorFor(checked = false, indeterminate = false))
    }

    @Test
    fun checkedAndNotIndeterminateShowsTheCheck() {
        assertEquals(CheckboxIndicator.Checked, indicatorFor(checked = true, indeterminate = false))
    }

    @Test
    fun indeterminateShowsTheMixedBoxEvenWhenAlsoChecked() {
        // web: `indeterminate ? <Minus/> : <Check/>` — indeterminate wins regardless of `checked`.
        assertEquals(CheckboxIndicator.Mixed, indicatorFor(checked = false, indeterminate = true))
        assertEquals(CheckboxIndicator.Mixed, indicatorFor(checked = true, indeterminate = true))
    }

    // ── isActive: the accent border/fill is shared by checked AND mixed (web peer-checked/peer-indeterminate) ─

    @Test
    fun bothCheckedAndMixedAreActiveButEmptyIsNot() {
        assertTrue(CheckboxIndicator.Checked.isActive)
        assertTrue(CheckboxIndicator.Mixed.isActive)
        assertFalse(CheckboxIndicator.Empty.isActive)
    }

    // ── size contract: the three web sizes are all modelled (sm / md / lg) ──────────────────────────────

    @Test
    fun everySizeFromTheWebPropIsModelled() {
        assertEquals(3, CheckboxSize.entries.size)
        assertTrue(CheckboxSize.entries.containsAll(listOf(CheckboxSize.Sm, CheckboxSize.Md, CheckboxSize.Lg)))
    }

    // ── registration / slug contract ─────────────────────────────────────────────────────────────────

    @Test
    fun slugMatchesTheSurfaceContract() {
        assertEquals("Checkbox", CHECKBOX_SLUG)
        assertEquals("Checkbox", CheckboxRegistration.SLUG)
        assertEquals("checkbox", CheckboxRegistration.ID)
    }
}
