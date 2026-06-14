// Unit tests for the pure [NotionSidebarProjection] + co-located model — the parity-critical derivations the
// web NotionSidebar performs before rendering (web/src/components/layout/sidebar/NotionSidebar.tsx): the
// active-path rule, the non-flattening tokenized filter, the favorites group, the per-section filter / drop /
// expand / force-expand-while-searching / borrowed-glyph logic, the pin-vs-unpin per-row flag, the trailing
// badges, the "No matches." branch, the initial collapsed set and the PII-safe diagnostic slug. Pure JVM, runs
// in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.notionsidebar

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotionSidebarModelTest {
    // ── isActivePath (web isActiveNotionPath) ────────────────────────────────────

    @Test
    fun rootIsActiveOnlyForTheExactRoot() {
        assertTrue(NotionSidebarProjection.isActivePath("/", "/"))
        assertFalse(NotionSidebarProjection.isActivePath("/charging", "/"))
    }

    @Test
    fun nonRootMatchesExactOrDescendantButNotSibling() {
        assertTrue(NotionSidebarProjection.isActivePath("/charging", "/charging"))
        assertTrue(NotionSidebarProjection.isActivePath("/charging/123", "/charging"))
        assertFalse(NotionSidebarProjection.isActivePath("/charging-curve", "/charging"))
    }

    @Test
    fun activePathNormalizesTrailingSlashAndQuery() {
        assertTrue(NotionSidebarProjection.isActivePath("/charging/", "/charging"))
        assertTrue(NotionSidebarProjection.isActivePath("/charging?tab=1", "/charging"))
    }

    // ── filter tokenization + matching ───────────────────────────────────────────

    @Test
    fun emptyNeedleProducesNoTokensAndMatchesEverything() {
        assertEquals(emptyList<String>(), NotionSidebarProjection.filterTokens("   "))
        assertTrue(NotionSidebarProjection.matches("Anything", emptyList()))
    }

    @Test
    fun matchingIsCaseInsensitiveAndRequiresEveryToken() {
        val tokens = NotionSidebarProjection.filterTokens("  Charge  Curve ")
        assertEquals(listOf("charge", "curve"), tokens)
        assertTrue(NotionSidebarProjection.matches("Charge Curve Analysis", tokens))
        assertFalse(NotionSidebarProjection.matches("Charge Schedule", tokens))
    }

    // ── trailing badges (web trailingFor) ────────────────────────────────────────

    @Test
    fun trailingForReproducesEveryWebBranch() {
        assertEquals(
            NotionTrailingBadge.Dot,
            NotionSidebarProjection.trailingFor(NotionSidebarProjection.ALERTS_PATH, alertCount = 4, vehicleCount = 0, staleCount = 0),
        )
        assertEquals(
            NotionTrailingBadge.Count(3, NotionCountKind.Vehicles),
            NotionSidebarProjection.trailingFor(
                NotionSidebarProjection.VEHICLES_PATH,
                alertCount = 0,
                vehicleCount = 3,
                staleCount = 0,
            ),
        )
        assertEquals(
            NotionTrailingBadge.Count(12, NotionCountKind.Stale),
            NotionSidebarProjection.trailingFor(
                NotionSidebarProjection.DATA_REPAIR_PATH,
                alertCount = 0,
                vehicleCount = 0,
                staleCount = 12,
            ),
        )
    }

    @Test
    fun trailingForIsNullWhenCountIsZeroOrRouteUnmatched() {
        assertNull(NotionSidebarProjection.trailingFor(NotionSidebarProjection.ALERTS_PATH, 0, 0, 0))
        assertNull(NotionSidebarProjection.trailingFor("/charging", alertCount = 9, vehicleCount = 9, staleCount = 9))
    }

    @Test
    fun countChipCapsAtNinetyNinePlus() {
        assertEquals("5", NotionTrailingBadge.Count(5, NotionCountKind.Vehicles).displayText)
        assertEquals("99+", NotionTrailingBadge.Count(150, NotionCountKind.Vehicles).displayText)
    }

    // ── favorites group ───────────────────────────────────────────────────────────

    @Test
    fun favoritesShowWhenPinnedAndEachCarriesUnpinState() {
        val display = project(input())
        assertTrue(display.showFavorites)
        assertEquals(listOf("/", "/vehicles"), display.favorites.map { it.to })
        assertTrue(display.favorites.all { it.pinned })
    }

    @Test
    fun favoritesGroupStaysVisibleEvenWhenFilterHidesEveryPin() {
        val display = project(input(), filter = "zzz")
        assertTrue(display.showFavorites)
        assertTrue(display.favorites.isEmpty())
    }

    @Test
    fun favoritesAreHiddenWhenThereAreNoPins() {
        val display = project(input(pinned = emptyList()))
        assertFalse(display.showFavorites)
        assertTrue(display.favorites.isEmpty())
    }

    // ── sections: filter / drop / counts / expansion ─────────────────────────────

    @Test
    fun sectionsRenderFilteredItemsWithFilteredCounts() {
        val display = project(input())
        assertEquals(listOf("Charging", "Fleet"), display.sections.map { it.title })
        assertEquals(2, display.sections.first { it.title == "Charging" }.count)
    }

    @Test
    fun emptySectionsAreDroppedAndCountReflectsTheFilter() {
        val display = project(input(), filter = "curves")
        assertEquals(listOf("Charging"), display.sections.map { it.title })
        val charging = display.sections.single()
        assertEquals(1, charging.count)
        assertEquals(listOf("/charging/curves"), charging.items.map { it.to })
    }

    @Test
    fun collapsedSectionEmitsNoRowsButKeepsItsCount() {
        val display = project(input(), collapsed = setOf("Fleet"))
        val fleet = display.sections.first { it.title == "Fleet" }
        assertFalse(fleet.expanded)
        assertEquals(2, fleet.count)
        assertTrue(fleet.items.isEmpty())
    }

    @Test
    fun searchForcesEverySurvivingSectionExpanded() {
        val display = project(input(), filter = "charging", collapsed = setOf("Charging", "Fleet"))
        assertTrue(display.sections.all { it.expanded })
        assertEquals(listOf("Charging"), display.sections.map { it.title })
    }

    @Test
    fun sectionGlyphIsBorrowedFromTheFirstFilteredItem() {
        // No filter -> first item is "/charging" (no accent).
        assertNull(project(input()).sections.first { it.title == "Charging" }.iconColor)
        // Filter to the curves item -> the section glyph becomes that item's accent.
        assertEquals(ACCENT, project(input(), filter = "curves").sections.single().iconColor)
    }

    @Test
    fun sectionRowsCarryPinnedStateFromThePinSet() {
        val display = project(input())
        val fleet = display.sections.first { it.title == "Fleet" }
        // "/vehicles" is pinned; "/data-repair" is not.
        assertTrue(fleet.items.first { it.to == "/vehicles" }.pinned)
        assertFalse(fleet.items.first { it.to == "/data-repair" }.pinned)
    }

    @Test
    fun sectionRowsCarryTrailingBadges() {
        val fleet = project(input()).sections.first { it.title == "Fleet" }
        assertEquals(NotionTrailingBadge.Count(3, NotionCountKind.Vehicles), fleet.items.first { it.to == "/vehicles" }.trailing)
        assertEquals(NotionTrailingBadge.Count(12, NotionCountKind.Stale), fleet.items.first { it.to == "/data-repair" }.trailing)
    }

    // ── no-results branch ─────────────────────────────────────────────────────────

    @Test
    fun noResultsWhenSearchEliminatesEverySection() {
        val display = project(input(), filter = "zzz")
        assertTrue(display.showNoResults)
        assertTrue(display.sections.isEmpty())
    }

    @Test
    fun noResultsIsFalseWithoutASearch() {
        assertFalse(project(input()).showNoResults)
    }

    // ── active row ──────────────────────────────────────────────────────────────

    @Test
    fun activeRowResolvesAcrossFavoritesAndSections() {
        assertEquals("/charging", project(input(), currentPath = "/charging/abc").activeRow?.to)
        assertEquals("/", project(input(), currentPath = "/").activeRow?.to)
        assertNull(project(input(), currentPath = "/settings").activeRow)
    }

    // ── initial collapsed set ─────────────────────────────────────────────────────

    @Test
    fun initialCollapsedIsEverySectionExceptTheActiveOne() {
        assertEquals(setOf("Fleet"), NotionSidebarProjection.initialCollapsed(input()))
        assertEquals(setOf("Charging", "Fleet"), NotionSidebarProjection.initialCollapsed(input(active = null)))
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────

    @Test
    fun diagnosticEmitsTheSurfaceSlugOnly() {
        val logger = RecordingLogger()
        NotionSidebarDiagnostics.recordViewOpened(logger)
        assertEquals("NotionSidebar", NotionSidebarDiagnostics.SLUG)
        assertEquals(1, logger.records.size)
        assertEquals("view.opened", logger.records.single().event)
        assertEquals(mapOf("surface" to "NotionSidebar"), logger.records.single().fields)
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private fun project(
        input: NotionSidebarInput,
        currentPath: String = "/",
        filter: String = "",
        collapsed: Set<String> = emptySet(),
    ): NotionSidebarDisplay = NotionSidebarProjection.project(input, currentPath, filter, collapsed, strings())

    private fun strings(): NotionSidebarStrings =
        NotionSidebarStrings(
            navLabel = "Sidebar navigation",
            favorites = "Favorites",
            pages = "Pages",
            filterNoMatch = "No matches.",
            filterClear = "Clear filter",
        )

    private fun input(
        pinned: List<NotionNavItem> = listOf(item("/", "Dashboard"), item("/vehicles", "Vehicles")),
        active: String? = "Charging",
    ): NotionSidebarInput =
        NotionSidebarInput(
            sections =
                listOf(
                    NotionSidebarSection(
                        title = "Charging",
                        items = listOf(item("/charging", "Charging"), item("/charging/curves", "Charging Curves", ACCENT)),
                    ),
                    NotionSidebarSection(
                        title = "Fleet",
                        items = listOf(item("/vehicles", "Vehicles"), item("/data-repair", "Data Repair")),
                    ),
                ),
            pinnedItems = pinned,
            activeSectionTitle = active,
            alertCount = 0,
            vehicleCount = 3,
            staleCount = 12,
        )

    private fun item(
        to: String,
        label: String,
        color: Color? = null,
    ): NotionNavItem = NotionNavItem(to = to, label = label, icon = GLYPH, iconColor = color)

    private companion object {
        val GLYPH: ImageVector = ImageVector.Builder("test-glyph", 1.dp, 1.dp, 1f, 1f).build()
        val ACCENT: Color = Color(0xFF00E5FF)
    }
}
