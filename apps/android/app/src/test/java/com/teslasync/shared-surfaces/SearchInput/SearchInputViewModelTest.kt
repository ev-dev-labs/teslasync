// Off-device unit tests for [SearchInputViewModel] over the real shared [InMemorySearchHistoryStore] adapter
// (the :android:testReleaseUnitTest gate). They cover the empty initial state, binding a recorded search,
// the minimum-length guard, per-entry removal + clear-all, the case-insensitive newest-first de-duplication
// the dropdown relies on, and the PII-safe one-shot `view.opened` diagnostic. Mirrors the web SearchInput's
// `historyScope` binding (web/src/components/forms/SearchInput.tsx); the framework-free model is covered by
// SearchInputModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.searchinput

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SearchInputViewModelTest {
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
    fun startsEmptyThenBindsRecordedSearch() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemorySearchHistoryStore(clock = { 1L })
            val model = SearchInputViewModel(store.source("drives"), RecordingLogger(), backgroundScope)
            model.state.launchIn(backgroundScope)
            advanceUntilIdle()
            assertEquals(emptyList<String>(), model.state.value.data)

            model.record("supercharger")
            advanceUntilIdle()
            assertEquals(listOf("supercharger"), model.state.value.data)
        }

    @Test
    fun recordIgnoresBelowMinimumNoise() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemorySearchHistoryStore(clock = { 1L })
            val model = SearchInputViewModel(store.source("drives"), RecordingLogger(), backgroundScope)
            model.state.launchIn(backgroundScope)
            advanceUntilIdle()

            model.record("x")
            advanceUntilIdle()
            assertEquals(emptyList<String>(), model.state.value.data)
        }

    @Test
    fun removeAndClearAllPruneTheBoundScope() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemorySearchHistoryStore(clock = { 1L })
            val model = SearchInputViewModel(store.source("drives"), RecordingLogger(), backgroundScope)
            model.state.launchIn(backgroundScope)
            advanceUntilIdle()

            model.record("alpha")
            model.record("beta")
            advanceUntilIdle()
            assertEquals(listOf("beta", "alpha"), model.state.value.data)

            model.remove("ALPHA")
            advanceUntilIdle()
            assertEquals(listOf("beta"), model.state.value.data)

            model.clearAll()
            advanceUntilIdle()
            assertEquals(emptyList<String>(), model.state.value.data)
        }

    @Test
    fun reRecordMovesEntryToTheTop() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemorySearchHistoryStore(clock = { 1L })
            val model = SearchInputViewModel(store.source("drives"), RecordingLogger(), backgroundScope)
            model.state.launchIn(backgroundScope)
            advanceUntilIdle()

            model.record("alpha")
            model.record("beta")
            model.record("alpha")
            advanceUntilIdle()
            assertEquals(listOf("alpha", "beta"), model.state.value.data)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val store = InMemorySearchHistoryStore()
            val model = SearchInputViewModel(store.source("drives"), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals("SearchInput", opened.first().fields["surface"])
        }
}
