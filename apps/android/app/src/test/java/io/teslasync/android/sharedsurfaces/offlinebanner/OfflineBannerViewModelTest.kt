// Tests [OfflineBannerViewModel] against the live wire-health seam — covering the contract the view depends on:
// each emission re-shares onto the PII-free [OfflineBannerSnapshot] the surface renders, the initial value is the
// cold-start `unknown` seed (which projects to the dormant online phase, never a premature offline banner), the
// banner's [OfflineBannerViewModel.reconnect] forwards to the source and logs a slug-only event, and the one-shot
// `view.opened` fires exactly once with the surface slug (never a vehicle id). The framework-free projection is
// covered by OfflineBannerProjectionTest. Runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.offlinebanner

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
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OfflineBannerViewModelTest {
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
    fun snapshotSeedsAsUnknownBeforeAnyEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val src = offlineBannerSource { flowOf(OfflineBannerSnapshot(LiveConnectionStatus.Disconnected)) }
            val model = OfflineBannerViewModel(src, RecordingLogger(), backgroundScope)
            // No collector yet → the lifecycle-aware StateFlow exposes its cold-start seed (dormant online).
            assertEquals(LiveConnectionStatus.Unknown, model.snapshot.value.status)
        }

    @Test
    fun snapshotReflectsAConnectedEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val src = offlineBannerSource { flowOf(OfflineBannerSnapshot(LiveConnectionStatus.Connected)) }
            val model = OfflineBannerViewModel(src, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            assertEquals(LiveConnectionStatus.Connected, model.snapshot.value.status)
        }

    @Test
    fun snapshotReflectsADisconnectedWire() =
        runTest(UnconfinedTestDispatcher()) {
            val src = offlineBannerSource { flowOf(OfflineBannerSnapshot(LiveConnectionStatus.Disconnected)) }
            val model = OfflineBannerViewModel(src, RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            assertEquals(LiveConnectionStatus.Disconnected, model.snapshot.value.status)
        }

    @Test
    fun reconnectForwardsToTheSourceAndLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            var reconnects = 0
            val logger = RecordingLogger()
            val src =
                offlineBannerSource(onReconnect = { reconnects++ }) {
                    flowOf(OfflineBannerSnapshot.unknown())
                }
            val model = OfflineBannerViewModel(src, logger, backgroundScope)

            model.reconnect()

            assertEquals("reconnect forwards to the live layer", 1, reconnects)
            val reconnect = logger.records.filter { it.event == "offlineBanner.reconnect" }
            assertEquals(1, reconnect.size)
            assertEquals(mapOf("surface" to "OfflineBanner"), reconnect.single().fields)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val src = offlineBannerSource { flowOf(OfflineBannerSnapshot.unknown()) }
            val model = OfflineBannerViewModel(src, logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("OfflineBanner", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
