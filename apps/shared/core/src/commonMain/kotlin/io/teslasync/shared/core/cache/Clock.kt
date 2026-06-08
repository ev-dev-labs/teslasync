package io.teslasync.shared.core.cache

import kotlin.time.Clock as KotlinClock

/**
 * Wall-clock seam for the offline cache (ADR-013). Only epoch-millisecond reads are
 * needed: every cached value is stamped with `fetched_at` and staleness is a pure
 * `now - fetchedAt > ttl` comparison. Injecting this seam lets tests drive freshness
 * transitions with a deterministic virtual clock — no real waiting.
 */
public interface Clock {
    /** Current time in milliseconds since the Unix epoch. */
    public fun nowMillis(): Long
}

/** Production clock backed by the system wall clock. */
public object SystemClock : Clock {
    override fun nowMillis(): Long = KotlinClock.System.now().toEpochMilliseconds()
}
