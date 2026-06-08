package io.teslasync.shared.core.net

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Unit tests for [CircuitBreaker] in isolation (no HTTP), giving deterministic,
 * concurrency-free proof of single-flight half-open admission and time-bound recovery
 * that the sequential client-level tests cannot show directly.
 */
class CircuitBreakerUnitTest {
    @Test
    fun opensAtThresholdAndStaysClosedBelowIt() =
        runTestBlocking {
            val clock = VirtualScheduler()
            val breaker = CircuitBreaker(failureThreshold = 3, openMillis = 1_000, scheduler = clock)

            breaker.onFailure()
            breaker.onFailure()
            assertEquals(CircuitState.CLOSED, breaker.currentState())

            breaker.onFailure()
            assertEquals(CircuitState.OPEN, breaker.currentState())
        }

    @Test
    fun rejectsBeforeOpenWindowElapsesAndProbesAfter() =
        runTestBlocking {
            val clock = VirtualScheduler()
            val breaker = CircuitBreaker(failureThreshold = 1, openMillis = 1_000, scheduler = clock)

            breaker.onFailure()
            assertEquals(CircuitState.OPEN, breaker.currentState())

            // Just before the window elapses: still rejected, still open.
            clock.current = 999
            assertFalse(breaker.tryAcquire())
            assertEquals(CircuitState.OPEN, breaker.currentState())

            // At/after the window: the first caller is admitted as the half-open probe.
            clock.current = 1_000
            assertTrue(breaker.tryAcquire())
            assertEquals(CircuitState.HALF_OPEN, breaker.currentState())
        }

    @Test
    fun halfOpenAdmitsOnlyOneConcurrentProbe() =
        runTestBlocking {
            val clock = VirtualScheduler()
            val breaker = CircuitBreaker(failureThreshold = 1, openMillis = 1_000, scheduler = clock)

            breaker.onFailure()
            clock.current = 1_000

            // First caller becomes the probe; every other caller is rejected until it reports.
            assertTrue(breaker.tryAcquire())
            assertFalse(breaker.tryAcquire())
            assertFalse(breaker.tryAcquire())

            // Probe succeeds → closed and admitting again.
            breaker.onSuccess()
            assertEquals(CircuitState.CLOSED, breaker.currentState())
            assertTrue(breaker.tryAcquire())
        }

    @Test
    fun failedProbeReopensForAnotherWindow() =
        runTestBlocking {
            val clock = VirtualScheduler()
            val breaker = CircuitBreaker(failureThreshold = 1, openMillis = 1_000, scheduler = clock)

            breaker.onFailure()
            clock.current = 1_000
            assertTrue(breaker.tryAcquire())

            breaker.onFailure() // probe fails
            assertEquals(CircuitState.OPEN, breaker.currentState())
            // New window opens at now (1_000) + 1_000.
            clock.current = 1_999
            assertFalse(breaker.tryAcquire())
            clock.current = 2_000
            assertTrue(breaker.tryAcquire())
        }
}
