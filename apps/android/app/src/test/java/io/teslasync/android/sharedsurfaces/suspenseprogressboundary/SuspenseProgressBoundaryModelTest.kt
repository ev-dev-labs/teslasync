package io.teslasync.android.sharedsurfaces.suspenseprogressboundary

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the SuspenseProgressBoundary's pure logic — the native mirror of every decision
 * the web source makes (web/src/components/feedback/SuspenseProgressBoundary.tsx +
 * web/src/lib/globalProgress.ts): the stacking active count, the idempotent stop, the asymptotic trickle
 * toward 80%, the subscribe-time replay, and the two boundary render phases. Because the composable is a thin
 * render layer over these reducers + the [GlobalProgressController], the per-branch assertions here double as
 * the surface's per-state snapshot. Runs in the testReleaseUnitTest gate.
 */
class SuspenseProgressBoundaryModelTest {
    private val tolerance = 1e-3f

    // ── boundary phase (web: Suspense fallback mounted vs resolved) ───────────────────────────────────

    @Test
    fun boundaryPhaseMapsLoadingFlagToTheTwoRenderStates() {
        assertEquals(BoundaryPhase.Loading, boundaryPhase(true))
        assertEquals(BoundaryPhase.Loaded, boundaryPhase(false))
    }

    // ── progressStart (web `start`) ───────────────────────────────────────────────────────────────────

    @Test
    fun progressStartSeedsTheInitialJumpOnlyForTheFirstConsumer() {
        val first = progressStart(GlobalProgressState.Idle)
        assertTrue(first.active)
        assertEquals(1, first.activeCount)
        assertEquals(TRICKLE_INITIAL, first.progress, tolerance)

        // A second concurrent start stacks the count and leaves the in-flight progress untouched.
        val advanced = first.copy(progress = 40f)
        val second = progressStart(advanced)
        assertEquals(2, second.activeCount)
        assertEquals(40f, second.progress, tolerance)
    }

    // ── progressStop (web `stop`) ─────────────────────────────────────────────────────────────────────

    @Test
    fun progressStopReleasesOneConsumerAndResetsOnlyWhenTheLastLeaves() {
        val twoActive = GlobalProgressState(active = true, progress = 55f, activeCount = 2)

        val stillActive = progressStop(twoActive)
        assertTrue(stillActive.active)
        assertEquals(1, stillActive.activeCount)
        assertEquals("progress holds while a consumer remains", 55f, stillActive.progress, tolerance)

        val idle = progressStop(stillActive)
        assertFalse(idle.active)
        assertEquals(0, idle.activeCount)
        assertEquals("progress snaps to zero when the last consumer leaves", 0f, idle.progress, tolerance)
    }

    @Test
    fun progressStopSaturatesAtZeroSoADoubleStopCannotUnderflow() {
        val underflowed = progressStop(GlobalProgressState.Idle)
        assertEquals(0, underflowed.activeCount)
        assertFalse(underflowed.active)
    }

    // ── nextTrickleProgress (web asymptotic trickle) ─────────────────────────────────────────────────

    @Test
    fun nextTrickleAdvancesByFifteenPercentOfTheRemainingGap() {
        // remaining = 80 - 8 = 72; step = max(1, 72 * 0.15) = 10.8 -> 18.8
        assertEquals(18.8f, nextTrickleProgress(TRICKLE_INITIAL), tolerance)
    }

    @Test
    fun nextTrickleNeverStepsLessThanTheFloor() {
        // remaining = 0.5; 0.5 * 0.15 = 0.075 -> floored to the 1.0 minimum step.
        assertEquals(80f, nextTrickleProgress(79.5f), tolerance)
    }

    @Test
    fun nextTrickleHoldsAtAndBeyondTheTarget() {
        assertEquals(TRICKLE_TARGET, nextTrickleProgress(TRICKLE_TARGET), tolerance)
        assertEquals(85f, nextTrickleProgress(85f), tolerance)
    }

    @Test
    fun nextTrickleIsStrictlyMonotonicAndConvergesExactlyToTheTarget() {
        var progress = TRICKLE_INITIAL
        var steps = 0
        while (progress < TRICKLE_TARGET) {
            val next = nextTrickleProgress(progress)
            assertTrue("each tick moves forward", next > progress)
            assertTrue("never overshoots the target", next <= TRICKLE_TARGET)
            progress = next
            steps++
            assertTrue("the trickle terminates", steps < 1_000)
        }
        assertEquals(TRICKLE_TARGET, progress, 0f)
    }

    // ── progressTick (web trickle interval body) ─────────────────────────────────────────────────────

    @Test
    fun progressTickIsANoOpWhileIdle() {
        val idle = GlobalProgressState.Idle
        assertSame(idle, progressTick(idle))
    }

    @Test
    fun progressTickIsANoOpAtTheTarget() {
        val parked = GlobalProgressState(active = true, progress = TRICKLE_TARGET, activeCount = 1)
        assertSame(parked, progressTick(parked))
    }

    @Test
    fun progressTickAdvancesWhileActiveAndBelowTarget() {
        val active = GlobalProgressState(active = true, progress = TRICKLE_INITIAL, activeCount = 1)
        val ticked = progressTick(active)
        assertNotEquals(active.progress, ticked.progress)
        assertEquals(18.8f, ticked.progress, tolerance)
        assertEquals("ticking never changes the consumer count", 1, ticked.activeCount)
    }

    // ── progressFraction (0..100 -> 0..1 for the determinate bar) ────────────────────────────────────

    @Test
    fun progressFractionMapsAndClampsToTheUnitInterval() {
        assertEquals(0f, progressFraction(0f), tolerance)
        assertEquals(0.8f, progressFraction(TRICKLE_TARGET), tolerance)
        assertEquals(1f, progressFraction(PROGRESS_FULL), tolerance)
        assertEquals("over-range clamps high", 1f, progressFraction(140f), tolerance)
        assertEquals("under-range clamps low", 0f, progressFraction(-5f), tolerance)
    }

    @Test
    fun stateFractionMirrorsTheStandaloneHelper() {
        val state = GlobalProgressState(active = true, progress = 50f, activeCount = 1)
        assertEquals(progressFraction(50f), state.fraction, tolerance)
    }

    // ── GlobalProgressController: stacking + idempotency (web singleton contract) ─────────────────────

    @Test
    fun controllerStartActivatesAndSeedsTheBar() {
        val controller = GlobalProgressController()
        controller.start()

        val snapshot = controller.snapshot()
        assertTrue(snapshot.active)
        assertEquals(1, snapshot.activeCount)
        assertEquals(TRICKLE_INITIAL, snapshot.progress, tolerance)
    }

    @Test
    fun controllerStaysActiveUntilTheLastStackedConsumerStops() {
        val controller = GlobalProgressController()
        val stopA = controller.start()
        val stopB = controller.start()
        assertEquals(2, controller.snapshot().activeCount)

        stopA()
        assertTrue("one consumer remains", controller.snapshot().active)
        assertEquals(1, controller.snapshot().activeCount)

        stopB()
        assertFalse("the bar deactivates only once every consumer has stopped", controller.snapshot().active)
        assertEquals(0f, controller.snapshot().progress, tolerance)
    }

    @Test
    fun controllerStopIsIdempotentSoStrictModeCannotUnderflowTheCount() {
        val controller = GlobalProgressController()
        val stopA = controller.start()
        controller.start()
        assertEquals(2, controller.snapshot().activeCount)

        stopA()
        stopA() // a second invocation (double dispose / StrictMode) must not decrement again.
        assertEquals("the idempotent stop fired exactly once", 1, controller.snapshot().activeCount)
        assertTrue(controller.snapshot().active)
    }

    @Test
    fun controllerTickAdvancesTheTrickleTowardTheTarget() {
        val controller = GlobalProgressController()
        controller.start()
        val seeded = controller.snapshot().progress

        controller.tick()
        assertTrue(controller.snapshot().progress > seeded)

        repeat(64) { controller.tick() }
        assertEquals("the trickle parks at the asymptote", TRICKLE_TARGET, controller.snapshot().progress, tolerance)
    }

    @Test
    fun controllerTickIsInertWhileIdle() {
        val controller = GlobalProgressController()
        controller.tick()
        assertEquals(GlobalProgressState.Idle, controller.snapshot())
    }

    // ── GlobalProgressController: subscribe / replay / isolation (web subscribe) ──────────────────────

    @Test
    fun subscribeReplaysTheCurrentStateImmediately() {
        val controller = GlobalProgressController()
        controller.start()

        var observedActive = false
        var observedProgress = -1f
        controller.subscribe { active, progress ->
            observedActive = active
            observedProgress = progress
        }

        assertTrue("a listener mounted mid-flight sees the active edge at once", observedActive)
        assertEquals(TRICKLE_INITIAL, observedProgress, tolerance)
    }

    @Test
    fun subscribeReceivesEveryStartTickAndStopUntilUnsubscribed() {
        val controller = GlobalProgressController()
        val updates = mutableListOf<Pair<Boolean, Float>>()
        val unsubscribe = controller.subscribe { active, progress -> updates += active to progress }

        assertEquals("replayed the idle state on subscribe", 1, updates.size)
        assertEquals(false to 0f, updates.first())

        val stop = controller.start()
        controller.tick()
        stop()
        assertTrue("start, tick and stop were all delivered", updates.size >= 4)
        assertEquals("the final delivery is the idle edge", false to 0f, updates.last())

        val countBefore = updates.size
        unsubscribe()
        controller.start()
        assertEquals("no deliveries arrive after unsubscribe", countBefore, updates.size)
    }

    @Test
    fun aThrowingListenerNeverBreaksTheChannelForOthers() {
        val controller = GlobalProgressController()
        var goodListenerSaw = false
        controller.subscribe { _, _ -> error("listener boom") }
        controller.subscribe { active, _ -> goodListenerSaw = goodListenerSaw || active }

        controller.start()
        assertTrue("the surviving listener still received the update", goodListenerSaw)
    }

    @Test
    fun resetForTestsReturnsToIdleAndDropsListeners() {
        val controller = GlobalProgressController()
        var delivered = false
        controller.subscribe { _, _ -> delivered = true }
        controller.start()

        controller.resetForTests()
        assertEquals(GlobalProgressState.Idle, controller.snapshot())

        delivered = false
        controller.start()
        assertFalse("a dropped listener receives nothing", delivered)
    }

    @Test
    fun defaultChannelIsAUsableControllerInstance() {
        // The process-wide default behaves like any controller; reset afterwards to avoid cross-test leakage.
        try {
            val stop = GlobalProgress.start()
            assertTrue(GlobalProgress.snapshot().active)
            stop()
            assertFalse(GlobalProgress.snapshot().active)
        } finally {
            GlobalProgress.resetForTests()
        }
    }
}
