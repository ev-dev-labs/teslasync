// Tests [TreeSelectViewModel] against the [TreeSelectSource] seam — the state-holder binding the P3 contract
// mandates: the catalog feed routed from the bound source while observed, the controlled search / selection /
// expansion intents (block toggles preserving out-of-filter picks, the no-toggle-while-searching rule), the
// hard-error phase, the retry re-fetch, and the one-shot PII-safe `view.opened` diagnostic (slug only, no
// label or selected id). The framework-free projection is covered by TreeSelectModelTest. Runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.treeselect

import io.teslasync.android.components.forms.TreeGroup
import io.teslasync.android.components.forms.TreeLeaf
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TreeSelectViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    @Test
    fun feedResolvesToTheBoundCatalogWhileObserved() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            val display = vm.uiModel.value.display
            assertEquals(TreeSelectPhase.Content, display.phase)
            assertEquals(2, display.groups.size)
            assertEquals(4, display.totalLeafCount)
        }

    @Test
    fun searchNarrowsTheVisibleTreeWithoutFlattening() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            vm.onSearchChange("speed")
            advanceUntilIdle()

            val display = vm.uiModel.value.display
            assertEquals("speed", vm.uiModel.value.searchQuery)
            assertEquals(1, display.visibleLeafCount)
            assertTrue(display.isSearching)
        }

    @Test
    fun toggleLeafUpdatesTheSelection() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            vm.toggleLeaf("speed")
            assertEquals(setOf("speed"), vm.selected.value)
            vm.toggleLeaf("speed")
            assertEquals(emptySet<String>(), vm.selected.value)
        }

    @Test
    fun toggleGroupSelectsVisibleEnabledLeaves() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm(disabled = setOf("rpm"))
            observe(vm)

            vm.toggleGroup("powertrain")
            assertEquals(setOf("speed"), vm.selected.value)
        }

    @Test
    fun toggleAllVisibleSelectsEveryFilteredLeaf() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            vm.toggleAllVisible()
            assertEquals(setOf("speed", "rpm", "soc", "temp"), vm.selected.value)
        }

    @Test
    fun clearAllResetsTheSelection() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm(initial = setOf("speed", "soc"))
            observe(vm)

            vm.clearAll()
            assertEquals(emptySet<String>(), vm.selected.value)
        }

    @Test
    fun setSelectedReplacesTheSelection() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            vm.setSelected(setOf("soc"))
            assertEquals(setOf("soc"), vm.selected.value)
        }

    @Test
    fun toggleExpandedFlipsAGroupOpenAndClosed() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            vm.toggleExpanded("powertrain")
            advanceUntilIdle()
            assertTrue(powertrain(vm).expanded)

            vm.toggleExpanded("powertrain")
            advanceUntilIdle()
            assertFalse(powertrain(vm).expanded)
        }

    @Test
    fun toggleExpandedIsANoOpWhileSearching() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            vm.onSearchChange("speed")
            vm.toggleExpanded("powertrain")
            vm.onSearchChange("")
            advanceUntilIdle()

            assertFalse(powertrain(vm).expanded)
        }

    @Test
    fun hardErrorWithNoCacheSurfacesTheErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = TreeSelectViewModel(errorSource(), RecordingLogger(), backgroundScope)
            observe(vm)

            val display = vm.uiModel.value.display
            assertEquals(TreeSelectPhase.Error, display.phase)
            assertTrue(display.canRetry)
        }

    @Test
    fun retryEmitsTheRefreshDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = TreeSelectViewModel(staticSource(), logger, backgroundScope)
            observe(vm)

            vm.retry()
            advanceUntilIdle()

            val refreshes = logger.records.filter { it.event == TreeSelectDiagnostics.REFRESH_EVENT }
            assertEquals(1, refreshes.size)
            assertEquals("TreeSelect", refreshes.first().fields["surface"])
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = TreeSelectViewModel(staticSource(), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("TreeSelect", opened.first().fields["surface"])
        }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private fun TestScope.observe(vm: TreeSelectViewModel) {
        backgroundScope.launch { vm.uiModel.collect {} }
        advanceUntilIdle()
    }

    private fun TestScope.staticVm(
        disabled: Set<String> = emptySet(),
        initial: Set<String> = emptySet(),
    ): TreeSelectViewModel =
        TreeSelectViewModel(
            source = staticSource(),
            logger = RecordingLogger(),
            scope = backgroundScope,
            disabledLeafIds = disabled,
            initialSelectedIds = initial,
        )

    private fun powertrain(vm: TreeSelectViewModel): TreeSelectGroupRow {
        val groups = vm.uiModel.value.display.groups
        return groups.first { it.id == "powertrain" }
    }

    private fun staticSource(): TreeSelectSource = staticTreeSelectSource(catalog(), fetchedAt = 1L)

    private fun errorSource(): TreeSelectSource =
        TreeSelectSource {
            flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
        }

    private fun catalog(): List<TreeGroup> =
        listOf(
            TreeGroup("powertrain", "Powertrain", listOf(TreeLeaf("speed", "Vehicle speed"), TreeLeaf("rpm", "Motor RPM"))),
            TreeGroup("battery", "Battery", listOf(TreeLeaf("soc", "State of charge"), TreeLeaf("temp", "Pack temperature"))),
        )
}
