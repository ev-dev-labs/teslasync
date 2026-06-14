// Off-device unit coverage for the StickyChipBar surface's pure model (P3 acceptance: the adapter unit test).
// Exercises the registration slug the prompt mandates, the empty / populated projection branches that mirror
// the web `chips.length === 0` vs `chips.map(...)` outcomes, the per-chip active flag (web `chip.id ===
// activeId`), the initial-active seed (web `useState(chips[0]?.id ?? '')`), the re-derivation that drops a
// stale highlight, the top-most-visible ordering the web `IntersectionObserver` reduce performs, the i18n key
// inventory, and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. Reference values are the strings + behaviour the web `StickyChipBar` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.stickychipbar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StickyChipBarModelTest {
    private val chips =
        listOf(
            ChipItem(id = "a", label = "A"),
            ChipItem(id = "b", label = "B"),
            ChipItem(id = "c", label = "C"),
        )

    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("stickyChipBar", StickyChipBarRegistration.ID)
        assertEquals("StickyChipBar", StickyChipBarRegistration.SLUG)
    }

    // ── projection: empty / populated branches ────────────────────────────────────────

    @Test
    fun emptyChipsProjectTheEmptyBranch() {
        assertEquals(StickyChipBarProjection.Empty, StickyChipBarProjection.project(emptyList(), activeId = "x"))
    }

    @Test
    fun populatedChipsProjectResolvedMarkingOnlyTheActiveOne() {
        val resolved = StickyChipBarProjection.project(chips, activeId = "b") as StickyChipBarProjection.Resolved
        assertEquals(listOf("a", "b", "c"), resolved.chips.map { it.id })
        assertEquals(listOf("A", "B", "C"), resolved.chips.map { it.label })
        assertEquals(listOf(false, true, false), resolved.chips.map { it.active })
    }

    @Test
    fun noChipIsActiveWhenActiveIdMatchesNothing() {
        val resolved = StickyChipBarProjection.project(chips, activeId = "missing") as StickyChipBarProjection.Resolved
        assertTrue(resolved.chips.none { it.active })
    }

    // ── initial active seed (web useState(chips[0]?.id ?? '')) ─────────────────────────

    @Test
    fun initialActiveIdIsTheFirstChipOrEmpty() {
        assertEquals("a", initialActiveId(chips))
        assertEquals("", initialActiveId(emptyList()))
    }

    // ── re-derivation as the chip set changes ─────────────────────────────────────────

    @Test
    fun resolveActiveIdKeepsAStillPresentSelection() {
        assertEquals("b", resolveActiveId(chips, current = "b"))
    }

    @Test
    fun resolveActiveIdFallsBackToFirstWhenTheSelectionLeaves() {
        assertEquals("a", resolveActiveId(chips, current = "gone"))
    }

    @Test
    fun resolveActiveIdIsEmptyWhenThereAreNoChips() {
        assertEquals("", resolveActiveId(emptyList(), current = "a"))
    }

    // ── top-most visible (web IntersectionObserver reduce) ────────────────────────────

    @Test
    fun topMostVisibleIdPicksTheEarliestVisibleInDocumentOrder() {
        val order = listOf("a", "b", "c", "d")
        assertEquals("b", topMostVisibleId(visibleIds = listOf("c", "b"), order = order))
    }

    @Test
    fun topMostVisibleIdIgnoresIdsNotInTheChipOrder() {
        assertEquals("a", topMostVisibleId(visibleIds = listOf("z", "a"), order = listOf("a", "b")))
    }

    @Test
    fun topMostVisibleIdIsNullWhenNothingIsVisible() {
        assertNull(topMostVisibleId(visibleIds = emptyList(), order = listOf("a", "b")))
    }

    // ── i18n inventory (the catalog keys this surface resolves) ───────────────────────

    @Test
    fun keyInventoryIsCompleteAndUnique() {
        assertEquals(2, StickyChipBarKeys.ALL.size)
        assertEquals(StickyChipBarKeys.ALL.size, StickyChipBarKeys.ALL.toSet().size)
        assertTrue(StickyChipBarKeys.ALL.containsAll(listOf(StickyChipBarKeys.NAV_LABEL, StickyChipBarKeys.EMPTY)))
    }

    // ── diagnostics: PII-safe view.opened ─────────────────────────────────────────────

    @Test
    fun recordOpenedEmitsSlugOnlyDiagnostic() {
        val logger = RecordingLogger()
        recordStickyChipBarOpened(logger)
        val record = logger.records.single { it.event == "view.opened" }
        assertEquals(mapOf("surface" to "StickyChipBar"), record.fields)
    }
}
