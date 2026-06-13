// Tests [KpiOverviewCardViewModel] against the real [staticKpiOverviewCardSource] / a live flow seam — covering
// the holder folding a streamed overview into state, the content-free EMPTY default before the seam emits, a
// live re-emission updating the grid in place, and the one-shot, PII-safe `view.opened` diagnostic (slug only).
// The framework-free model is covered by KpiOverviewCardModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.kpioverviewcard

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class KpiOverviewCardViewModelTest {
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

    private val overview =
        KpiOverviewData(
            header = KpiHeaderModel("Overview", "Last 30 days", "vs prior 30 days"),
            tiles = listOf(KpiTile("Drives", "42"), KpiTile("Distance", "1,204")),
            secondary = "Top speed 152 mph",
        )

    @Test
    fun streamedOverviewFoldsIntoState() =
        runTest(UnconfinedTestDispatcher()) {
            val model =
                KpiOverviewCardViewModel(staticKpiOverviewCardSource(overview), RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals(overview, model.state.value)
        }

    @Test
    fun stateIsTheEmptyZeroValueBeforeTheSeamEmits() =
        runTest(UnconfinedTestDispatcher()) {
            val model =
                KpiOverviewCardViewModel(KpiOverviewCardSource { emptyFlow() }, RecordingLogger(), backgroundScope)
            advanceUntilIdle()

            assertEquals(KpiOverviewData.EMPTY, model.state.value)
        }

    @Test
    fun liveReEmissionUpdatesStateInPlace() =
        runTest(UnconfinedTestDispatcher()) {
            val feed = MutableStateFlow(KpiOverviewData.EMPTY)
            val model = KpiOverviewCardViewModel(KpiOverviewCardSource { feed }, RecordingLogger(), backgroundScope)
            advanceUntilIdle()
            assertEquals(KpiOverviewData.EMPTY, model.state.value)

            feed.value = overview
            advanceUntilIdle()
            assertEquals(overview, model.state.value)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = KpiOverviewCardViewModel(staticKpiOverviewCardSource(overview), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("KpiOverviewCard", opened.first().fields["surface"])
        }
}
