// Tests [LinearSidebarViewModel] against the [LinearSidebarSource] seam — the state-holder binding the P3
// contract mandates: the nav feed routed from the bound source while observed, the controlled filter /
// collapse / expand intents (default "collapse all but the active section", toggle, auto-expand on
// navigation), the hard-error phase, the retry re-fetch, and the one-shot PII-safe `view.opened` diagnostic
// (slug only, no label or route). The framework-free projection is covered by LinearSidebarModelTest. Runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.linearsidebar

import io.teslasync.android.components.ui.TeslaGlyphs
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
class LinearSidebarViewModelTest {
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
    fun feedResolvesToTheBoundNavWhileObserved() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            val display = vm.uiModel.value.display
            assertEquals(LinearSidebarPhase.Content, display.phase)
            assertEquals(listOf("Overview", "Energy", "Alerts"), display.sections.map { it.title })
            assertTrue(display.hasFavorites)
        }

    @Test
    fun defaultExpansionOpensOnlyTheActiveSection() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm(activePath = "/energy")
            observe(vm)

            val display = vm.uiModel.value.display
            assertTrue(display.sections.single { it.title == "Energy" }.expanded)
            assertFalse(display.sections.single { it.title == "Overview" }.expanded)
        }

    @Test
    fun filterNarrowsTheVisibleTree() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            vm.onFilterChange("battery")
            advanceUntilIdle()

            val display = vm.uiModel.value.display
            assertEquals("battery", vm.uiModel.value.filterQuery)
            assertEquals(listOf("Energy"), display.sections.map { it.title })
            assertTrue(display.isSearching)
        }

    @Test
    fun clearFilterRestoresTheFullTree() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm()
            observe(vm)

            vm.onFilterChange("battery")
            advanceUntilIdle()
            vm.clearFilter()
            advanceUntilIdle()

            assertEquals("", vm.uiModel.value.filterQuery)
            assertFalse(vm.uiModel.value.display.isSearching)
            assertEquals(3, vm.uiModel.value.display.sections.size)
        }

    @Test
    fun toggleSectionCollapsesThenExpandsTheActiveSection() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm(activePath = "/energy")
            observe(vm)

            vm.toggleSection("Energy")
            advanceUntilIdle()
            assertFalse(section(vm, "Energy").expanded)

            vm.toggleSection("Energy")
            advanceUntilIdle()
            assertTrue(section(vm, "Energy").expanded)
        }

    @Test
    fun expandSectionOpensACollapsedSectionAndIsANoOpWhenOpen() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = staticVm(activePath = "/energy")
            observe(vm)

            // Overview is collapsed by default — expanding it opens it.
            vm.expandSection("Overview")
            advanceUntilIdle()
            assertTrue(section(vm, "Overview").expanded)

            // Re-expanding the already-open Energy section never collapses it.
            vm.expandSection("Energy")
            advanceUntilIdle()
            assertTrue(section(vm, "Energy").expanded)
        }

    @Test
    fun hardErrorWithNoCacheSurfacesTheErrorPhase() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = LinearSidebarViewModel(errorSource(), RecordingLogger(), backgroundScope)
            observe(vm)

            val display = vm.uiModel.value.display
            assertEquals(LinearSidebarPhase.Error, display.phase)
            assertTrue(display.canRetry)
        }

    @Test
    fun retryEmitsTheRefreshDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = LinearSidebarViewModel(staticSource(), logger, backgroundScope)
            observe(vm)

            vm.retry()
            advanceUntilIdle()

            val refreshes = logger.records.filter { it.event == LinearSidebarDiagnostics.REFRESH_EVENT }
            assertEquals(1, refreshes.size)
            assertEquals("LinearSidebar", refreshes.first().fields["surface"])
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = LinearSidebarViewModel(staticSource(), logger, backgroundScope)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("LinearSidebar", opened.first().fields["surface"])
        }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private fun TestScope.observe(vm: LinearSidebarViewModel) {
        backgroundScope.launch { vm.uiModel.collect {} }
        advanceUntilIdle()
    }

    private fun TestScope.staticVm(activePath: String = "/energy"): LinearSidebarViewModel =
        LinearSidebarViewModel(
            source = staticSource(activePath),
            logger = RecordingLogger(),
            scope = backgroundScope,
        )

    private fun section(
        vm: LinearSidebarViewModel,
        title: String,
    ): LinearSectionRow =
        vm.uiModel.value.display.sections
            .single { it.title == title }

    private fun staticSource(activePath: String = "/energy"): LinearSidebarSource =
        staticLinearSidebarSource(nav(activePath), fetchedAt = 1L)

    private fun errorSource(): LinearSidebarSource =
        LinearSidebarSource {
            flowOf(Resource.Error(cached = null, fetchedAt = null, stale = false, error = RuntimeException("boom")))
        }

    private fun nav(activePath: String): LinearSidebarNav =
        LinearSidebarNav(
            sections =
                listOf(
                    LinearNavSection(
                        "Overview",
                        listOf(
                            LinearNavItem("/", "Dashboard", TeslaGlyphs.Octagon),
                            LinearNavItem("/vehicles", "Vehicles", TeslaGlyphs.Pin),
                        ),
                    ),
                    LinearNavSection(
                        "Energy",
                        listOf(
                            LinearNavItem("/energy", "Energy", TeslaGlyphs.Octagon),
                            LinearNavItem("/energy/battery", "Battery Health", TeslaGlyphs.Octagon),
                        ),
                    ),
                    LinearNavSection(
                        "Alerts",
                        listOf(LinearNavItem("/notifications/alerts", "Alerts", TeslaGlyphs.Warning)),
                    ),
                ),
            pinnedItems = listOf(LinearNavItem("/vehicles", "Vehicles", TeslaGlyphs.Pin)),
            activePath = activePath,
        )
}
