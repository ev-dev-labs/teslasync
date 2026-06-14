// Tests [StickyChipBarViewModel] — the state-holder binding the P3 contract mandates (P1/S8). Covers the
// active-id reducer the web `StickyChipBar` drives: the empty initial state, the seed + re-derivation as the
// chip set changes (web `useState(chips[0]?.id ?? '')`), the click selection (web `handleClick` `setActiveId`),
// the scroll-driven top-most-visible highlight (web `IntersectionObserver` callback, including the no-op when
// nothing is visible), and the one-shot PII-safe `view.opened` diagnostic (slug only). A scope is injected so
// the base holder never touches the Main dispatcher. The framework-free model is covered by
// StickyChipBarModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickychipbar

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class StickyChipBarViewModelTest {
    private val chips =
        listOf(
            ChipItem(id = "a", label = "A"),
            ChipItem(id = "b", label = "B"),
            ChipItem(id = "c", label = "C"),
        )

    @Test
    fun activeIdStartsEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            assertEquals("", viewModel().activeId.value)
        }

    @Test
    fun syncChipsSeedsTheFirstChip() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.syncChips(chips)
            assertEquals("a", vm.activeId.value)
        }

    @Test
    fun syncChipsKeepsAValidSelectionButDropsAStaleOne() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.selectChip("b")
            vm.syncChips(chips)
            assertEquals("b", vm.activeId.value)

            vm.syncChips(listOf(ChipItem(id = "c", label = "C")))
            assertEquals("c", vm.activeId.value)
        }

    @Test
    fun selectChipMarksItActive() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.selectChip("c")
            assertEquals("c", vm.activeId.value)
        }

    @Test
    fun onSectionsVisibleHighlightsTheTopMostSection() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.syncChips(chips)
            vm.onSectionsVisible(visibleIds = listOf("c", "b"), order = chips.map { it.id })
            assertEquals("b", vm.activeId.value)
        }

    @Test
    fun onSectionsVisibleLeavesTheActiveIdUnchangedWhenNothingIsVisible() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel()
            vm.selectChip("b")
            vm.onSectionsVisible(visibleIds = emptyList(), order = chips.map { it.id })
            assertEquals("b", vm.activeId.value)
        }

    @Test
    fun onViewOpenedEmitsTheSlugDiagnosticExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(logger = logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("StickyChipBar", opened.single().fields["surface"])
        }

    private fun TestScope.viewModel(logger: Logger = RecordingLogger()): StickyChipBarViewModel =
        StickyChipBarViewModel(logger, scope = backgroundScope)
}
