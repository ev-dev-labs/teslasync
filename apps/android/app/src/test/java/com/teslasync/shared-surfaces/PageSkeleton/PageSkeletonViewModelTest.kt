// Drives [PageSkeletonViewModel] over a recording logger, covering the surface's single state-holder
// responsibility: the PII-safe one-shot `view.opened` diagnostic (P1/S11 — surface slug only, never a
// caller value), emitted at most once per holder however many times the composable's first-composition
// effect runs. The surface has no data feed (see PageSkeletonModel.kt), so there is no cache-then-network
// lifecycle to drive here. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pageskeleton

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PageSkeletonViewModelTest {
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
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = PageSkeletonViewModel(logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals(LogLevel.Info, opened.first().level)
            assertEquals(mapOf("surface" to "PageSkeleton"), opened.first().fields)
        }

    @Test
    fun freshHolderEmitsNothingUntilOpened() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            PageSkeletonViewModel(logger, backgroundScope)

            // Constructing the holder must not emit — the diagnostic fires on first composition, not on bind.
            assertEquals(emptyList<LogRecord>(), logger.records)
        }
}
