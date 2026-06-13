package io.teslasync.android.sharedsurfaces.teslareauthbanner

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Off-device verification of [TeslaReauthBus] — the native analogue of the web's global `document` event target plus
 * the `teslaAuthRecovery.ts` replay queue. It is the surface's data adapter: external producers dispatch grant
 * signals + queue mutations, and the surface consumes the events and drains the queue on recovery. Covers the hot
 * event stream ([TeslaReauthBus.notifyExpired]/[TeslaReauthBus.notifyRecovered]) and the best-effort replay queue
 * ([TeslaReauthBus.enqueueMutation]/[TeslaReauthBus.drainQueuedMutations]). Runs in the :android:testReleaseUnitTest gate.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeslaReauthBannerBusTest {
    @Test
    fun eventsStreamDeliversExpiredThenRecoveredInOrder() =
        runTest(UnconfinedTestDispatcher()) {
            val bus = TeslaReauthBus()
            val received = mutableListOf<TeslaReauthEvent>()
            backgroundScope.launch { bus.events.collect { received += it } }

            bus.notifyExpired()
            bus.notifyRecovered()
            advanceUntilIdle()

            assertEquals(listOf(TeslaReauthEvent.Expired, TeslaReauthEvent.Recovered), received)
        }

    @Test
    fun drainReplaysEveryQueuedMutationInOrderThenClears() =
        runTest(UnconfinedTestDispatcher()) {
            val bus = TeslaReauthBus()
            val order = mutableListOf<Int>()
            bus.enqueueMutation { order += 1 }
            bus.enqueueMutation { order += 2 }
            assertEquals("both mutations are queued", 2, bus.queuedMutationCount())

            bus.drainQueuedMutations()

            assertEquals(listOf(1, 2), order)
            assertEquals("the queue is cleared after a drain", 0, bus.queuedMutationCount())
        }

    @Test
    fun drainIsBestEffortAndOneThrowingReplayDoesNotAbortTheRest() =
        runTest(UnconfinedTestDispatcher()) {
            val bus = TeslaReauthBus()
            val order = mutableListOf<Int>()
            bus.enqueueMutation {
                order += 1
                error("a replay closure surfaces its own error through its normal path")
            }
            bus.enqueueMutation { order += 2 }

            bus.drainQueuedMutations()

            assertEquals("a throwing replay never aborts the remaining replays", listOf(1, 2), order)
            assertEquals(0, bus.queuedMutationCount())
        }

    @Test
    fun resetQueueDropsPendingReplaysWithoutRunningThem() =
        runTest(UnconfinedTestDispatcher()) {
            val bus = TeslaReauthBus()
            var ran = 0
            bus.enqueueMutation { ran += 1 }
            bus.resetQueue()
            assertEquals(0, bus.queuedMutationCount())

            bus.drainQueuedMutations()

            assertEquals("a reset queue replays nothing", 0, ran)
        }

    @Test
    fun adapterForwardsBusEventsAndRecoveryDrain() =
        runTest(UnconfinedTestDispatcher()) {
            val bus = TeslaReauthBus()
            val source = bus.asTeslaReauthBannerSource()
            val received = mutableListOf<TeslaReauthEvent>()
            backgroundScope.launch { source.events().collect { received += it } }
            var ran = 0
            bus.enqueueMutation { ran += 1 }

            bus.notifyExpired()
            advanceUntilIdle()
            source.drainQueuedMutations()

            assertEquals(listOf(TeslaReauthEvent.Expired), received)
            assertEquals("the adapter's drain forwards to the bus queue", 1, ran)
        }
}
