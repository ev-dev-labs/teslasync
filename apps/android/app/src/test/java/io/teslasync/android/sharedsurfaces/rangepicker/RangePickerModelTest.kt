package io.teslasync.android.sharedsurfaces.rangepicker

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.util.Locale

/**
 * Off-device verification of the RangePicker's pure logic — the native mirror of every value the web component
 * derives (web/src/components/forms/RangePicker.tsx + web/src/lib/datePresets.ts): the 11 preset ranges, the
 * active-preset match, the "All time" floor, the inclusive day-count, the locale range formatting, the
 * staged-dirty / Apply-enabled decision, the UTC-millis calendar adapter, and the trigger projection. Because the
 * composable is a thin render layer over [RangePickerLogic] + [RangePickerProjection], the assertions here double
 * as the surface's per-state snapshot. Runs in the :android:testReleaseUnitTest gate.
 */
class RangePickerModelTest {
    // A fixed wall-clock day (Wed, Q2) so every preset resolves to a distinct, hand-verifiable range.
    private val today = LocalDate.of(2024, 5, 15)

    // ── Preset resolution: a 1:1 port of web `DATE_PRESETS` ─────────────────────────────────────────────

    @Test
    fun presetsResolveTheSameRangesAsTheWebSource() {
        assertEquals(RangePickerValue("2024-05-15", "2024-05-15"), resolve("today"))
        assertEquals(RangePickerValue("2024-05-14", "2024-05-14"), resolve("yesterday"))
        assertEquals(RangePickerValue("2024-05-09", "2024-05-15"), resolve("7d"))
        assertEquals(RangePickerValue("2024-04-16", "2024-05-15"), resolve("30d"))
        assertEquals(RangePickerValue("2024-05-01", "2024-05-15"), resolve("mtd"))
        assertEquals(RangePickerValue("2024-04-01", "2024-05-15"), resolve("qtd"))
        assertEquals(RangePickerValue("2024-01-01", "2024-05-15"), resolve("ytd"))
        assertEquals(RangePickerValue("2024-04-01", "2024-04-30"), resolve("lastMonth"))
        assertEquals(RangePickerValue("2023-05-15", "2024-05-15"), resolve("1y"))
        assertEquals(RangePickerValue("2015-01-01", "2024-05-15"), resolve("all"))
    }

    @Test
    fun everyTrailingPresetEndsAtToday() {
        val trailing = listOf("7d", "30d", "90d", "mtd", "qtd", "ytd", "1y", "all")
        trailing.forEach { id -> assertEquals("$id ends today", "2024-05-15", resolve(id).end) }
    }

    // ── DEFAULT_PRESET_IDS + presetsFor ordering (web `DATE_PRESETS.filter(includes)`) ──────────────────

    @Test
    fun defaultPresetIdsMatchTheWebDefaultChipSet() {
        assertEquals(listOf("today", "7d", "30d", "mtd", "ytd", "all"), RangePickerLogic.DEFAULT_PRESET_IDS)
    }

    @Test
    fun presetsForPreservesCanonicalOrderRegardlessOfRequestOrder() {
        val ids = RangePickerLogic.presetsFor(listOf("all", "today", "7d")).map { it.id }
        assertEquals(listOf("today", "7d", "all"), ids)
    }

    @Test
    fun presetsForDropsUnknownIds() {
        assertTrue(RangePickerLogic.presetsFor(listOf("nope", "missing")).isEmpty())
    }

    // ── matchPresetId: the active-preset highlight (web `matchPresetId`) ─────────────────────────────────

    @Test
    fun matchPresetIdIdentifiesThePresetWhoseRangeEqualsTheValue() {
        assertEquals("today", RangePickerLogic.matchPresetId("2024-05-15", "2024-05-15", today))
        assertEquals("7d", RangePickerLogic.matchPresetId("2024-05-09", "2024-05-15", today))
        assertEquals("qtd", RangePickerLogic.matchPresetId("2024-04-01", "2024-05-15", today))
        assertEquals("ytd", RangePickerLogic.matchPresetId("2024-01-01", "2024-05-15", today))
    }

    @Test
    fun matchPresetIdReturnsNullForACustomRange() {
        assertEquals(null, RangePickerLogic.matchPresetId("2024-05-03", "2024-05-09", today))
    }

    // ── resolveAllTimeStart: the "All time" floor (web `resolveAllTimeStart`) ────────────────────────────

    @Test
    fun resolveAllTimeStartFloorsToTheBaselineOrTheLaterMinDate() {
        assertEquals("2015-01-01", RangePickerLogic.resolveAllTimeStart(null))
        assertEquals("2015-01-01", RangePickerLogic.resolveAllTimeStart("2014-06-01"))
        assertEquals("2020-03-01", RangePickerLogic.resolveAllTimeStart("2020-03-01"))
    }

    @Test
    fun appliedRangeForPresetFloorsAllTimeToMinDate() {
        assertEquals(RangePickerValue("2024-05-09", "2024-05-15"), RangePickerLogic.appliedRangeForPreset("7d", today, null))
        assertEquals(RangePickerValue("2015-01-01", "2024-05-15"), RangePickerLogic.appliedRangeForPreset("all", today, null))
        assertEquals(
            RangePickerValue("2020-03-01", "2024-05-15"),
            RangePickerLogic.appliedRangeForPreset("all", today, "2020-03-01"),
        )
        assertEquals(null, RangePickerLogic.appliedRangeForPreset("unknown", today, null))
    }

    // ── diffDaysInclusive: the inclusive day count (web `diffDaysInclusive`) ─────────────────────────────

    @Test
    fun diffDaysInclusiveCountsBothEndpointsAndFloorsAtOne() {
        assertEquals(1, RangePickerLogic.diffDaysInclusive("2024-05-15", "2024-05-15"))
        assertEquals(7, RangePickerLogic.diffDaysInclusive("2024-05-09", "2024-05-15"))
        assertEquals(15, RangePickerLogic.diffDaysInclusive("2024-05-01", "2024-05-15"))
        // An inverted range still reports at least one day (web `Math.max(1, …)`).
        assertEquals(1, RangePickerLogic.diffDaysInclusive("2024-05-15", "2024-05-10"))
    }

    // ── formatRange: the trigger sub-label (web `formatRange`, en-dash, year elision) ────────────────────

    @Test
    fun formatRangeRendersASingleLocalizedDayForAOneDayRange() {
        assertEquals("May 15, 2024", RangePickerLogic.formatRange("2024-05-15", "2024-05-15", Locale.US))
    }

    @Test
    fun formatRangeOmitsTheStartYearWhenBothBoundsShareAYear() {
        assertEquals("May 9 – May 15, 2024", RangePickerLogic.formatRange("2024-05-09", "2024-05-15", Locale.US))
    }

    @Test
    fun formatRangeKeepsBothYearsWhenTheRangeCrossesAYearBoundary() {
        assertEquals(
            "Dec 30, 2023 – Jan 2, 2024",
            RangePickerLogic.formatRange("2023-12-30", "2024-01-02", Locale.US),
        )
    }

    // ── staged-dirty + staged day count: the Apply gate + footer (web `stagedDirty` / `stagedDays`) ──────

    @Test
    fun stagedIsDirtyOnlyWhenBothBoundsArePresentAndDiffer() {
        val value = RangePickerValue("2024-05-01", "2024-05-15")
        assertFalse("incomplete staged range is never dirty", RangePickerLogic.stagedIsDirty(null, "2024-05-15", value))
        assertFalse("incomplete staged range is never dirty", RangePickerLogic.stagedIsDirty("2024-05-01", null, value))
        assertFalse("an unchanged range is not dirty", RangePickerLogic.stagedIsDirty("2024-05-01", "2024-05-15", value))
        assertTrue("a changed start is dirty", RangePickerLogic.stagedIsDirty("2024-05-02", "2024-05-15", value))
        assertTrue("a changed end is dirty", RangePickerLogic.stagedIsDirty("2024-05-01", "2024-05-20", value))
    }

    @Test
    fun stagedDayCountIsNullUntilBothBoundsAreStaged() {
        assertEquals(null, RangePickerLogic.stagedDayCount(null, "2024-05-15"))
        assertEquals(null, RangePickerLogic.stagedDayCount("2024-05-01", null))
        assertEquals(7, RangePickerLogic.stagedDayCount("2024-05-09", "2024-05-15"))
    }

    // ── UTC-millis calendar adapter (Material 3 DateRangePicker seam) ────────────────────────────────────

    @Test
    fun isoToUtcMillisIsAStableUtcMidnightRoundTrip() {
        assertEquals(0L, RangePickerLogic.isoToUtcMillis("1970-01-01"))
        assertEquals(RangePickerLogic.MILLIS_PER_DAY, RangePickerLogic.isoToUtcMillis("1970-01-02"))
        assertEquals("2024-05-15", RangePickerLogic.utcMillisToIso(RangePickerLogic.isoToUtcMillis("2024-05-15")))
    }

    // ── trigger accessibility label (merged TalkBack name) ───────────────────────────────────────────────

    @Test
    fun triggerAccessibilityLabelJoinsThePresentParts() {
        assertEquals(
            "Date range, Last 7 days, May 9 – May 15, 2024",
            RangePickerLogic.triggerAccessibilityLabel("Date range", "Last 7 days", "May 9 – May 15, 2024"),
        )
    }

    @Test
    fun triggerAccessibilityLabelSkipsBlankParts() {
        assertEquals("Date range, May 1", RangePickerLogic.triggerAccessibilityLabel("Date range", "  ", "May 1"))
    }

    // ── projection: the rendered trigger (web derived `activePresetId` / sub-label / day count) ──────────

    @Test
    fun projectFoldsAnActivePresetRangeIntoTheTrigger() {
        val display = RangePickerProjection.project(RangePickerValue("2024-05-09", "2024-05-15"), today, Locale.US)
        assertEquals("7d", display.activePresetId)
        assertTrue(display.hasActivePreset)
        assertEquals("May 9 – May 15, 2024", display.rangeText)
        assertEquals(7, display.totalDays)
    }

    @Test
    fun projectFlagsACustomRangeWithNoActivePreset() {
        val display = RangePickerProjection.project(RangePickerValue("2024-05-03", "2024-05-09"), today, Locale.US)
        assertEquals(null, display.activePresetId)
        assertFalse(display.hasActivePreset)
        assertEquals(7, display.totalDays)
    }

    private fun resolve(id: String): RangePickerValue =
        requireNotNull(RangePickerLogic.getDatePreset(id)) { "unknown preset $id" }.resolve(today)
}
