// Tests [TabsViewModel] against the [TabsIdSource] seam — covering the state-holder binding the P3 contract
// mandates: the stable tablist id minted once from the bound `useId` source (web `useId`), its stability
// across reads, and the one-shot PII-safe `view.opened` diagnostic (slug only, no tab key/label). A scope is
// injected so the base holder never touches the Main dispatcher. The framework-free model + id seam are
// covered by TabsModelTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.tabs

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TabsViewModelTest {
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
    fun tablistIdComesFromTheBoundSource() =
        runTest(UnconfinedTestDispatcher()) {
            val model = TabsViewModel(StaticTabsIdSource("bound-id"), RecordingLogger(), backgroundScope)
            assertEquals("bound-id", model.tablistId)
        }

    @Test
    fun tablistIdIsStableAcrossReads() =
        runTest(UnconfinedTestDispatcher()) {
            val model = TabsViewModel(ProcessTabsIdSource(), RecordingLogger(), backgroundScope)
            assertEquals(model.tablistId, model.tablistId)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = TabsViewModel(StaticTabsIdSource(), logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("Tabs", opened.first().fields["surface"])
        }
}
