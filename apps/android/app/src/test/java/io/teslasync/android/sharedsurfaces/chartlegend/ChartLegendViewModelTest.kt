// Tests [ChartLegendViewModel] against the real [InMemoryChartHiddenSeriesStore] seam — covering the
// states the legend renders and the contract the view depends on: a toggle hides then shows a series
// through the shared store, the re-shared `hidden` flow reflects the store while observed, toggles are
// keyed per chart so two charts stay independent, reset clears a chart, the PII-safe toggle diagnostic
// carries the slug only (never the series key), and the one-shot `view.opened` fires exactly once. The
// framework-free model is covered by ChartLegendProjectionTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.chartlegend

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChartLegendViewModelTest {
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

    private val chart = "drive-overview"

    @Test
    fun toggleHidesThenShowsThroughTheStore() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemoryChartHiddenSeriesStore()
            val model = ChartLegendViewModel(chart, store, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.hidden.collect {} } // keep WhileSubscribed active
            advanceUntilIdle()

            model.toggle("speed")
            advanceUntilIdle()
            assertEquals(setOf("speed"), model.hidden.value)
            assertEquals("the store is the source of truth", setOf("speed"), store.hidden(chart).value)

            model.toggle("speed")
            advanceUntilIdle()
            assertEquals(emptySet<String>(), model.hidden.value)
        }

    @Test
    fun togglesAreKeyedPerChartSoChartsStayIndependent() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemoryChartHiddenSeriesStore()
            val overview = ChartLegendViewModel("drive-overview", store, RecordingLogger(), backgroundScope)
            val battery = ChartLegendViewModel("battery-trend", store, RecordingLogger(), backgroundScope)
            backgroundScope.launch { overview.hidden.collect {} }
            backgroundScope.launch { battery.hidden.collect {} }
            advanceUntilIdle()

            overview.toggle("speed")
            advanceUntilIdle()

            assertEquals(setOf("speed"), overview.hidden.value)
            assertEquals("a sibling chart is untouched", emptySet<String>(), battery.hidden.value)
        }

    @Test
    fun resetClearsEveryHiddenSeriesForTheChart() =
        runTest(UnconfinedTestDispatcher()) {
            val store = InMemoryChartHiddenSeriesStore()
            val model = ChartLegendViewModel(chart, store, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.hidden.collect {} }
            advanceUntilIdle()

            model.toggle("speed")
            model.toggle("power")
            advanceUntilIdle()
            assertEquals(setOf("speed", "power"), model.hidden.value)

            model.reset()
            advanceUntilIdle()
            assertEquals(emptySet<String>(), model.hidden.value)
        }

    @Test
    fun toggleLogsPiiSafeDiagnosticWithoutSeriesKey() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = ChartLegendViewModel(chart, store = InMemoryChartHiddenSeriesStore(), logger = logger, scope = backgroundScope)

            model.toggle("vin-5YJ-secret-series")
            advanceUntilIdle()

            val record = logger.records.single { it.event == "chartLegend.toggle" }
            assertEquals(mapOf("surface" to "ChartLegend"), record.fields)
            // The toggled series key never reaches a diagnostics field.
            assertTrue(record.fields.values.none { it.contains("vin") || it.contains("5YJ") })
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = ChartLegendViewModel(chart, store = InMemoryChartHiddenSeriesStore(), logger = logger, scope = backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ChartLegend", opened.first().fields["surface"])
        }
}
