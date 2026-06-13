// Off-device unit coverage for the Drawer modal/dialog's pure model (P3 acceptance: adapter + per-branch +
// diagnostics tests). Exercises the `side` token mapping (web `'left' | 'right'`, default `'right'`), the
// projection's header / footer truthiness guards (web `title &&` / `footer &&`) and the `title || 'Panel'`
// accessible-name fallback, the registry identifiers, and the PII-safe `view.opened` diagnostic. No Compose /
// Android / HTTP — runs in :android:testReleaseUnitTest.
package io.teslasync.android.modalsdialogs.drawer

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DrawerModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<Triple<LogLevel, String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Triple(level, event, fields)
        }
    }

    // ---- DrawerSide: web `side` token mapping + default ('right') -------------------------------

    @Test
    fun side_mapsWebTokensToLogicalEdges() {
        assertEquals(DrawerSide.Start, DrawerSide.fromWeb("left"))
        assertEquals(DrawerSide.End, DrawerSide.fromWeb("right"))
        assertEquals("left", DrawerSide.Start.web)
        assertEquals("right", DrawerSide.End.web)
    }

    @Test
    fun side_defaultsToEndForUnknownToken() {
        assertEquals(DrawerSide.End, DrawerSide.DEFAULT)
        assertEquals(DrawerSide.End, DrawerSide.fromWeb("middle"))
        assertEquals(DrawerSide.End, DrawerSide.fromWeb(""))
    }

    // ---- Projection: header guard (web `title &&`) + accessible name (web `title || 'Panel'`) ---

    @Test
    fun project_showsHeaderAndUsesTitleNameWhenTitlePresent() {
        val display = DrawerProjection.project(title = "Filters", side = DrawerSide.End, hasFooter = false, panelFallback = "Panel")
        assertTrue(display.showHeader)
        assertEquals("Filters", display.accessibleName)
    }

    @Test
    fun project_hidesHeaderAndFallsBackToPanelWhenTitleNull() {
        val display = DrawerProjection.project(title = null, side = DrawerSide.End, hasFooter = false, panelFallback = "Panel")
        assertFalse(display.showHeader)
        assertEquals("Panel", display.accessibleName)
    }

    @Test
    fun project_treatsEmptyTitleAsAbsent() {
        // Web `title &&` is falsy for the empty string, and `title || 'Panel'` falls through to the fallback.
        val display = DrawerProjection.project(title = "", side = DrawerSide.Start, hasFooter = false, panelFallback = "Panel")
        assertFalse(display.showHeader)
        assertEquals("Panel", display.accessibleName)
    }

    // ---- Projection: footer guard (web `footer &&`) + side passthrough --------------------------

    @Test
    fun project_showsFooterOnlyWhenSupplied() {
        val withFooter = DrawerProjection.project(title = "T", side = DrawerSide.End, hasFooter = true, panelFallback = "Panel")
        assertTrue(withFooter.showFooter)

        val withoutFooter = DrawerProjection.project(title = "T", side = DrawerSide.End, hasFooter = false, panelFallback = "Panel")
        assertFalse(withoutFooter.showFooter)
    }

    @Test
    fun project_passesSideThrough() {
        assertEquals(DrawerSide.Start, DrawerProjection.project("T", DrawerSide.Start, false, "Panel").side)
        assertEquals(DrawerSide.End, DrawerProjection.project("T", DrawerSide.End, false, "Panel").side)
    }

    // ---- Registry + diagnostics -----------------------------------------------------------------

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("drawer", DrawerRegistration.ID)
        assertEquals("Drawer", DrawerRegistration.SLUG)
    }

    @Test
    fun recordDrawerOpened_emitsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        recordDrawerOpened(logger)

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "Drawer"), fields)
        // The diagnostic must carry no caller title or body content — only the surface slug, no digits.
        assertTrue(fields.values.none { value -> value.any(Char::isDigit) })
    }
}
