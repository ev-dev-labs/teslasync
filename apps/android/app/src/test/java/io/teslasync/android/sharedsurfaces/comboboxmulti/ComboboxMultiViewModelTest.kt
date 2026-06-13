package io.teslasync.android.sharedsurfaces.comboboxmulti

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drives [ComboboxMultiViewModel] over a controllable fake [ComboboxMultiOptionsSource], covering the options
 * feed's cache-then-network lifecycle the dropdown renders — the closed-and-empty short-circuit, loading →
 * content, the empty result, the hard error — plus retry re-fetching, the query → load binding, the wrap-around
 * keyboard interaction state, the PII-safe `view.opened` / `comboboxMulti.refresh` diagnostics (P1/S11 — surface
 * slug only), and the static/async source adapters. The view never performs HTTP; every read flows through the
 * fake source. Run by the :android:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ComboboxMultiViewModelTest {
    @Test
    fun closedEmptyQueryEmitsEmptyWithoutLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)
            backgroundScope.launch { vm.options.collect {} }
            advanceUntilIdle()

            assertTrue(vm.options.value.isEmpty)
            assertEquals(0, source.calls)
        }

    @Test
    fun openExposesContent() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(listOf(opt("a", "Alpha"))))
            val vm = viewModel(source)
            backgroundScope.launch { vm.options.collect {} }
            vm.openDropdown()
            advanceUntilIdle()

            assertTrue(vm.options.value.isContent)
            assertTrue(vm.options.value.hasData)
            assertTrue(source.calls >= 1)
        }

    @Test
    fun emptyResultExposesEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(emptyList())))
            backgroundScope.launch { vm.options.collect {} }
            vm.openDropdown()
            advanceUntilIdle()

            assertTrue(vm.options.value.isEmpty)
        }

    @Test
    fun loaderErrorExposesError() =
        runTest(UnconfinedTestDispatcher()) {
            val source =
                FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
            val vm = viewModel(source)
            backgroundScope.launch { vm.options.collect {} }
            vm.openDropdown()
            advanceUntilIdle()

            assertTrue(vm.options.value.isError)
            assertEquals(ErrorKind.Network, vm.options.value.errorKind)
        }

    @Test
    fun retryReFetchesAndEmitsDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source =
                FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
            val vm = viewModel(source, logger)
            backgroundScope.launch { vm.options.collect {} }
            vm.openDropdown()
            advanceUntilIdle()
            assertTrue(vm.options.value.isError)
            val callsBefore = source.calls

            source.resource = success(listOf(opt("a", "Alpha")))
            vm.retry()
            advanceUntilIdle()

            assertTrue(source.calls > callsBefore)
            assertTrue(vm.options.value.isContent)
            val refresh = logger.events.single { it.first == "comboboxMulti.refresh" }
            assertEquals(mapOf("surface" to "ComboboxMulti"), refresh.second)
        }

    @Test
    fun setQueryUpdatesInteractionAndDrivesLoad() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(emptyList()))
            val vm = viewModel(source)
            backgroundScope.launch { vm.options.collect {} }
            vm.setQuery("foo")
            advanceUntilIdle()

            assertEquals("foo", vm.interaction.value.query)
            assertTrue(vm.interaction.value.open)
            assertEquals("foo", source.lastQuery)
        }

    @Test
    fun moveActiveDownWrapsInteraction() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(emptyList())))

            vm.moveActiveDown(3)
            assertEquals(0, vm.interaction.value.activeIndex)
            vm.moveActiveDown(3)
            assertEquals(1, vm.interaction.value.activeIndex)
            vm.setActiveIndex(2)
            vm.moveActiveDown(3)
            assertEquals(0, vm.interaction.value.activeIndex)
            assertTrue(vm.interaction.value.open)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(emptyList())), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(mapOf("surface" to "ComboboxMulti"), opened.single().second)
        }

    @Test
    fun staticSourceEmitsSuccess() =
        runTest {
            val options = listOf(opt("a", "Alpha"))
            val emissions = staticComboboxOptions(options).load("x").toList()

            assertEquals(1, emissions.size)
            val resource = emissions.single()
            assertTrue(resource is Resource.Success)
            assertEquals(options, (resource as Resource.Success).data)
        }

    @Test
    fun asyncSourceEmitsLoadingThenSuccess() =
        runTest {
            val options = listOf(opt("a", "Alpha"))
            val emissions = asyncComboboxOptions { options }.load("q").toList()

            assertEquals(2, emissions.size)
            assertTrue(emissions[0] is Resource.Loading)
            assertTrue(emissions[1] is Resource.Success)
            assertEquals(options, (emissions[1] as Resource.Success).data)
        }

    @Test
    fun asyncSourceEmitsErrorOnFailure() =
        runTest {
            val source = asyncComboboxOptions { throw ApiError.Network() }
            val emissions = source.load("q").toList()

            assertEquals(2, emissions.size)
            assertTrue(emissions[0] is Resource.Loading)
            assertTrue(emissions[1] is Resource.Error)
            assertFalse((emissions[1] as Resource.Error).stale)
        }

    private fun opt(
        key: String,
        label: String = key,
    ): ComboboxMultiOption = ComboboxMultiOption(key = key, label = label)

    private fun success(options: List<ComboboxMultiOption>) = Resource.Success(options, fetchedAt = 1L, stale = false)

    private fun TestScope.viewModel(
        source: ComboboxMultiOptionsSource,
        logger: Logger = NoopLogger,
    ): ComboboxMultiViewModel = ComboboxMultiViewModel(source, logger, debounceMs = 0L, scope = backgroundScope)

    private class FakeSource(
        var resource: Resource<List<ComboboxMultiOption>>,
    ) : ComboboxMultiOptionsSource {
        var calls: Int = 0
        var lastQuery: String? = null

        override fun load(query: String): Flow<Resource<List<ComboboxMultiOption>>> {
            calls++
            lastQuery = query
            return flow { emit(resource) }
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
}
