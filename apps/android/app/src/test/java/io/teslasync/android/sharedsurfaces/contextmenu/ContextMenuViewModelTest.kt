package io.teslasync.android.sharedsurfaces.contextmenu

import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ContextMenuViewModel] over an isolated [ContextMenuStore], covering the full imperative contract the web
 * component exposes through its module store + `invoke` (web/src/components/ui/ContextMenu.tsx): open populates the
 * snapshot, the empty-list open-guard is a no-op (the menu never mounts blank), dismiss clears it, selecting a row
 * closes the menu then runs the handler, a disabled row is ignored, a throwing handler is logged (slug only) rather
 * than propagated, the monotonic nonce changes on re-open, and the PII-safe `view.opened` diagnostic fires exactly
 * once. Also asserts the process-global [ContextMenuController] open-from-anywhere path. Runs in the
 * :android:testReleaseUnitTest gate.
 */
class ContextMenuViewModelTest {
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
        onClick: () -> Unit = {},
    ): ContextMenuItem = ContextMenuItem(id = id, label = id, onClick = onClick, enabled = enabled)

    private val anchor = ContextMenuAnchor(x = 10, y = 20)

    @Test
    fun openPopulatesSnapshot() {
        val vm = ContextMenuViewModel(ContextMenuStore(), NoopLogger)
        assertNull(vm.state.value)

        vm.open(listOf(item("a"), item("b")), anchor)

        val snapshot = vm.state.value
        assertNotNull(snapshot)
        assertEquals(2, snapshot!!.items.size)
        assertEquals(10, snapshot.anchor.x)
        assertEquals(20, snapshot.anchor.y)
    }

    @Test
    fun openWithEmptyItemsIsANoOp() {
        val vm = ContextMenuViewModel(ContextMenuStore(), NoopLogger)
        vm.open(emptyList(), anchor)
        assertNull(vm.state.value)
    }

    @Test
    fun dismissClearsSnapshot() {
        val vm = ContextMenuViewModel(ContextMenuStore(), NoopLogger)
        vm.open(listOf(item("a")), anchor)
        assertNotNull(vm.state.value)

        vm.dismiss()
        assertNull(vm.state.value)
    }

    @Test
    fun selectClosesThenInvokesHandler() {
        var clicked = false
        val vm = ContextMenuViewModel(ContextMenuStore(), NoopLogger)
        val row = item("a", onClick = { clicked = true })
        vm.open(listOf(row), anchor)

        vm.select(row)

        assertTrue(clicked)
        assertNull(vm.state.value)
    }

    @Test
    fun selectIgnoresDisabledRow() {
        var clicked = false
        val vm = ContextMenuViewModel(ContextMenuStore(), NoopLogger)
        vm.open(listOf(item("visible")), anchor)
        val disabled = item("x", enabled = false, onClick = { clicked = true })

        vm.select(disabled)

        assertFalse(clicked)
        assertNotNull(vm.state.value)
    }

    @Test
    fun selectLogsHandlerFailureWithoutPropagating() {
        val logger = RecordingLogger()
        val vm = ContextMenuViewModel(ContextMenuStore(), logger)
        val row = item("a", onClick = { error("boom") })
        vm.open(listOf(row), anchor)

        vm.select(row)

        val failure = logger.events.single { it.first == "contextMenu.itemError" }
        assertEquals(mapOf("surface" to "ContextMenu"), failure.second)
        assertNull(vm.state.value)
    }

    @Test
    fun reopenAtSameAnchorBumpsNonce() {
        val store = ContextMenuStore()
        val vm = ContextMenuViewModel(store, NoopLogger)
        vm.open(listOf(item("a")), anchor)
        val first = vm.state.value!!.nonce

        vm.open(listOf(item("a")), anchor)
        val second = vm.state.value!!.nonce

        assertTrue(second > first)
    }

    @Test
    fun onViewOpenedEmitsSlugExactlyOnce() {
        val logger = RecordingLogger()
        val vm = ContextMenuViewModel(ContextMenuStore(), logger)

        vm.onViewOpened()
        vm.onViewOpened()

        val opened = logger.events.filter { it.first == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(mapOf("surface" to "ContextMenu"), opened.single().second)
    }

    @Test
    fun globalControllerOpensAndClosesSharedStore() {
        ContextMenuController.close()
        assertNull(ContextMenuController.state.value)

        ContextMenuController.open(listOf(item("a")), x = 5, y = 6)
        assertNotNull(ContextMenuController.state.value)

        ContextMenuController.close()
        assertNull(ContextMenuController.state.value)
    }
}
