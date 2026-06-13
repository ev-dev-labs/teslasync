// Off-device unit tests for [ChartHiddenSeriesViewModel] over the real [SearchParamStore] (the URL analogue,
// exercising the cached-param -> projected-state adapter) and a controllable fake store (the
// :android:testReleaseUnitTest gate). They cover the all-visible initial state with no param, toggle
// persisting the canonical sorted param + re-projecting the state, a second toggle removing + dropping the
// param, reset clearing every flag, the URL-shared semantics (two holders on the same chartKey see each
// other's toggles — web two `useHiddenSeries('trend')` over one URL), per-chartKey isolation, the param
// binding holding for the holder's lifetime, write-through to the bound param name, and the PII-safe one-shot
// `view.opened` diagnostic. Mirrors web/src/components/charts/ChartHiddenSeriesContext.tsx over
// web/src/hooks/useHiddenSeries.ts. The framework-free model is covered by ChartHiddenSeriesContextModelTest.
//
// `InvalidPackageDeclaration` is suppressed: the test mirrors the surface's mandated package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charthiddenseriescontext

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChartHiddenSeriesContextViewModelTest {
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

    /** A fake param store whose backing flow the test fully controls (real adapter ↔ test fake). */
    private class FakeHiddenSeriesParamStore(
        initial: List<String> = emptyList(),
    ) : HiddenSeriesParamStore {
        val flow = MutableStateFlow(initial)
        var lastUpdateName: String? = null

        override fun param(name: String): StateFlow<List<String>> = flow.asStateFlow()

        override fun update(
            name: String,
            transform: (Set<String>) -> Set<String>,
        ) {
            lastUpdateName = name
            flow.value = serializeHiddenSeries(transform(parseHiddenSeries(flow.value)))
        }
    }

    @Test
    fun stateStartsAllVisibleWithNoParam() =
        runTest(UnconfinedTestDispatcher()) {
            val model = ChartHiddenSeriesViewModel(SearchParamStore(), "trend", RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals("trend", model.state.value.chartKey)
            assertEquals(emptySet<String>(), model.state.value.hidden)
            assertFalse(model.state.value.isHidden("projected"))
        }

    @Test
    fun togglePersistsCanonicalSortedParamAndUpdatesState() =
        runTest(UnconfinedTestDispatcher()) {
            val store = SearchParamStore()
            val model = ChartHiddenSeriesViewModel(store, "trend", RecordingLogger(), backgroundScope)

            model.toggle("projected")
            model.toggle("health")
            advanceUntilIdle()

            // Canonical sorted persistence (web `Array.from(next).sort()`) + re-projected state.
            assertEquals(listOf("health", "projected"), store.param("hidden_trend").value)
            assertEquals(setOf("health", "projected"), model.state.value.hidden)
            assertTrue(model.state.value.isHidden("health"))
        }

    @Test
    fun toggleTwiceRemovesAndDropsParam() =
        runTest(UnconfinedTestDispatcher()) {
            val store = SearchParamStore()
            val model = ChartHiddenSeriesViewModel(store, "trend", RecordingLogger(), backgroundScope)

            model.toggle("projected")
            model.toggle("projected")
            advanceUntilIdle()

            assertEquals(emptyList<String>(), store.param("hidden_trend").value)
            assertEquals(emptySet<String>(), model.state.value.hidden)
        }

    @Test
    fun resetClearsEveryHiddenFlag() =
        runTest(UnconfinedTestDispatcher()) {
            val store = SearchParamStore()
            val model = ChartHiddenSeriesViewModel(store, "trend", RecordingLogger(), backgroundScope)
            model.toggle("projected")
            model.toggle("health")
            advanceUntilIdle()

            model.reset()
            advanceUntilIdle()

            assertEquals(emptyList<String>(), store.param("hidden_trend").value)
            assertEquals(emptySet<String>(), model.state.value.hidden)
        }

    @Test
    fun sameChartKeySharesStateAcrossHolders() =
        runTest(UnconfinedTestDispatcher()) {
            // Two holders on one chartKey are two `useHiddenSeries('trend')` over the same URL — a toggle on
            // one is visible to the other through the shared param store.
            val store = SearchParamStore()
            val first = ChartHiddenSeriesViewModel(store, "trend", RecordingLogger(), backgroundScope)
            val second = ChartHiddenSeriesViewModel(store, "trend", RecordingLogger(), backgroundScope)

            first.toggle("projected")
            advanceUntilIdle()

            assertTrue(second.state.value.isHidden("projected"))
        }

    @Test
    fun differentChartKeysAreIsolated() =
        runTest(UnconfinedTestDispatcher()) {
            val store = SearchParamStore()
            val alpha = ChartHiddenSeriesViewModel(store, "alpha", RecordingLogger(), backgroundScope)
            val beta = ChartHiddenSeriesViewModel(store, "beta", RecordingLogger(), backgroundScope)

            alpha.toggle("projected")
            advanceUntilIdle()

            assertTrue(alpha.state.value.isHidden("projected"))
            assertFalse(beta.state.value.isHidden("projected"))
            assertEquals(listOf("projected"), store.param("hidden_alpha").value)
            assertEquals(emptyList<String>(), store.param("hidden_beta").value)
        }

    @Test
    fun stateFollowsBoundParamForItsLifetime() =
        runTest(UnconfinedTestDispatcher()) {
            val fake = FakeHiddenSeriesParamStore()
            val model = ChartHiddenSeriesViewModel(fake, "trend", RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertEquals(emptySet<String>(), model.state.value.hidden)

            // A later external change to the bound param re-projects the state (web `useSearchParams` re-read).
            fake.flow.value = listOf("health", "projected")
            advanceUntilIdle()
            assertEquals(setOf("health", "projected"), model.state.value.hidden)

            fake.flow.value = emptyList()
            advanceUntilIdle()
            assertEquals(emptySet<String>(), model.state.value.hidden)
        }

    @Test
    fun toggleAndResetWriteThroughTheBoundParamName() =
        runTest(UnconfinedTestDispatcher()) {
            val fake = FakeHiddenSeriesParamStore()
            val model = ChartHiddenSeriesViewModel(fake, "trend", RecordingLogger(), backgroundScope)

            model.toggle("projected")
            assertEquals("hidden_trend", fake.lastUpdateName)
            advanceUntilIdle()
            assertEquals(listOf("projected"), fake.flow.value)

            model.reset()
            advanceUntilIdle()
            assertEquals(emptyList<String>(), fake.flow.value)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = ChartHiddenSeriesViewModel(SearchParamStore(), "trend", logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals("ChartHiddenSeriesContext", opened.first().fields["surface"])
        }
}
