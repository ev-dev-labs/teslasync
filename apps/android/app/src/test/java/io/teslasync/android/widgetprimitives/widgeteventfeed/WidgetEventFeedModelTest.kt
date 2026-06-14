package io.teslasync.android.widgetprimitives.widgeteventfeed

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WidgetEventFeed primitive's pure logic — the native analogue of the web
 * shared component (web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx): the per-footprint cap
 * (`maxItems ?? (compact ? 3 : 10)`), the newest-first sort + slice, the `formatRelativeTime` tiers
 * ("Just now" / "Xm ago" / "Xh ago" / absolute ≥ 24h), the tolerant timestamp parse, and the
 * `EventSeverity` decode. Runs in the offline `:app:testReleaseUnitTest` gate; the Compose rendering +
 * accessibility are covered on-device by WidgetEventFeedUiTest.
 */
class WidgetEventFeedModelTest {
    private val now = 1_000_000_000_000L

    private data class Sample(
        val id: String,
        val ts: Long?,
    )

    // ── eventFeedLimit (web `maxItems ?? (compact ? 3 : 10)`) ─────────────────────────────────────────

    @Test
    fun limitPrefersExplicitMaxItems() {
        assertEquals(5, eventFeedLimit(maxItems = 5, compact = false))
        assertEquals(5, eventFeedLimit(maxItems = 5, compact = true))
    }

    @Test
    fun limitFallsBackToCompactDefault() {
        assertEquals(3, eventFeedLimit(maxItems = null, compact = true))
        assertEquals(10, eventFeedLimit(maxItems = null, compact = false))
    }

    // ── orderEventFeed (web `[...items].sort(byTimestampDesc).slice(0, limit)`) ────────────────────────

    @Test
    fun ordersNewestFirst() {
        val items = listOf(Sample("a", 100L), Sample("b", 300L), Sample("c", 200L))
        val ordered = orderEventFeed(items, limit = 10) { it.ts }
        assertEquals(listOf("b", "c", "a"), ordered.map(Sample::id))
    }

    @Test
    fun capsAtLimit() {
        val items = (1..6).map { Sample("e$it", it * 100L) }
        assertEquals(3, orderEventFeed(items, limit = 3) { it.ts }.size)
    }

    @Test
    fun itemsWithNoTimestampSortLast() {
        val items = listOf(Sample("missing", null), Sample("present", 100L))
        val ordered = orderEventFeed(items, limit = 10) { it.ts }
        assertEquals(listOf("present", "missing"), ordered.map(Sample::id))
    }

    @Test
    fun nonPositiveLimitYieldsEmpty() {
        val items = listOf(Sample("a", 100L))
        assertTrue(orderEventFeed(items, limit = 0) { it.ts }.isEmpty())
        assertTrue(orderEventFeed(items, limit = -1) { it.ts }.isEmpty())
    }

    @Test
    fun equalTimestampsKeepInputOrder() {
        val items = listOf(Sample("first", 100L), Sample("second", 100L))
        val ordered = orderEventFeed(items, limit = 10) { it.ts }
        assertEquals(listOf("first", "second"), ordered.map(Sample::id))
    }

    // ── eventRelativeTime (web formatRelativeTime cutoffs) ────────────────────────────────────────────

    @Test
    fun justNowUnderAMinuteAndForFutureTimestamps() {
        assertEquals(EventRelativeTime.JustNow, eventRelativeTime(now, now))
        assertEquals(EventRelativeTime.JustNow, eventRelativeTime(now - 59_999L, now))
        // Future timestamp (negative delta) floors below 1 → "Just now", matching the web.
        assertEquals(EventRelativeTime.JustNow, eventRelativeTime(now + 120_000L, now))
    }

    @Test
    fun minutesTierBetweenOneAndFiftyNine() {
        assertEquals(EventRelativeTime.Minutes(1L), eventRelativeTime(now - 60_000L, now))
        assertEquals(EventRelativeTime.Minutes(5L), eventRelativeTime(now - 5L * 60_000L, now))
        assertEquals(EventRelativeTime.Minutes(59L), eventRelativeTime(now - 59L * 60_000L, now))
    }

    @Test
    fun hoursTierBetweenOneAndTwentyThree() {
        assertEquals(EventRelativeTime.Hours(1L), eventRelativeTime(now - 60L * 60_000L, now))
        assertEquals(EventRelativeTime.Hours(23L), eventRelativeTime(now - (23L * 60L + 59L) * 60_000L, now))
    }

    @Test
    fun absoluteTierAtOrBeyondADay() {
        val dayOld = now - 24L * 60L * 60_000L
        assertEquals(EventRelativeTime.Absolute(dayOld), eventRelativeTime(dayOld, now))
    }

    @Test
    fun nullTimestampIsUnknown() {
        assertEquals(EventRelativeTime.Unknown, eventRelativeTime(null, now))
    }

    // ── parseEpochMillis (tolerant ISO-8601) ──────────────────────────────────────────────────────────

    @Test
    fun parseEpochMillisIsTolerant() {
        assertNull(parseEpochMillis(null))
        assertNull(parseEpochMillis(""))
        assertNull(parseEpochMillis("   "))
        assertNull(parseEpochMillis("not-a-date"))
        assertEquals(0L, parseEpochMillis("1970-01-01T00:00:00Z"))
        assertEquals(parseEpochMillis("2026-06-06T12:00:00Z"), parseEpochMillis("2026-06-06T14:00:00+02:00"))
    }

    // ── EventSeverity.fromWire (web `'info' | 'warning' | 'critical'`) ────────────────────────────────

    @Test
    fun severityDecodesTheUnionCaseInsensitivelyAndDefaultsNull() {
        assertEquals(EventSeverity.Info, EventSeverity.fromWire("info"))
        assertEquals(EventSeverity.Warning, EventSeverity.fromWire("WARNING"))
        assertEquals(EventSeverity.Critical, EventSeverity.fromWire(" critical "))
        assertNull(EventSeverity.fromWire("unknown"))
        assertNull(EventSeverity.fromWire(null))
    }
}
