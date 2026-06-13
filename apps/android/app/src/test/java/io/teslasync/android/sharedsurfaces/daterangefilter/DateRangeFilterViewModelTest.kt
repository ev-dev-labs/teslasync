package io.teslasync.android.sharedsurfaces.daterangefilter

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.NoopLogger
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * Drives [DateRangeFilterViewModel] over a controllable fake [DateRangeFilterSource] (and the real
 * [DateRangeParamStore]) covering the URL-state read's lifecycle the surface renders — loading → content, the
 * unset → empty branch, the hard error, the stale/offline envelope — plus the edit methods routing through the
 * seam, retry re-reading, and the PII-safe `view.opened` / `dateRangeFilter.refresh` diagnostics (P1/S11 —
 * surface slug only). The view never performs HTTP; every read/write flows through the seam.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class DateRangeFilterViewModelTest {
    private val today = LocalDate.of(2026, 6, 13)

    @Test
    fun selectionSuccessExposesContent() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(DateRangeSelection("2026-06-07", "2026-06-13"))))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertTrue(vm.state.value.isContent)
            val selection = vm.state.value.data
            assertEquals("2026-06-07", selection?.start)
        }

    @Test
    fun firstReadWithNoCacheExposesLoading() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(Resource.Loading(cached = null, fetchedAt = null, stale = false)))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertTrue(vm.state.value.isLoading)
        }

    @Test
    fun unsetSelectionExposesEmpty() =
        runTest(UnconfinedTestDispatcher()) {
            val vm = viewModel(FakeSource(success(DateRangeSelection.EMPTY)))
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertTrue(vm.state.value.isEmpty)
        }

    @Test
    fun hardErrorWithNoCacheExposesError() =
        runTest(UnconfinedTestDispatcher()) {
            val vm =
                viewModel(
                    FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            assertTrue(vm.state.value.isError)
            assertEquals(ErrorKind.Network, vm.state.value.errorKind)
        }

    @Test
    fun cachedErrorProjectsOfflineSelection() =
        runTest(UnconfinedTestDispatcher()) {
            val cached = DateRangeSelection("2026-06-07", "2026-06-13")
            val vm =
                viewModel(
                    FakeSource(Resource.Error(cached = cached, fetchedAt = 5L, stale = true, error = ApiError.Timeout())),
                )
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()

            val display = DateRangeFilterProjection.project(vm.state.value, today)
            assertEquals("2026-06-07", display.start)
            assertTrue(display.offline)
        }

    @Test
    fun editsRouteThroughTheSeam() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(DateRangeSelection.EMPTY))
            val vm = viewModel(source)

            vm.onStartDateChange("2026-06-01")
            vm.onEndDateChange("2026-06-30")
            vm.onRangeChange("2026-01-01", "2026-12-31")
            vm.onPresetSelected("7d", today)

            assertEquals("2026-06-01", source.lastStart)
            assertEquals("2026-06-30", source.lastEnd)
            assertEquals("2026-06-07" to "2026-06-13", source.lastRange)
        }

    @Test
    fun unknownPresetIsNoOp() =
        runTest(UnconfinedTestDispatcher()) {
            val source = FakeSource(success(DateRangeSelection.EMPTY))
            val vm = viewModel(source)

            vm.onPresetSelected("not-a-preset", today)

            assertNull(source.lastRange)
        }

    @Test
    fun editsReflectInStateThroughTheRealStore() =
        runTest(UnconfinedTestDispatcher()) {
            val store = DateRangeParamStore(clock = { 1L })
            val vm = DateRangeFilterViewModel(store, NoopLogger, backgroundScope)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isEmpty)

            vm.onPresetSelected("mtd", today)
            advanceUntilIdle()

            assertTrue(vm.state.value.isContent)
            assertEquals(DateRangeSelection("2026-06-01", "2026-06-13"), vm.state.value.data)
        }

    @Test
    fun retryReReadsAndEmitsDiagnostic() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val source = FakeSource(Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()))
            val vm = viewModel(source, logger)
            backgroundScope.launch { vm.state.collect {} }
            advanceUntilIdle()
            assertTrue(vm.state.value.isError)
            val callsBefore = source.calls

            source.resource = success(DateRangeSelection("2026-06-07", "2026-06-13"))
            vm.retry()
            advanceUntilIdle()

            assertTrue(source.calls > callsBefore)
            assertTrue(source.refreshes > 0)
            assertTrue(vm.state.value.isContent)
            val refresh = logger.events.single { it.first == EVENT_REFRESH }
            assertEquals(mapOf(FIELD_SURFACE to DateRangeFilterRegistration.SLUG), refresh.second)
        }

    @Test
    fun viewOpenedEmitsSlugExactlyOnce() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val vm = viewModel(FakeSource(success(DateRangeSelection.EMPTY)), logger)

            vm.onViewOpened()
            vm.onViewOpened()

            val opened = logger.events.filter { it.first == EVENT_VIEW_OPENED }
            assertEquals(1, opened.size)
            assertEquals(mapOf(FIELD_SURFACE to DateRangeFilterRegistration.SLUG), opened.single().second)
        }

    private class FakeSource(
        var resource: Resource<DateRangeSelection>,
    ) : DateRangeFilterSource {
        var calls: Int = 0
        var refreshes: Int = 0
        var lastStart: String? = null
        var lastEnd: String? = null
        var lastRange: Pair<String, String>? = null

        override fun range(): Flow<Resource<DateRangeSelection>> =
            flow {
                calls++
                emit(resource)
            }

        override fun setStart(start: String) {
            lastStart = start
        }

        override fun setEnd(end: String) {
            lastEnd = end
        }

        override fun setRange(
            start: String,
            end: String,
        ) {
            lastRange = start to end
        }

        override fun refresh() {
            refreshes++
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

    private fun TestScope.viewModel(
        source: DateRangeFilterSource,
        logger: Logger = NoopLogger,
    ): DateRangeFilterViewModel = DateRangeFilterViewModel(source, logger, backgroundScope)

    private companion object {
        fun success(selection: DateRangeSelection): Resource<DateRangeSelection> =
            Resource.Success(selection, fetchedAt = 1L, stale = false)
    }
}
