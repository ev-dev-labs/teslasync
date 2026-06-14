// Off-device unit tests for [DataTableColumnMenuViewModel] over controllable fakes (the
// :android:testReleaseUnitTest gate). They cover the popover-open reducer the web `open` state drives (toggle +
// explicit set), the layout round-trip delegated to the bound [ColumnLayoutStore] (the web `onChange` / `onReset`),
// the visibility + reorder guards folded from the model (a guarded toggle / move is a no-op, never an apply), and
// the PII-safe `view.opened` diagnostic emitted at most once.
//
// `InvalidPackageDeclaration` is not needed here — the test lives in the surface's real package directory.
package io.teslasync.android.sharedsurfaces.datatablecolumnmenu

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DataTableColumnMenuViewModelTest {
    // ── open reducer (web open state) ───────────────────────────────────────────────────────────────────────────
    @Test
    fun openStartsClosedAndToggles() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            assertFalse(vm.open.value)

            vm.toggleOpen()
            assertTrue(vm.open.value)

            vm.toggleOpen()
            assertFalse(vm.open.value)
        }

    @Test
    fun setOpenSetsTheFlagExplicitly() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.setOpen(true)
            assertTrue(vm.open.value)

            vm.setOpen(false)
            assertFalse(vm.open.value)
        }

    // ── layout round-trip (web onChange / onReset) ──────────────────────────────────────────────────────────────
    @Test
    fun toggleColumnAppliesTheNextLayoutToTheStore() =
        runTest(UnconfinedTestDispatcher()) {
            val store = FakeColumnLayoutStore()
            val vm = viewModel(store = store)

            vm.onToggleColumn(cols("a", "b", "c"), "a")

            assertEquals(1, store.applied.size)
            assertEquals(listOf("a"), store.layout.value?.hidden)
        }

    @Test
    fun toggleColumnIsANoOpWhenHidingTheLastVisibleColumn() =
        runTest(UnconfinedTestDispatcher()) {
            val store = FakeColumnLayoutStore(initial = ColumnLayout(order = listOf("a", "b"), hidden = listOf("b")))
            val vm = viewModel(store = store)

            vm.onToggleColumn(cols("a", "b"), "a")

            assertTrue("a guarded toggle never persists", store.applied.isEmpty())
        }

    @Test
    fun moveColumnAppliesTheReorderToTheStore() =
        runTest(UnconfinedTestDispatcher()) {
            val store = FakeColumnLayoutStore()
            val vm = viewModel(store = store)

            vm.onMoveColumn(cols("a", "b", "c"), "a", MoveDirection.Down)

            assertEquals(listOf("b", "a", "c"), store.layout.value?.order)
        }

    @Test
    fun moveColumnIsANoOpPastTheEndOfTheList() =
        runTest(UnconfinedTestDispatcher()) {
            val store = FakeColumnLayoutStore()
            val vm = viewModel(store = store)

            vm.onMoveColumn(cols("a", "b", "c"), "a", MoveDirection.Up)

            assertTrue("a guarded move never persists", store.applied.isEmpty())
        }

    @Test
    fun applyLayoutForwardsAControlledUpdate() =
        runTest(UnconfinedTestDispatcher()) {
            val store = FakeColumnLayoutStore()
            val vm = viewModel(store = store)
            val layout = ColumnLayout(order = listOf("b", "a"), hidden = listOf("a"))

            vm.applyLayout(layout)

            assertEquals(layout, store.layout.value)
        }

    @Test
    fun resetLayoutClearsTheStore() =
        runTest(UnconfinedTestDispatcher()) {
            val store = FakeColumnLayoutStore(initial = ColumnLayout(order = listOf("a"), hidden = emptyList()))
            val vm = viewModel(store = store)

            vm.resetLayout()

            assertEquals(1, store.resetCount)
            assertNull(vm.layout.value)
        }

    // ── diagnostics (P1/S11) ────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun onViewOpenedEmitsSurfaceSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "DataTableColumnMenu"), opened.single().second)
        }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
    private fun cols(vararg keys: String): List<ColumnDescriptor> = keys.map { ColumnDescriptor(key = it, header = it.uppercase()) }

    private fun TestScope.viewModel(
        store: ColumnLayoutStore = FakeColumnLayoutStore(),
        logger: Logger = RecordingLogger(),
    ): DataTableColumnMenuViewModel = DataTableColumnMenuViewModel(store, logger, scope = backgroundScope)
}
