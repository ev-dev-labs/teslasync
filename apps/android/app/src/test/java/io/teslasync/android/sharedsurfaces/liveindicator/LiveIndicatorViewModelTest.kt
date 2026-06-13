// Tests [LiveIndicatorViewModel] against the live wire-health seam — covering the contract the view depends
// on: each emission re-shares onto the PII-free [LiveConnectionSnapshot] the chip renders, the initial value
// is the cold-start `unknown` seed, and the one-shot `view.opened` fires exactly once with the surface slug
// (never a vehicle id). The framework-free projection is covered by LiveIndicatorProjectionTest. Runs in
// :app:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.liveindicator

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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LiveIndicatorViewModelTest {
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
    fun snapshotSeedsAsUnknownBeforeAnyEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val src = liveIndicatorSource { flowOf(LiveConnectionSnapshot(LiveConnectionStatus.Connected, stamp, false)) }
            val model = LiveIndicatorViewModel(src, RecordingLogger(), backgroundScope)
            // No collector yet → the lifecycle-aware StateFlow exposes its cold-start seed.
            assertEquals(LiveConnectionStatus.Unknown, model.snapshot.value.status)
        }

    @Test
    fun snapshotReflectsAConnectedEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val src = liveIndicatorSource { flowOf(LiveConnectionSnapshot(LiveConnectionStatus.Connected, stamp, false)) }
            val model = LiveIndicatorViewModel(src, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertEquals(LiveConnectionStatus.Connected, snap.status)
            assertEquals(stamp, snap.lastMessageAtMillis)
            assertFalse(snap.stale)
        }

    @Test
    fun snapshotReflectsADisconnectedWire() =
        runTest(UnconfinedTestDispatcher()) {
            val src = liveIndicatorSource { flowOf(LiveConnectionSnapshot(LiveConnectionStatus.Disconnected, null, false)) }
            val model = LiveIndicatorViewModel(src, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            assertEquals(LiveConnectionStatus.Disconnected, model.snapshot.value.status)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = liveIndicatorSource { flowOf(LiveConnectionSnapshot.unknown()) }
            val model = LiveIndicatorViewModel(src, logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("LiveIndicator", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
