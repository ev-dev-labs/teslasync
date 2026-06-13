package io.teslasync.android.sharedsurfaces.teslareauthbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests [TeslaReauthBannerViewModel] against the grant-signal seam — covering the contract the view depends on, the
 * native port of the web `TeslaReauthBanner`'s `visible` state machine: it seeds hidden (web `useState(false)`), an
 * [TeslaReauthEvent.Expired] shows it, a [TeslaReauthEvent.Recovered] hides it AND drains the queued mutations (web
 * `drainQueuedTeslaMutations`), a local [TeslaReauthBannerViewModel.dismiss] hides it WITHOUT draining, a fresh
 * expiry after a dismiss re-shows it, the reconnect CTA logs a slug-only event, and the one-shot `view.opened` fires
 * exactly once with the surface slug (never a vehicle id or token). The framework-free projection is covered by
 * TeslaReauthBannerProjectionTest. Runs in :android:testReleaseUnitTest.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaReauthBannerViewModelTest {
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
    fun seedsHiddenBeforeAnyEvent() =
        runTest(UnconfinedTestDispatcher()) {
            val model = TeslaReauthBannerViewModel(teslaReauthBannerSource { MutableSharedFlow() }, RecordingLogger(), backgroundScope)
            assertFalse("the banner is dormant until a grant signal arrives", model.visible.value)
        }

    @Test
    fun expiredShowsTheBannerAndRecoveredHidesItAndDrains() =
        runTest(UnconfinedTestDispatcher()) {
            val events = MutableSharedFlow<TeslaReauthEvent>(extraBufferCapacity = 8)
            var drains = 0
            val source = teslaReauthBannerSource(onDrain = { drains += 1 }) { events }
            val model = TeslaReauthBannerViewModel(source, RecordingLogger(), backgroundScope)

            events.emit(TeslaReauthEvent.Expired)
            advanceUntilIdle()
            assertTrue("expired shows the banner", model.visible.value)
            assertEquals("expired does not drain", 0, drains)

            events.emit(TeslaReauthEvent.Recovered)
            advanceUntilIdle()
            assertFalse("recovered hides the banner", model.visible.value)
            assertEquals("recovered drains the queued mutations exactly once", 1, drains)
        }

    @Test
    fun dismissHidesLocallyWithoutDraining() =
        runTest(UnconfinedTestDispatcher()) {
            val events = MutableSharedFlow<TeslaReauthEvent>(extraBufferCapacity = 8)
            var drains = 0
            val source = teslaReauthBannerSource(onDrain = { drains += 1 }) { events }
            val model = TeslaReauthBannerViewModel(source, RecordingLogger(), backgroundScope)
            events.emit(TeslaReauthEvent.Expired)
            advanceUntilIdle()

            model.dismiss()

            assertFalse("dismiss hides the banner", model.visible.value)
            assertEquals("dismiss never replays mutations", 0, drains)
        }

    @Test
    fun reappearsWhenAFreshExpiryFiresAfterDismissal() =
        runTest(UnconfinedTestDispatcher()) {
            val events = MutableSharedFlow<TeslaReauthEvent>(extraBufferCapacity = 8)
            val model = TeslaReauthBannerViewModel(teslaReauthBannerSource { events }, RecordingLogger(), backgroundScope)
            events.emit(TeslaReauthEvent.Expired)
            advanceUntilIdle()
            model.dismiss()
            assertFalse(model.visible.value)

            events.emit(TeslaReauthEvent.Expired)
            advanceUntilIdle()

            assertTrue("a new expiry event re-shows the banner after a dismiss", model.visible.value)
        }

    @Test
    fun reconnectLogsSlugOnly() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = TeslaReauthBannerViewModel(teslaReauthBannerSource { MutableSharedFlow() }, logger, backgroundScope)

            model.reconnect()

            val reconnect = logger.records.filter { it.event == "teslaReauthBanner.reconnect" }
            assertEquals(1, reconnect.size)
            assertEquals(mapOf("surface" to "TeslaReauthBanner"), reconnect.single().fields)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = TeslaReauthBannerViewModel(teslaReauthBannerSource { MutableSharedFlow() }, logger, backgroundScope)

            model.recordViewOpened()
            model.recordViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("TeslaReauthBanner", opened.first().fields["surface"])
            assertTrue("diagnostics carry only the surface slug", opened.first().fields.keys == setOf("surface"))
        }
}
