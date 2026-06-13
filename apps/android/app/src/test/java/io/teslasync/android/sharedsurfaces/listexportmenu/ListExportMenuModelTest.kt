package io.teslasync.android.sharedsurfaces.listexportmenu

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ListExportMenu's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/forms/ListExportMenu.tsx): the initial-scope choice, the scope snap-back
 * once the selection empties, the open-guard (`open && !disabled`), the scope-chooser visibility
 * (`selectedCount > 0`), the trigger-label ternary, the "Visible (N)" vs "Visible" count branch, and the
 * file-format row ordering (CSV then JSON). Because the composable is a thin render layer over these reducers,
 * the per-branch assertions here double as the surface's per-state snapshot. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ListExportMenuModelTest {
    // ── initial scope (web `useState(selectedCount > 0 ? 'selected' : 'visible')`) ───────────────────

    @Test
    fun initialScopeDefaultsToSelectedWhenRowsAreSelected() {
        assertEquals(ExportScope.Selected, listExportInitialScope(selectedCount = 1))
        assertEquals(ExportScope.Selected, listExportInitialScope(selectedCount = 42))
    }

    @Test
    fun initialScopeDefaultsToVisibleWhenNothingSelected() {
        assertEquals(ExportScope.Visible, listExportInitialScope(selectedCount = 0))
    }

    // ── scope snap-back (web `if (selectedCount === 0 && scope === 'selected') setScope('visible')`) ──

    @Test
    fun resolvedScopeSnapsSelectedBackToVisibleWhenSelectionEmpties() {
        assertEquals(ExportScope.Visible, listExportResolvedScope(ExportScope.Selected, selectedCount = 0))
    }

    @Test
    fun resolvedScopePassesEveryOtherCaseThrough() {
        // A live selection keeps "Selected"; "Visible" is always stable; an empty selection keeps "Visible".
        assertEquals(ExportScope.Selected, listExportResolvedScope(ExportScope.Selected, selectedCount = 3))
        assertEquals(ExportScope.Visible, listExportResolvedScope(ExportScope.Visible, selectedCount = 3))
        assertEquals(ExportScope.Visible, listExportResolvedScope(ExportScope.Visible, selectedCount = 0))
    }

    // ── open guard (web `open && !disabled`) ─────────────────────────────────────────────────────────

    @Test
    fun menuOpensOnlyWhenRequestedAndNotDisabled() {
        assertTrue(listExportMenuOpen(requestedOpen = true, disabled = false))
        assertFalse("disabled never opens", listExportMenuOpen(requestedOpen = true, disabled = true))
        assertFalse(listExportMenuOpen(requestedOpen = false, disabled = false))
        assertFalse(listExportMenuOpen(requestedOpen = false, disabled = true))
    }

    // ── scope-chooser visibility (web `{selectedCount > 0 && <fieldset/>}`) ───────────────────────────

    @Test
    fun scopeChooserShownOnlyWithANonEmptySelection() {
        assertFalse(listExportShowScopeChooser(selectedCount = 0))
        assertTrue(listExportShowScopeChooser(selectedCount = 1))
        assertTrue(listExportShowScopeChooser(selectedCount = 99))
    }

    // ── trigger label (web `triggerLabel` ternary) — the a11y label selection ────────────────────────

    @Test
    fun triggerLabelSelectsTheDisabledTooltipWhenDisabled() {
        val menuLabel = "Export list"
        val disabledTooltip = "No data to export"
        assertEquals(
            disabledTooltip,
            listExportTriggerLabel(disabled = true, menuLabel = menuLabel, disabledTooltip = disabledTooltip),
        )
        assertEquals(
            menuLabel,
            listExportTriggerLabel(disabled = false, menuLabel = menuLabel, disabledTooltip = disabledTooltip),
        )
    }

    // ── visible-count branch (web `visibleCount != null ? withCount : plain`) ────────────────────────

    @Test
    fun visibleUsesCountOnlyWhenAVisibleCountIsSupplied() {
        assertFalse("null count → bare 'Visible'", listExportVisibleUsesCount(visibleCount = null))
        assertTrue(listExportVisibleUsesCount(visibleCount = 0))
        assertTrue(listExportVisibleUsesCount(visibleCount = 250))
    }

    // ── file-format rows (web menu order: CSV then JSON) ─────────────────────────────────────────────

    @Test
    fun formatsAreCsvThenJsonInOrder() {
        assertEquals(listOf(ListExportFormat.Csv, ListExportFormat.Json), listExportFormats())
    }
}
