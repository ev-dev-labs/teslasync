package io.teslasync.android.sharedsurfaces.chartexportmenu

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the ChartExportMenu's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/charts/ChartExportMenu.tsx): the menu-row composition + ordering (optional
 * CSV first, then PNG / SVG / Copy), the busy enablement (image rows disabled, CSV unaffected), the
 * open-guard (`open && !disabled`), the trigger-label ternary, and the copy-outcome → toast-severity switch.
 * Because the composable is a thin render layer over these reducers, the per-branch assertions here double as
 * the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class ChartExportMenuModelTest {
    // ── menu rows: composition, ordering, enablement (web menu items) ────────────────────────────────

    @Test
    fun menuItemsWithoutCsvListsTheThreeImageRowsInOrder() {
        val items = chartExportMenuItems(hasCsv = false, busy = false)
        assertEquals(
            listOf(ChartExportAction.Png, ChartExportAction.Svg, ChartExportAction.Copy),
            items.map { it.action },
        )
        assertTrue("every row enabled when idle", items.all { it.enabled })
    }

    @Test
    fun menuItemsWithCsvPrependsTheCsvRow() {
        // Web renders the CSV item first when `onExportCsv` is supplied.
        val items = chartExportMenuItems(hasCsv = true, busy = false)
        assertEquals(
            listOf(
                ChartExportAction.Csv,
                ChartExportAction.Png,
                ChartExportAction.Svg,
                ChartExportAction.Copy,
            ),
            items.map { it.action },
        )
        assertEquals(ChartExportAction.Csv, items.first().action)
    }

    @Test
    fun busyDisablesImageRowsButKeepsCsvEnabled() {
        // Web: `disabled={busy}` on PNG/SVG/Copy; the CSV item omits `busy` (it does not need the chart canvas).
        val items = chartExportMenuItems(hasCsv = true, busy = true).associateBy { it.action }
        assertTrue("CSV ignores busy", items.getValue(ChartExportAction.Csv).enabled)
        assertFalse(items.getValue(ChartExportAction.Png).enabled)
        assertFalse(items.getValue(ChartExportAction.Svg).enabled)
        assertFalse(items.getValue(ChartExportAction.Copy).enabled)
    }

    @Test
    fun notBusyEnablesEveryImageRow() {
        val items = chartExportMenuItems(hasCsv = false, busy = false).associateBy { it.action }
        assertTrue(items.getValue(ChartExportAction.Png).enabled)
        assertTrue(items.getValue(ChartExportAction.Svg).enabled)
        assertTrue(items.getValue(ChartExportAction.Copy).enabled)
    }

    // ── open guard (web `open && !disabled`) ─────────────────────────────────────────────────────────

    @Test
    fun menuOpensOnlyWhenRequestedAndNotDisabled() {
        assertTrue(chartExportMenuOpen(requestedOpen = true, disabled = false))
        assertFalse("disabled never opens", chartExportMenuOpen(requestedOpen = true, disabled = true))
        assertFalse(chartExportMenuOpen(requestedOpen = false, disabled = false))
        assertFalse(chartExportMenuOpen(requestedOpen = false, disabled = true))
    }

    // ── trigger label (web `triggerLabel` ternary) — the a11y label selection ────────────────────────

    @Test
    fun triggerLabelSelectsTheDisabledTooltipWhenDisabled() {
        val menuLabel = "Export chart"
        val disabledTooltip = "Chart not ready to export"
        assertEquals(
            disabledTooltip,
            chartExportTriggerLabel(disabled = true, menuLabel = menuLabel, disabledTooltip = disabledTooltip),
        )
        assertEquals(
            menuLabel,
            chartExportTriggerLabel(disabled = false, menuLabel = menuLabel, disabledTooltip = disabledTooltip),
        )
    }

    // ── copy outcome → toast severity (web `toast.success` / `.info` / `.error`) ─────────────────────

    @Test
    fun copyOutcomeMapsToTheWebToastSeverities() {
        assertEquals(CopyToastSeverity.Success, copyToastSeverity(ClipboardOutcome.Copied))
        assertEquals(CopyToastSeverity.Info, copyToastSeverity(ClipboardOutcome.Fallback))
        assertEquals(CopyToastSeverity.Error, copyToastSeverity(ClipboardOutcome.Failed))
    }
}
