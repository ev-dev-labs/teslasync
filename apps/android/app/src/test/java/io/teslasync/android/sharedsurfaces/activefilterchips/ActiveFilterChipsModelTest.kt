// Off-device unit tests for the pure ActiveFilterChips model: the visible/overflow partition (the web `useMemo`,
// covering the all-inline, overflow-reserve, and maxVisible<=0 branches), the surface classifier (the web
// `hideWhenEmpty && isEmpty` split, covering hidden / empty-shown / content), the live-region re-announce padding
// (web `'\u200B'.repeat(counter % 4)`) plus the production announcer's round-trip, the per-chip accessibility
// label, the i18n key inventory (every web `t(key)` this surface makes), the diagnostics slug, and the PII-safe
// `view.opened` diagnostic. Run by the offline :android:testReleaseUnitTest gate — no Compose, no Android.

package io.teslasync.android.sharedsurfaces.activefilterchips

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ActiveFilterChipsModelTest {
    // ── Partition (web useMemo visible/overflow split) ──────────────────────────────────────────────────────────
    @Test
    fun partitionShowsEveryChipWhenWithinBudget() {
        val filters = listOf("a", "b", "c")
        val partition = partitionChips(filters, maxVisible = 8)
        assertEquals(filters, partition.visible)
        assertEquals(emptyList<String>(), partition.overflow)
    }

    @Test
    fun partitionReservesOneSlotForTheMoreTrigger() {
        val filters = (1..10).map { "f$it" }
        val partition = partitionChips(filters, maxVisible = 4)
        // One inline slot is reserved for "+N more", so 3 stay inline and 7 overflow.
        assertEquals(listOf("f1", "f2", "f3"), partition.visible)
        assertEquals(listOf("f4", "f5", "f6", "f7", "f8", "f9", "f10"), partition.overflow)
    }

    @Test
    fun partitionCollapsesEverythingWhenBudgetIsNonPositive() {
        val filters = listOf("a", "b")
        val partition = partitionChips(filters, maxVisible = 0)
        assertEquals(emptyList<String>(), partition.visible)
        assertEquals(filters, partition.overflow)
    }

    // ── Surface classifier (web hideWhenEmpty && isEmpty) ───────────────────────────────────────────────────────
    @Test
    fun classifierHidesOnlyWhenEmptyAndHiding() {
        assertEquals(ChipsSurface.Hidden, chipsSurface(filterCount = 0, hideWhenEmpty = true))
        assertEquals(ChipsSurface.Visible, chipsSurface(filterCount = 0, hideWhenEmpty = false))
        assertEquals(ChipsSurface.Visible, chipsSurface(filterCount = 3, hideWhenEmpty = true))
        assertEquals(ChipsSurface.Visible, chipsSurface(filterCount = 3, hideWhenEmpty = false))
    }

    // ── Re-announce padding (web '\u200B'.repeat(counter % 4)) ───────────────────────────────────────────────────
    @Test
    fun reannouncePaddingCyclesEveryFour() {
        assertEquals("", reannouncePadding(0))
        assertEquals(ZERO_WIDTH_SPACE, reannouncePadding(1))
        assertEquals(ZERO_WIDTH_SPACE.repeat(2), reannouncePadding(2))
        assertEquals(ZERO_WIDTH_SPACE.repeat(3), reannouncePadding(3))
        assertEquals("", reannouncePadding(4))
        assertEquals(ZERO_WIDTH_SPACE, reannouncePadding(5))
    }

    @Test
    fun liveAnnouncerReFiresAnIdenticalMessage() {
        val announcer = LiveFilterAnnouncer()
        announcer.announce("Filter removed: Vehicle")
        val first = announcer.announcement.value
        announcer.announce("Filter removed: Vehicle")
        val second = announcer.announcement.value

        assertTrue(first.startsWith("Filter removed: Vehicle"))
        assertTrue(second.startsWith("Filter removed: Vehicle"))
        // The invisible padding differs so assistive tech re-reads even an identical message.
        assertNotEquals(first, second)
    }

    // ── Accessibility (per-chip label) ──────────────────────────────────────────────────────────────────────────
    @Test
    fun chipContentDescriptionJoinsLabelAndValue() {
        assertEquals("Vehicle: Model 3", chipContentDescription(label = "Vehicle", value = "Model 3"))
    }

    // ── i18n inventory (every web t(key) this surface makes) ────────────────────────────────────────────────────
    @Test
    fun keyInventoryIsCompleteUniqueAndPrefixed() {
        assertEquals(7, ActiveFilterChipsKeys.ALL.size)
        assertEquals(ActiveFilterChipsKeys.ALL.size, ActiveFilterChipsKeys.ALL.toSet().size)
        assertTrue(ActiveFilterChipsKeys.ALL.all { it.startsWith("filters.") })
        assertTrue(
            ActiveFilterChipsKeys.ALL.containsAll(
                listOf(
                    ActiveFilterChipsKeys.REMOVED,
                    ActiveFilterChipsKeys.CLEARED_ALL,
                    ActiveFilterChipsKeys.ACTIVE_LABEL,
                    ActiveFilterChipsKeys.MORE_COUNT,
                    ActiveFilterChipsKeys.MORE_LABEL,
                    ActiveFilterChipsKeys.CLEAR_ALL,
                    ActiveFilterChipsKeys.REMOVE_ARIA,
                ),
            ),
        )
    }

    // ── Telemetry (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun slugCarriesNoPii() {
        assertEquals("ActiveFilterChips", ACTIVE_FILTER_CHIPS_SLUG)
    }

    @Test
    fun recordViewOpenedEmitsSlugOnly() {
        val logger = RecordingLogger()
        recordActiveFilterChipsViewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("slug" to "ActiveFilterChips"), opened.second)
    }
}
