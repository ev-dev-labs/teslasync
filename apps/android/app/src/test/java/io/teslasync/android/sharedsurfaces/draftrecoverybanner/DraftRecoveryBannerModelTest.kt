package io.teslasync.android.sharedsurfaces.draftrecoverybanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

/**
 * Off-device verification of the DraftRecoveryBanner's pure logic — the native mirror of every decision the web
 * component makes (web/src/components/feedback/DraftRecoveryBanner.tsx): the `!hasDraft || dismissed` → nothing
 * gate, the `itemNoun ? …` noun-vs-noun-free copy selection (including the empty-string-is-falsy edge), and the
 * `formatRelativeTime` age buckets (unknown / just-now / minutes / hours / absolute, with the future-timestamp
 * and boundary cases). Because the composable is a thin render layer over [classify] + [relativeDraftAge], the
 * per-branch assertions here double as the surface's per-state snapshot. Runs in the :app:testReleaseUnitTest gate.
 */
class DraftRecoveryBannerModelTest {
    private val now = 1_700_000_000_000L
    private val minute = 60_000L

    /** Classify a present, non-dismissed draft for [itemNoun] and return the resolved noun (web `itemNoun ? …`). */
    private fun nounFor(itemNoun: String?): String? {
        val surface =
            classify(
                hasDraft = true,
                dismissed = false,
                savedAtMillis = now,
                nowMillis = now,
                itemNoun = itemNoun,
            ) as DraftBannerSurface.Visible
        return surface.noun
    }

    // ── classify: visibility gate (web `if (!hasDraft || dismissed) return null`) ────────────────────

    @Test
    fun classifyHidesWhenNoDraft() {
        assertEquals(
            DraftBannerSurface.Hidden,
            classify(hasDraft = false, dismissed = false, savedAtMillis = now, nowMillis = now, itemNoun = "rule"),
        )
    }

    @Test
    fun classifyHidesWhenDismissed() {
        assertEquals(
            DraftBannerSurface.Hidden,
            classify(hasDraft = true, dismissed = true, savedAtMillis = now, nowMillis = now, itemNoun = null),
        )
    }

    // ── classify: the per-state snapshot ─────────────────────────────────────────────────────────────

    @Test
    fun classifyVisibleCarriesNounAndAge() {
        val surface =
            classify(
                hasDraft = true,
                dismissed = false,
                savedAtMillis = now - 5 * minute,
                nowMillis = now,
                itemNoun = "Alert rule",
            )
        assertTrue(surface is DraftBannerSurface.Visible)
        surface as DraftBannerSurface.Visible
        assertEquals("Alert rule", surface.noun)
        assertEquals(DraftAge.Minutes(5), surface.age)
    }

    @Test
    fun classifyTreatsEmptyNounAsAbsent() {
        // Web `itemNoun ? …` — an empty string is falsy, so the noun-free copy is used.
        assertNull(nounFor(""))
    }

    @Test
    fun classifyTreatsNullNounAsAbsent() {
        assertNull(nounFor(null))
    }

    @Test
    fun classifyKeepsAWhitespaceNoun() {
        // Web truthiness: a non-empty string (even whitespace) is truthy → the noun copy is selected.
        assertEquals(" ", nounFor(" "))
    }

    // ── relativeDraftAge: the web `formatRelativeTime` buckets ───────────────────────────────────────

    @Test
    fun unknownWhenNoTimestamp() {
        // Web `draftSavedAt ? formatRelativeTime(…) : t('draft.unknownTime')`.
        assertEquals(DraftAge.Unknown, relativeDraftAge(null, now))
    }

    @Test
    fun justNowUnderOneMinute() {
        assertEquals(DraftAge.JustNow, relativeDraftAge(now - 30_000L, now))
    }

    @Test
    fun futureTimestampBucketsToJustNow() {
        // Web `diffMin < 1` — a negative age (clock skew) collapses to "Just now".
        assertEquals(DraftAge.JustNow, relativeDraftAge(now + 5 * minute, now))
    }

    @Test
    fun minutesBucketWithinTheHour() {
        assertEquals(DraftAge.Minutes(1), relativeDraftAge(now - minute, now))
        assertEquals(DraftAge.Minutes(59), relativeDraftAge(now - 59 * minute, now))
    }

    @Test
    fun hoursBucketWithinTheDay() {
        assertEquals(DraftAge.Hours(1), relativeDraftAge(now - 60 * minute, now))
        assertEquals(DraftAge.Hours(23), relativeDraftAge(now - 23 * 60 * minute, now))
    }

    @Test
    fun absoluteBucketOverADay() {
        // Web's `toLocaleDateString` fallback: "MMM d" + short time. Pinned to UTC + Locale.US for determinism.
        val savedAt = Instant.parse("2026-06-05T14:30:00Z").toEpochMilli()
        val twoDaysLater = savedAt + 2L * 24 * 60 * minute
        val age = relativeDraftAge(savedAt, twoDaysLater, zone = ZoneId.of("UTC"), locale = Locale.US)
        assertTrue("expected an absolute bucket: $age", age is DraftAge.Absolute)
        age as DraftAge.Absolute
        assertTrue("expected the 'Jun 5' date: ${age.value}", age.value.startsWith("Jun 5,"))
        assertTrue("expected the persisted time: ${age.value}", age.value.contains("2:30"))
    }
}
