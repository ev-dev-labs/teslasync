// Tests [TooltipViewModel] against the [TooltipIdSource] seam — covering the state-holder binding the P3
// contract mandates: the stable tooltip id minted once from the bound `useId` source (web `useId`), its
// stability across reads, and the one-shot PII-safe `view.opened` diagnostic (slug only, no content/label). A
// scope is injected so the base holder never touches the Main dispatcher. The framework-free model + id seam
// are covered by TooltipModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tooltip

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TooltipViewModelTest {
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
    fun tooltipIdComesFromTheBoundSource() =
        runTest(UnconfinedTestDispatcher()) {
            val model = TooltipViewModel(StaticTooltipIdSource("bound-id"), RecordingLogger(), backgroundScope)
            assertEquals("bound-id", model.tooltipId)
        }

    @Test
    fun tooltipIdIsStableAcrossReads() =
        runTest(UnconfinedTestDispatcher()) {
            val model = TooltipViewModel(ProcessTooltipIdSource(), RecordingLogger(), backgroundScope)
            assertEquals(model.tooltipId, model.tooltipId)
        }

    @Test
    fun processSourceMintsDistinctIdsAcrossInstances() =
        runTest(UnconfinedTestDispatcher()) {
            val source = ProcessTooltipIdSource()
            val first = TooltipViewModel(source, RecordingLogger(), backgroundScope)
            val second = TooltipViewModel(source, RecordingLogger(), backgroundScope)
            // Web `useId` tree-wide uniqueness — two tooltips never share an id.
            assertEquals(false, first.tooltipId == second.tooltipId)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = TooltipViewModel(StaticTooltipIdSource(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("Tooltip", opened.first().fields["surface"])
        }
}
