package io.teslasync.android.sharedsurfaces.contextmenu

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device unit coverage for the pure ContextMenu model — the data and geometry the web component
 * (web/src/components/ui/ContextMenu.tsx) derives before it paints. Asserts the keyboard-roving-focus traversal
 * (Arrow Up/Down skip disabled rows and wrap, Home/End jump to the ends, the first-Arrow-from-container behaviour),
 * the viewport-overflow flip geometry (web `useLayoutEffect`: right-edge flips to x, bottom-edge flips to y, each
 * clamped to the margin), the snapshot helpers, and the PII-safe `view.opened` diagnostic — the adapter unit test
 * the prompt mandates. Runs in the :android:testReleaseUnitTest gate.
 */
class ContextMenuModelTest {
    private class RecordingLogger : Logger {
        val events = mutableListOf<Pair<String, Map<String, String>>>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            events += event to fields
        }
    }

    private fun item(
        id: String,
        enabled: Boolean = true,
    ): ContextMenuItem = ContextMenuItem(id = id, label = id, onClick = {}, enabled = enabled)

    private val mixed = listOf(item("a"), item("b", enabled = false), item("c"))

    @Test
    fun enabledIndicesSkipsDisabledRows() {
        assertEquals(listOf(0, 2), ContextMenuFocus.enabledIndices(mixed))
    }

    @Test
    fun firstAndLastEnabledIndex() {
        assertEquals(0, ContextMenuFocus.firstEnabledIndex(mixed))
        assertEquals(2, ContextMenuFocus.lastEnabledIndex(mixed))
    }

    @Test
    fun nextEnabledIndexForwardSkipsDisabledAndWraps() {
        assertEquals(2, ContextMenuFocus.nextEnabledIndex(mixed, current = 0, forward = true))
        assertEquals(0, ContextMenuFocus.nextEnabledIndex(mixed, current = 2, forward = true))
    }

    @Test
    fun nextEnabledIndexBackwardSkipsDisabledAndWraps() {
        assertEquals(0, ContextMenuFocus.nextEnabledIndex(mixed, current = 2, forward = false))
        assertEquals(2, ContextMenuFocus.nextEnabledIndex(mixed, current = 0, forward = false))
    }

    @Test
    fun nextEnabledIndexFromContainerStartsAtEdge() {
        assertEquals(0, ContextMenuFocus.nextEnabledIndex(mixed, current = -1, forward = true))
        assertEquals(2, ContextMenuFocus.nextEnabledIndex(mixed, current = -1, forward = false))
    }

    @Test
    fun nextEnabledIndexAllDisabledIsNull() {
        val allDisabled = listOf(item("a", enabled = false), item("b", enabled = false))
        assertNull(ContextMenuFocus.nextEnabledIndex(allDisabled, current = -1, forward = true))
        assertNull(ContextMenuFocus.firstEnabledIndex(allDisabled))
    }

    @Test
    fun placementWithoutOverflowKeepsAnchor() {
        val offset =
            ContextMenuPlacement.resolvePosition(
                anchor = ContextMenuAnchor(x = 100, y = 120),
                menuSize = ContextMenuSize(width = 200, height = 150),
                windowSize = ContextMenuSize(width = 1000, height = 1000),
                marginPx = 8,
            )
        assertEquals(ContextMenuOffset(100, 120), offset)
    }

    @Test
    fun placementFlipsLeftOnRightOverflow() {
        val offset =
            ContextMenuPlacement.resolvePosition(
                anchor = ContextMenuAnchor(x = 900, y = 100),
                menuSize = ContextMenuSize(width = 200, height = 150),
                windowSize = ContextMenuSize(width = 1000, height = 1000),
                marginPx = 8,
            )
        assertEquals(700, offset.x)
        assertEquals(100, offset.y)
    }

    @Test
    fun placementFlipsUpOnBottomOverflow() {
        val offset =
            ContextMenuPlacement.resolvePosition(
                anchor = ContextMenuAnchor(x = 100, y = 950),
                menuSize = ContextMenuSize(width = 200, height = 150),
                windowSize = ContextMenuSize(width = 1000, height = 1000),
                marginPx = 8,
            )
        assertEquals(100, offset.x)
        assertEquals(800, offset.y)
    }

    @Test
    fun placementClampsFlippedEdgeToMargin() {
        val offset =
            ContextMenuPlacement.resolvePosition(
                anchor = ContextMenuAnchor(x = 50, y = 50),
                menuSize = ContextMenuSize(width = 200, height = 200),
                windowSize = ContextMenuSize(width = 100, height = 100),
                marginPx = 8,
            )
        assertEquals(ContextMenuOffset(8, 8), offset)
    }

    @Test
    fun stateSnapshotHelpers() {
        val open = ContextMenuState(items = mixed, anchor = ContextMenuAnchor(0, 0), nonce = 1L)
        assertFalse(open.isEmpty)
        assertTrue(open.hasEnabledItem)

        val allDisabled =
            ContextMenuState(
                items = listOf(item("a", enabled = false)),
                anchor = ContextMenuAnchor(0, 0),
                nonce = 1L,
            )
        assertFalse(allDisabled.hasEnabledItem)
    }

    @Test
    fun slugMatchesPromptMandate() {
        assertEquals("ContextMenu", CONTEXT_MENU_SLUG)
        assertEquals("ContextMenu", ContextMenuRegistration.SLUG)
        assertEquals("ContextMenu", ContextMenuDiagnostics.SLUG)
    }

    @Test
    fun recordViewOpenedEmitsPiiSafeSlugOnly() {
        val logger = RecordingLogger()
        ContextMenuDiagnostics.recordViewOpened(logger)

        assertEquals(1, logger.events.size)
        assertEquals("view.opened", logger.events.single().first)
        assertEquals(mapOf("surface" to "ContextMenu"), logger.events.single().second)
    }
}
