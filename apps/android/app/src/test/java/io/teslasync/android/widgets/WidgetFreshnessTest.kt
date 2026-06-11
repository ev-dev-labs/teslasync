package io.teslasync.android.widgets

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.FreshnessStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Tests [WidgetFreshness.of] tiers (fresh / stale / offline / unknown) and the relative-age bucket. */
class WidgetFreshnessTest {
    private val now = 1_700_000_000_000L

    @Test
    fun unknownWhenNoTimestamp() {
        val freshness = WidgetFreshness.of(fetchedAtMillis = null, nowMillis = now)
        assertEquals(FreshnessStatus.Unknown, freshness.status)
        assertNull(freshness.ageSeconds)
        assertFalse(freshness.isStale)
        assertEquals(FreshnessAge.Unknown, freshness.age)
    }

    @Test
    fun freshWithinWindow() {
        val freshness = WidgetFreshness.of(fetchedAtMillis = now - 30_000L, nowMillis = now)
        assertEquals(FreshnessStatus.Fresh, freshness.status)
        assertFalse(freshness.isStale)
    }

    @Test
    fun staleAfterTwoMinutes() {
        val freshness = WidgetFreshness.of(fetchedAtMillis = now - 300_000L, nowMillis = now)
        assertEquals(FreshnessStatus.Stale, freshness.status)
        assertTrue(freshness.isStale)
        assertEquals(FreshnessAge.Minutes(5), freshness.age)
    }

    @Test
    fun offlineAfterTenMinutes() {
        val freshness = WidgetFreshness.of(fetchedAtMillis = now - 700_000L, nowMillis = now)
        assertEquals(FreshnessStatus.Offline, freshness.status)
        assertTrue(freshness.isStale)
    }
}
