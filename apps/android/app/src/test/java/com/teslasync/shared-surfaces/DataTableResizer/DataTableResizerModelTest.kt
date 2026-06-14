// Off-device verification of the DataTableResizer surface's pure logic — the native mirror of every decision the
// web component makes (web/src/components/ui/DataTableResizer.tsx): the rounding/clamping bounds arithmetic, the
// WAI-ARIA "Window Splitter" keyboard command map (ArrowLeft −8 / ArrowRight +8 / Home → 80 / End → max), the
// `label ?? \`Resize column ${columnKey}\`` resolution, the `t(key, default)` resolver, and the PII-safe
// diagnostics slug. Because the composable is a thin render layer over DataTableResizerModel, the per-branch
// assertions here double as the surface's per-state snapshot (idle / min-bound / max-bound). No Compose /
// Android framework / HTTP — runs in the :android:testReleaseUnitTest gate; the on-device render + drag +
// accessibility live in DataTableResizerUiTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DataTableResizer) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datatableresizer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DataTableResizerModelTest {
    // ── registration slug mirrors the prompt-mandated surface slug ──────────────────

    @Test
    fun slugIsThePromptSurfaceSlug() {
        assertEquals("DataTableResizer", DATA_TABLE_RESIZER_SLUG)
        assertEquals(DATA_TABLE_RESIZER_SLUG, DataTableResizerDiagnostics.SLUG)
        assertEquals(DATA_TABLE_RESIZER_SLUG, DataTableResizerRegistration.SLUG)
        assertEquals("data-table-resizer", DataTableResizerRegistration.ID)
    }

    @Test
    fun defaultsMirrorTheWebPropDefaults() {
        // web minWidth = 60, maxWidth = 800, keyboard ± 8, Home → 80.
        assertEquals(60, DataTableResizerDefaults.MIN_WIDTH_DP)
        assertEquals(800, DataTableResizerDefaults.MAX_WIDTH_DP)
        assertEquals(8, DataTableResizerDefaults.STEP_DP)
        assertEquals(80, DataTableResizerDefaults.HOME_DP)
        assertEquals(60, DEFAULT_MIN_WIDTH_DP)
        assertEquals(800, DEFAULT_MAX_WIDTH_DP)
        assertEquals(8, KEYBOARD_STEP_DP)
        assertEquals(80, HOME_WIDTH_DP)
    }

    // ── clamp: web `Math.max(min, Math.min(max, Math.round(n)))` ────────────────────

    @Test
    fun clampRoundsToWholeDp() {
        val bounds = ResizeBounds()
        assertEquals(124, bounds.clamp(123.6f))
        assertEquals(123, bounds.clamp(123.4f))
        // round half up to even/away — kotlin roundToInt rounds half up.
        assertEquals(124, bounds.clamp(123.5f))
    }

    @Test
    fun clampHoldsTheMinAndMaxBound() {
        val bounds = ResizeBounds(minWidthDp = 60, maxWidthDp = 800)
        assertEquals(60, bounds.clamp(10f))
        assertEquals(60, bounds.clamp(59.9f))
        assertEquals(800, bounds.clamp(5000f))
        assertEquals(800, bounds.clamp(800.4f))
        assertEquals(300, bounds.clamp(300f))
    }

    @Test
    fun clampIntOverloadMatchesTheFloatPath() {
        val bounds = ResizeBounds(minWidthDp = 60, maxWidthDp = 800)
        assertEquals(60, bounds.clamp(40))
        assertEquals(800, bounds.clamp(900))
        assertEquals(123, bounds.clamp(123))
    }

    @Test
    fun degenerateBoundsNeverThrow() {
        // The web never guards min <= max; effectiveMax keeps clamp's range non-empty.
        val bounds = ResizeBounds(minWidthDp = 200, maxWidthDp = 100)
        assertEquals(200, bounds.effectiveMax)
        assertEquals(200, bounds.clamp(500f))
        assertEquals(200, bounds.clamp(10f))
        assertEquals(200, bounds.endWidth())
    }

    // ── keyboard command map: the WAI-ARIA splitter (web onKeyDown switch) ──────────

    @Test
    fun nudgeStepsAndClamps() {
        val bounds = ResizeBounds(minWidthDp = 60, maxWidthDp = 800)
        assertEquals(208, bounds.nudge(currentDp = 200, deltaDp = 8))
        assertEquals(192, bounds.nudge(currentDp = 200, deltaDp = -8))
        assertEquals(60, bounds.nudge(currentDp = 62, deltaDp = -8))
        assertEquals(800, bounds.nudge(currentDp = 798, deltaDp = 8))
    }

    @Test
    fun applyCommandGrowAndShrinkUseTheKeyboardStep() {
        val bounds = ResizeBounds()
        assertEquals(208, bounds.applyCommand(currentDp = 200, command = ResizeCommand.Grow))
        assertEquals(192, bounds.applyCommand(currentDp = 200, command = ResizeCommand.Shrink))
    }

    @Test
    fun applyCommandHomeSnapsToEightyAndEndMaxesOut() {
        val bounds = ResizeBounds(minWidthDp = 60, maxWidthDp = 800)
        assertEquals(80, bounds.applyCommand(currentDp = 400, command = ResizeCommand.Home))
        assertEquals(80, bounds.homeWidth())
        assertEquals(800, bounds.applyCommand(currentDp = 400, command = ResizeCommand.End))
        assertEquals(800, bounds.endWidth())
    }

    @Test
    fun homeIsClampedWhenMinExceedsEighty() {
        // web `clamp(80)` — when the minimum is larger than 80, Home cannot go below it.
        val bounds = ResizeBounds(minWidthDp = 120, maxWidthDp = 800)
        assertEquals(120, bounds.homeWidth())
        assertEquals(120, bounds.applyCommand(currentDp = 400, command = ResizeCommand.Home))
    }

    @Test
    fun shrinkAndGrowHonourTheBoundsAtTheEdges() {
        val bounds = ResizeBounds(minWidthDp = 60, maxWidthDp = 800)
        // At the min, Shrink stays put; at the max, Grow stays put — the idle/min and idle/max states.
        assertEquals(60, bounds.applyCommand(currentDp = 60, command = ResizeCommand.Shrink))
        assertEquals(800, bounds.applyCommand(currentDp = 800, command = ResizeCommand.Grow))
    }

    // ── i18n label: web `label ?? \`Resize column ${columnKey}\`` ────────────────────

    @Test
    fun resizeColumnLabelFormatsTheColumnKey() {
        assertEquals("Resize column speed", resizeColumnLabel(DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE, "speed"))
        assertEquals(
            "Resize column odometer",
            resizeColumnLabel(DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE, "odometer"),
        )
    }

    @Test
    fun resolvedLabelPrefersANonBlankOverride() {
        val resolved =
            resolvedResizeLabel(
                override = "Resize the speed column",
                template = DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE,
                columnKey = "speed",
            )
        assertEquals("Resize the speed column", resolved)
    }

    @Test
    fun resolvedLabelFallsBackToTheTemplateWhenOverrideAbsentOrBlank() {
        val template = DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE
        assertEquals("Resize column speed", resolvedResizeLabel(override = null, template = template, columnKey = "speed"))
        assertEquals("Resize column speed", resolvedResizeLabel(override = "  ", template = template, columnKey = "speed"))
    }

    @Test
    fun resolveOptionalReturnsTheCatalogValueWhenPresent() {
        val resolved = resolveOptional({ "Redimensionner %1\$s" }, KEY_RESIZE_COLUMN, DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE)
        assertEquals("Redimensionner %1\$s", resolved)
    }

    @Test
    fun resolveOptionalFallsBackWhenAbsentOrBlank() {
        val fallback = DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE
        assertEquals(fallback, resolveOptional({ null }, KEY_RESIZE_COLUMN, fallback))
        assertEquals(fallback, resolveOptional({ "   " }, KEY_RESIZE_COLUMN, fallback))
    }

    @Test
    fun catalogKeyIsNamespacedToTheSurface() {
        assertEquals("translation_dataTableResizer_resizeColumn", KEY_RESIZE_COLUMN)
    }

    @Test
    fun catalogValueFlowsThroughResolvedLabel() {
        // A localized template still has the column key formatted into it (positional %1$s).
        val template = resolveOptional({ "%1\$s breite anpassen" }, KEY_RESIZE_COLUMN, DataTableResizerDefaults.RESIZE_COLUMN_TEMPLATE)
        assertEquals("power breite anpassen", resolvedResizeLabel(override = null, template = template, columnKey = "power"))
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
        DataTableResizerDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no column key or width can leak through the diagnostic.
        assertEquals(mapOf("surface" to "DataTableResizer"), records[0].fields)
    }

    @Test
    fun diagnosticsConstantsAreStable() {
        assertEquals("view.opened", DataTableResizerDiagnostics.EVENT_VIEW_OPENED)
        assertEquals("surface", DataTableResizerDiagnostics.FIELD_SURFACE)
    }

    @Test
    fun commandEnumCoversTheFourSplitterKeys() {
        // The full WAI-ARIA splitter command set the composable maps physical keys onto.
        assertEquals(
            listOf(ResizeCommand.Shrink, ResizeCommand.Grow, ResizeCommand.Home, ResizeCommand.End),
            ResizeCommand.entries.toList(),
        )
        assertTrue(ResizeCommand.entries.contains(ResizeCommand.Home))
        assertFalse(ResizeCommand.entries.isEmpty())
    }
}
