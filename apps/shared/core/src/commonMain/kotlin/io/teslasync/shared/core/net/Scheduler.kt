package io.teslasync.shared.core.net

import kotlinx.coroutines.delay
import kotlin.time.TimeSource

/**
 * Single seam for *both* the breaker's wall-clock reads and the retry loop's
 * backoff sleeps. Injecting one abstraction lets tests drive backoff and breaker
 * timing deterministically with zero real delay — the prompt's "virtual clock for
 * backoff (no real sleeps)" requirement.
 */
public interface Scheduler {
    /** Monotonic milliseconds; only differences are meaningful (not an epoch). */
    public fun nowMillis(): Long

    /** Suspends for [millis]. No-op for non-positive durations. */
    public suspend fun sleep(millis: Long)
}

/**
 * Production scheduler: a monotonic time source for breaker windows and real
 * coroutine [delay] for backoff. Object-singleton — it holds no per-client state.
 */
public object RealScheduler : Scheduler {
    private val origin = TimeSource.Monotonic.markNow()

    override fun nowMillis(): Long = origin.elapsedNow().inWholeMilliseconds

    override suspend fun sleep(millis: Long) {
        if (millis > 0) delay(millis)
    }
}
