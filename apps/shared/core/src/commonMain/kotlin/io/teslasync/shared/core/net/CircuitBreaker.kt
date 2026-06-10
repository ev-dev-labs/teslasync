package io.teslasync.shared.core.net

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Observable breaker states; exposed so callers/tests can assert transitions. */
public enum class CircuitState { CLOSED, OPEN, HALF_OPEN }

/**
 * Minimal consecutive-failure circuit breaker mirroring the web client's intent:
 * after [failureThreshold] consecutive failures the breaker OPENs and fast-fails
 * every call for [openMillis]; once that window elapses it admits a single probe
 * (HALF_OPEN). A successful probe CLOSEs the breaker; a failed probe re-OPENs it for
 * another window. While a probe is in flight, other callers are still rejected so a
 * shared client does not stampede the recovering upstream.
 *
 * Only transport/timeout/5xx outcomes count as failures — 2xx/4xx responses prove
 * the server is reachable and reset the failure count via [onSuccess].
 *
 * All state is guarded by a [Mutex] so concurrent callers observe a consistent
 * view; the injected [scheduler] supplies the clock so tests need no real time.
 */
public class CircuitBreaker(
    private val failureThreshold: Int,
    private val openMillis: Long,
    private val scheduler: Scheduler,
) {
    private val mutex = Mutex()
    private var failures = 0
    private var openUntil = 0L
    private var state = CircuitState.CLOSED
    private var probeInFlight = false

    /** Current state. Suspends only to take the lock; never blocks on I/O. */
    public suspend fun currentState(): CircuitState = mutex.withLock { state }

    /**
     * Returns `true` if a call may proceed. When the breaker is OPEN and the open
     * window has elapsed, transitions to HALF_OPEN and admits exactly one probe;
     * further callers are rejected until that probe reports back.
     */
    public suspend fun tryAcquire(): Boolean =
        mutex.withLock {
            when (state) {
                CircuitState.CLOSED -> true
                CircuitState.OPEN ->
                    if (scheduler.nowMillis() >= openUntil) {
                        state = CircuitState.HALF_OPEN
                        probeInFlight = true
                        true
                    } else {
                        false
                    }
                CircuitState.HALF_OPEN ->
                    if (probeInFlight) {
                        false
                    } else {
                        probeInFlight = true
                        true
                    }
            }
        }

    /** Records a healthy outcome: closes the breaker and clears the failure count. */
    public suspend fun onSuccess(): Unit =
        mutex.withLock {
            failures = 0
            probeInFlight = false
            state = CircuitState.CLOSED
        }

    /**
     * Records a failure. A failed HALF_OPEN probe re-opens immediately; otherwise the
     * consecutive-failure count is bumped and the breaker opens once it reaches the
     * threshold.
     */
    public suspend fun onFailure(): Unit =
        mutex.withLock {
            if (state == CircuitState.HALF_OPEN) {
                open()
                return@withLock
            }
            failures += 1
            if (failures >= failureThreshold) {
                open()
            }
        }

    private fun open() {
        state = CircuitState.OPEN
        openUntil = scheduler.nowMillis() + openMillis
        failures = 0
        probeInFlight = false
    }
}
