// Tests [TimeMachineBannerViewModel] against the as-of seam — covering the contract the view depends on: each
// emission re-shares onto the PII-free [TimeMachineBannerSnapshot] the surface renders, the initial value is the
// live-mode seed (never a premature historical banner), [TimeMachineBannerViewModel.setAsOf] /
// [TimeMachineBannerViewModel.returnToLive] forward to the source and log slug-only events, and the one-shot
// `view.opened` fires exactly once with the surface slug (never an as-of value or vehicle id). The framework-free
// model is covered by TimeMachineBannerProjectionTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timemachinebanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TimeMachineBannerViewModelTest {
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

    private val sampleIso = "2024-11-12T14:30:00Z"

    @Test
    fun snapshotSeedsAsLiveBeforeAnyEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val src = timeMachineBannerSource { flowOf(TimeMachineBannerSnapshot(sampleIso)) }
            val model = TimeMachineBannerViewModel(src, RecordingLogger(), backgroundScope)
            // No collector yet → the lifecycle-aware StateFlow exposes its live-mode seed.
            assertNull("the first frame is live mode, never a premature historical banner", model.snapshot.value.asOf)
        }

    @Test
    fun snapshotReflectsAnAnchorEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val src = timeMachineBannerSource { flowOf(TimeMachineBannerSnapshot(sampleIso)) }
            val model = TimeMachineBannerViewModel(src, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            assertEquals(sampleIso, model.snapshot.value.asOf)
        }

    @Test
    fun setAsOfForwardsToSourceAndLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            var written: String? = null
            val logger = RecordingLogger()
            val src = timeMachineBannerSource(onSetAsOf = { written = it }) { flowOf(TimeMachineBannerSnapshot.live()) }
            val model = TimeMachineBannerViewModel(src, logger, backgroundScope)

            model.setAsOf(sampleIso)

            assertEquals("setAsOf forwards to the holder", sampleIso, written)
            val event = logger.records.single { it.event == "timeMachine.setAsOf" }
            assertEquals("the write event carries only the surface slug", mapOf("surface" to "TimeMachineBanner"), event.fields)
        }

    @Test
    fun returnToLiveForwardsClearAndLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            var cleared = 0
            val logger = RecordingLogger()
            val src = timeMachineBannerSource(onClear = { cleared++ }) { flowOf(TimeMachineBannerSnapshot.live()) }
            val model = TimeMachineBannerViewModel(src, logger, backgroundScope)

            model.returnToLive()

            assertEquals("returnToLive forwards clear to the holder", 1, cleared)
            val event = logger.records.single { it.event == "timeMachine.returnToLive" }
            assertEquals(mapOf("surface" to "TimeMachineBanner"), event.fields)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = timeMachineBannerSource { flowOf(TimeMachineBannerSnapshot.live()) }
            val model = TimeMachineBannerViewModel(src, logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("TimeMachineBanner", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
