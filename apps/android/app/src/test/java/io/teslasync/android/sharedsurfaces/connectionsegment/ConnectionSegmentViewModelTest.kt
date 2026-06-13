// Tests [ConnectionSegmentViewModel] against the API-health seam — covering the contract the view depends on:
// each emission re-shares onto the PII-free [ConnectionSnapshot] the segment renders, the initial value is the
// cold-start `unknown` seed, and the one-shot `view.opened` fires exactly once with the surface slug (never a
// latency or request payload). The framework-free projection is covered by ConnectionSegmentProjectionTest.
// Runs in the :app:testReleaseUnitTest gate.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.connectionsegment

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.apihealth.ApiHealthStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConnectionSegmentViewModelTest {
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
            val src = staticConnectionSegmentSource(ConnectionSnapshot(ApiHealthStatus.OK, 120L, stamp))
            val model = ConnectionSegmentViewModel(src, RecordingLogger(), backgroundScope)
            // No collector yet → the lifecycle-aware StateFlow exposes its cold-start seed.
            assertEquals(ApiHealthStatus.UNKNOWN, model.snapshot.value.status)
        }

    @Test
    fun snapshotReflectsAnEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val src = staticConnectionSegmentSource(ConnectionSnapshot(ApiHealthStatus.OK, 120L, stamp))
            val model = ConnectionSegmentViewModel(src, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertEquals(ApiHealthStatus.OK, snap.status)
            assertEquals(120L, snap.latencyMs)
            assertEquals(stamp, snap.lastCheckedAtMillis)
        }

    @Test
    fun snapshotReflectsAnOfflineProbe() =
        runTest(UnconfinedTestDispatcher()) {
            val src = staticConnectionSegmentSource(ConnectionSnapshot(ApiHealthStatus.OFFLINE, 5_000L, stamp))
            val model = ConnectionSegmentViewModel(src, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            assertEquals(ApiHealthStatus.OFFLINE, model.snapshot.value.status)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = ConnectionSegmentViewModel(staticConnectionSegmentSource(ConnectionSnapshot.unknown()), logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("ConnectionSegment", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
