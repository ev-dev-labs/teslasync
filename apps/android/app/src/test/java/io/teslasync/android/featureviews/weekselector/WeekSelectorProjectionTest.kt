package io.teslasync.android.featureviews.weekselector

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the WeekSelector's pure logic — the native mirror of the two decisions the web
 * component makes (web/src/features/analytics/components/weekly-digest/WeekSelector.tsx): the
 * `isCurrentWeek && <Badge>` badge gate and the `disabled={isCurrentWeek}` Next-button guard, plus the
 * verbatim render of the already-formatted week label. Because the surface is purely presentational each
 * [WeekSelectorDisplay] is exactly what the thin composable renders, so these assertions double as the
 * per-state "snapshot" (current week vs. a past week). The data adapter here is the props → display
 * projection; the owning page owns the cache-then-network feed.
 */
class WeekSelectorProjectionTest {
    @Test
    fun currentWeekShowsBadgeAndDisablesNext() {
        val display = WeekSelectorProjection.project(weekLabel = "Jun 9 – Jun 15", isCurrentWeek = true)

        assertTrue(display.showCurrentBadge)
        // Web `disabled={isCurrentWeek}`: you can never page into the future.
        assertFalse(display.nextEnabled)
        assertEquals("Jun 9 – Jun 15", display.weekLabel)
    }

    @Test
    fun pastWeekHidesBadgeAndEnablesNext() {
        val display = WeekSelectorProjection.project(weekLabel = "Jun 2 – Jun 8", isCurrentWeek = false)

        assertFalse(display.showCurrentBadge)
        assertTrue(display.nextEnabled)
        assertEquals("Jun 2 – Jun 8", display.weekLabel)
    }

    @Test
    fun weekLabelIsRenderedVerbatimForNonBlankInput() {
        // The web renders `{weekLabel}` directly — a formatted `${start} – ${end}` range — so a populated
        // label must pass through untouched (no trimming, no casing changes).
        val label = "  Dec 30 – Jan 5  "
        val display = WeekSelectorProjection.project(weekLabel = label, isCurrentWeek = false)

        assertEquals(label, display.weekLabel)
    }

    @Test
    fun blankLabelFoldsToEmDashSoTheSlotIsNeverEmpty() {
        val display = WeekSelectorProjection.project(weekLabel = "", isCurrentWeek = false)

        assertEquals("\u2014", display.weekLabel)
    }

    @Test
    fun whitespaceOnlyLabelFoldsToEmDash() {
        val display = WeekSelectorProjection.project(weekLabel = "   ", isCurrentWeek = true)

        assertEquals("\u2014", display.weekLabel)
        // The badge / Next guard still derive from isCurrentWeek regardless of the label.
        assertTrue(display.showCurrentBadge)
        assertFalse(display.nextEnabled)
    }
}
