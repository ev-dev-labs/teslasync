// Off-device unit tests for [ActiveFilterChipsViewModel] over controllable fakes (the :android:testReleaseUnitTest
// gate). They cover the overflow-popover reducer the web `overflowOpen` state drives (toggle + explicit set), the
// collapse-on-empty effect (web `if (filters.length === 0 && overflowOpen) setOverflowOpen(false)`), the announcer
// delegation the web `announceRemoval` / clear-all branch performs, and the PII-safe `view.opened` diagnostic
// emitted at most once.
//
// `InvalidPackageDeclaration` is not needed here — the test lives in the surface's real package directory.
package io.teslasync.android.sharedsurfaces.activefilterchips

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ActiveFilterChipsViewModelTest {
    // ── overflow reducer (web overflowOpen state) ───────────────────────────────────────────────────────────────
    @Test
    fun overflowStartsClosedAndToggles() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            assertFalse(vm.overflowOpen.value)

            vm.toggleOverflow()
            assertTrue(vm.overflowOpen.value)

            vm.toggleOverflow()
            assertFalse(vm.overflowOpen.value)
        }

    @Test
    fun setOverflowOpenSetsTheFlagExplicitly() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.setOverflowOpen(true)
            assertTrue(vm.overflowOpen.value)

            vm.setOverflowOpen(false)
            assertFalse(vm.overflowOpen.value)
        }

    // ── collapse-on-empty (web effect lines 103-105) ────────────────────────────────────────────────────────────
    @Test
    fun syncFilterCountClosesTheOverflowWhenFiltersEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.setOverflowOpen(true)

            vm.syncFilterCount(0)
            assertFalse(vm.overflowOpen.value)
        }

    @Test
    fun syncFilterCountLeavesTheOverflowOpenWhenFiltersRemain() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.setOverflowOpen(true)

            vm.syncFilterCount(3)
            assertTrue(vm.overflowOpen.value)
        }

    // ── announcer delegation (web announceRemoval / clear-all) ──────────────────────────────────────────────────
    @Test
    fun announceForwardsTheMessageToTheAnnouncer() =
        runTest(UnconfinedTestDispatcher()) {
            val announcer = FakeFilterAnnouncer()
            val vm = viewModel(announcer = announcer)

            vm.announce("Filter removed: Vehicle")

            assertEquals(listOf("Filter removed: Vehicle"), announcer.messages)
            assertEquals("Filter removed: Vehicle", vm.announcement.value)
        }

    // ── diagnostics (P1/S11) ────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun onViewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("slug" to "ActiveFilterChips"), opened.single().second)
        }

    // ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
    private fun TestScope.viewModel(
        announcer: FilterAnnouncer = FakeFilterAnnouncer(),
        logger: Logger = RecordingLogger(),
    ): ActiveFilterChipsViewModel = ActiveFilterChipsViewModel(announcer, logger, scope = backgroundScope)
}
