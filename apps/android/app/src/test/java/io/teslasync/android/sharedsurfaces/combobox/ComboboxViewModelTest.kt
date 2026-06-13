package io.teslasync.android.sharedsurfaces.combobox

import io.teslasync.android.components.forms.ComboOption
import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ComboboxViewModel] over a controllable fake [ComboboxSource], covering the full lifecycle the web
 * component + the bound option feed render: a first load → loading, resolved options → results, typing
 * opening the listbox + raising the query, picking an option (selection set, query cleared, listbox closed),
 * clearing (selection dropped, listbox re-opened), the active-descendant keyboard movement, retry
 * re-collecting the feed, and the PII-safe `view.opened` + `combobox.refresh` diagnostics — end to end
 * through the real `toUiState` projection. The VM's `uiModel` is a `WhileSubscribed` feed, so each case keeps
 * an active collector alive on the background scope. The debounce is set to zero so virtual time settles
 * immediately.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ComboboxViewModelTest {
    private class FakeSource(
        initial: Resource<List<ComboOption>>,
    ) : ComboboxSource {
        val flow = MutableStateFlow(initial)
        var calls: Int = 0

        override fun options(query: String): Flow<Resource<List<ComboOption>>> {
            calls++
            return flow
        }
    }

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

    @Test
    fun loadingResolvesToResultsWhenOptionsArrive() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false))
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            assertEquals(ComboboxPhase.Loading, vm.uiModel.value.display.phase)

            source.flow.value = Resource.Success(OPTIONS, fetchedAt = STAMP, stale = false)
            advanceUntilIdle()

            assertEquals(ComboboxPhase.Results, vm.uiModel.value.display.phase)
            assertEquals(OPTIONS.size, vm.uiModel.value.display.totalCount)
        }

    @Test
    fun typingOpensTheListboxAndRaisesTheQuery() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(successSource())
            observe(vm)
            advanceUntilIdle()

            vm.onQueryChange("mod")
            advanceUntilIdle()

            assertEquals("mod", vm.uiModel.value.query)
            assertTrue(vm.uiModel.value.expanded)
        }

    @Test
    fun selectingStoresSelectionClearsQueryAndCloses() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(successSource())
            observe(vm)
            advanceUntilIdle()

            vm.select(OPTIONS[1])
            advanceUntilIdle()

            assertEquals(OPTIONS[1], vm.selected.value)
            assertEquals("y", vm.uiModel.value.selectedValue)
            assertEquals("", vm.uiModel.value.query)
            assertFalse(vm.uiModel.value.expanded)
        }

    @Test
    fun clearingDropsSelectionAndReopens() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(successSource())
            observe(vm)
            advanceUntilIdle()
            vm.select(OPTIONS[1])
            advanceUntilIdle()

            vm.clear()
            advanceUntilIdle()

            assertNull(vm.selected.value)
            assertNull(vm.uiModel.value.selectedValue)
            assertTrue(vm.uiModel.value.expanded)
        }

    @Test
    fun keyboardMovementWalksAndClampsTheActiveDescendant() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(successSource())
            observe(vm)
            advanceUntilIdle()
            vm.setExpanded(true)
            advanceUntilIdle()
            assertEquals(0, vm.uiModel.value.activeIndex)

            vm.moveActiveDown()
            advanceUntilIdle()
            assertEquals(1, vm.uiModel.value.activeIndex)

            vm.moveActiveDown()
            advanceUntilIdle()
            assertEquals(OPTIONS.lastIndex, vm.uiModel.value.activeIndex)

            vm.moveActiveDown()
            advanceUntilIdle()
            assertEquals(OPTIONS.lastIndex, vm.uiModel.value.activeIndex)

            vm.moveActiveUp()
            advanceUntilIdle()
            assertEquals(OPTIONS.lastIndex - 1, vm.uiModel.value.activeIndex)
        }

    @Test
    fun commitActiveSelectsTheHighlightedOption() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(successSource())
            observe(vm)
            advanceUntilIdle()
            vm.setExpanded(true)
            vm.moveActiveDown()
            advanceUntilIdle()

            vm.commitActive()
            advanceUntilIdle()

            assertEquals(OPTIONS[1], vm.selected.value)
        }

    @Test
    fun retryReCollectsTheSource() =
        runTest(UnconfinedTestDispatcher()) {
            val source = successSource()
            val vm = viewModel(source)
            observe(vm)
            advanceUntilIdle()
            val before = source.calls

            vm.retry()
            advanceUntilIdle()

            assertTrue("expected the source to be re-collected", source.calls > before)
        }

    @Test
    fun retryEmitsRefreshDiagnosticWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(successSource(), logger)
            observe(vm)
            advanceUntilIdle()

            vm.retry()
            advanceUntilIdle()

            val refresh = logger.events.single { it.first == "combobox.refresh" }
            assertEquals(mapOf("surface" to "Combobox"), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(successSource(), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "Combobox"), opened.single().second)
        }

    private fun successSource(): FakeSource = FakeSource(Resource.Success(OPTIONS, fetchedAt = STAMP, stale = false))

    private fun TestScope.viewModel(
        source: ComboboxSource,
        logger: Logger = NoopLogger,
    ): ComboboxViewModel = ComboboxViewModel(source, logger, backgroundScope, debounceMillis = 0)

    private fun TestScope.observe(vm: ComboboxViewModel) {
        backgroundScope.launch { vm.uiModel.collect {} }
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L

        val OPTIONS =
            listOf(
                ComboOption(value = "3", label = "Model 3"),
                ComboOption(value = "y", label = "Model Y"),
                ComboOption(value = "x", label = "Model X"),
            )
    }
}
