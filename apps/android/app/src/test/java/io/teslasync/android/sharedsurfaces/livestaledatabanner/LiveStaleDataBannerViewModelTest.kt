// Tests [LiveStaleDataBannerViewModel] against the live wire-health seam — covering the contract the view depends
// on: each status emission folds onto the PII-free [StaleBannerState] the banner renders (stamping the
// disconnection clock from the injected clock, clearing it on recovery), the initial value is the cold-start
// hidden seed, and the one-shot `view.opened` fires exactly once with the surface slug (never a vehicle id). The
// framework-free fold/render is covered by LiveStaleDataBannerProjectionTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livestaledatabanner

import io.teslasync.android.components.datadisplay.LiveConnectionStatus
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
class LiveStaleDataBannerViewModelTest {
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

    private val stamp = 1_700_000_000_000L

    @Test
    fun stateSeedsAsAHiddenColdStartBeforeAnyEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val src = liveStaleDataBannerSource { flowOf(LiveConnectionStatus.Disconnected) }
            val model = LiveStaleDataBannerViewModel(src, RecordingLogger(), clock = { stamp }, scope = backgroundScope)
            // No collector yet → the lifecycle-aware StateFlow exposes its cold-start seed.
            assertEquals(LiveConnectionStatus.Unknown, model.state.value.status)
            assertNull(model.state.value.disconnectedSinceMillis)
        }

    @Test
    fun stateStampsTheDisconnectionClockFromTheInjectedClock() =
        runTest(UnconfinedTestDispatcher()) {
            val src = liveStaleDataBannerSource { flowOf(LiveConnectionStatus.Disconnected) }
            val model = LiveStaleDataBannerViewModel(src, RecordingLogger(), clock = { stamp }, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertEquals(LiveConnectionStatus.Disconnected, model.state.value.status)
            assertEquals(stamp, model.state.value.disconnectedSinceMillis)
        }

    @Test
    fun stateLeavesTheClockClearWhileTheWireIsHealthy() =
        runTest(UnconfinedTestDispatcher()) {
            val src = liveStaleDataBannerSource { flowOf(LiveConnectionStatus.Connected) }
            val model = LiveStaleDataBannerViewModel(src, RecordingLogger(), clock = { stamp }, scope = backgroundScope)
            backgroundScope.launch { model.state.collect {} }
            advanceUntilIdle()

            assertEquals(LiveConnectionStatus.Connected, model.state.value.status)
            assertNull(model.state.value.disconnectedSinceMillis)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = liveStaleDataBannerSource { flowOf(LiveConnectionStatus.Unknown) }
            val model = LiveStaleDataBannerViewModel(src, logger, clock = { stamp }, scope = backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("LiveStaleDataBanner", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
