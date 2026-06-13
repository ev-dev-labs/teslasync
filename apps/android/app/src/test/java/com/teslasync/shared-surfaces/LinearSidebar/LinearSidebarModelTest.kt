// Unit tests for the pure [LinearSidebarProjection] + co-located model — the parity-critical derivations the
// web LinearSidebar performs before rendering (web/src/components/layout/sidebar/LinearSidebar.tsx): the
// active-path test, the non-flattening label filter, the default "collapse all but the active section"
// expansion + force-expand-while-searching rule, the quiet trailing badges, the pinned/favorites handling,
// the lifecycle phases and the ADR-013 stale/offline freshness flags. Pure JVM, runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.linearsidebar

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinearSidebarModelTest {
    // ── isActivePath (web isActiveLinearPath) ───────────────────────────────────

    @Test
    fun rootIsActiveOnlyOnExactMatch() {
        assertTrue(LinearSidebarProjection.isActivePath("/", "/"))
        assertFalse(LinearSidebarProjection.isActivePath("/energy", "/"))
    }

    @Test
    fun nonRootIsActiveOnExactOrNestedMatch() {
        assertTrue(LinearSidebarProjection.isActivePath("/energy", "/energy"))
        assertTrue(LinearSidebarProjection.isActivePath("/energy/battery", "/energy"))
        assertFalse(LinearSidebarProjection.isActivePath("/energymonitor", "/energy"))
        assertFalse(LinearSidebarProjection.isActivePath("/charging", "/energy"))
    }

    // ── filter (web matchesFilter, label-only, non-flattening) ──────────────────

    @Test
    fun blankFilterMatchesEverything() {
        assertTrue(LinearSidebarProjection.matchesFilter("Battery Health", emptyList()))
    }

    @Test
    fun everyTokenMustMatchCaseInsensitively() {
        val tokens = LinearSidebarProjection.tokenize("  Battery   HEALTH ")
        assertEquals(listOf("battery", "health"), tokens)
        assertTrue(LinearSidebarProjection.matchesFilter("Battery Health", tokens))
        assertFalse(LinearSidebarProjection.matchesFilter("Battery Cells", tokens))
    }

    @Test
    fun filterNarrowsItemsAndDropsEmptySections() {
        val model = LinearSidebarProjection.project(content(nav()), interaction(filter = "energy"))
        // Only items whose label contains "energy" survive; sections with none drop.
        assertTrue(model.display.isSearching)
        assertEquals(listOf("Energy"), model.display.sections.map { it.title })
        assertEquals(
            listOf("/energy"),
            model.display.sections
                .single()
                .rows
                .map { it.to },
        )
    }

    @Test
    fun filterThatMatchesNothingSurfacesNoResults() {
        val model = LinearSidebarProjection.project(content(nav()), interaction(filter = "zzzz"))
        assertTrue(model.display.noResults)
        assertTrue(model.display.sections.isEmpty())
    }

    // ── default expansion (web: collapse all but the active section) ────────────

    @Test
    fun activeSectionTitleIsTheOneContainingTheActivePage() {
        assertEquals("Energy", LinearSidebarProjection.activeSectionTitle(nav(activePath = "/energy/battery")))
        assertNull(LinearSidebarProjection.activeSectionTitle(nav(activePath = "/nowhere")))
    }

    @Test
    fun defaultCollapsedExpandsOnlyTheActiveSection() {
        val collapsed = LinearSidebarProjection.defaultCollapsed(nav(activePath = "/energy"))
        assertEquals(setOf("Overview", "Alerts"), collapsed)

        val model = LinearSidebarProjection.project(content(nav(activePath = "/energy")), LinearSidebarInteraction(collapsed = collapsed))
        val energy = model.display.sections.single { it.title == "Energy" }
        val overview = model.display.sections.single { it.title == "Overview" }
        assertTrue(energy.expanded)
        assertEquals(2, energy.rows.size)
        assertFalse(overview.expanded)
        assertTrue("collapsed section emits no rows (web DOM)", overview.rows.isEmpty())
        // The header count still reflects the full item count even while collapsed.
        assertEquals(2, overview.itemCount)
    }

    @Test
    fun searchingForceExpandsEveryMatchingSection() {
        // Even with everything collapsed, a search opens the matching sections (web isSearching branch).
        val collapsed = setOf("Overview", "Energy", "Alerts")
        val model = LinearSidebarProjection.project(content(nav()), LinearSidebarInteraction(collapsed = collapsed, filter = "battery"))
        val energy = model.display.sections.single { it.title == "Energy" }
        assertTrue(energy.expanded)
        assertEquals(listOf("/energy/battery"), energy.rows.map { it.to })
    }

    // ── active row + favorites + pinned ─────────────────────────────────────────

    @Test
    fun activeRowIsFlaggedAndFavoritesAreProjected() {
        val model = LinearSidebarProjection.project(content(nav(activePath = "/energy")), interaction())
        val energyRow =
            model.display.sections
                .single { it.title == "Energy" }
                .rows
                .single { it.to == "/energy" }
        assertTrue(energyRow.active)
        assertTrue(model.display.hasFavorites)
        assertEquals(listOf("/vehicles"), model.display.favorites.map { it.to })
        assertTrue("favorites rows are pinned (show unpin)", model.display.favorites.all { it.pinned })
    }

    @Test
    fun aSectionRowAlreadyPinnedIsFlaggedSoItsPinAffordanceHides() {
        val model = LinearSidebarProjection.project(content(nav()), interaction())
        val vehiclesRow =
            model.display.sections
                .single { it.title == "Overview" }
                .rows
                .single { it.to == "/vehicles" }
        assertTrue(vehiclesRow.pinned)
        val dashRow =
            model.display.sections
                .single { it.title == "Overview" }
                .rows
                .single { it.to == "/" }
        assertFalse(dashRow.pinned)
    }

    // ── trailing badges (web trailingFor) ───────────────────────────────────────

    @Test
    fun trailingBadgesMatchTheWebRules() {
        val n = nav(alertCount = 3, vehicleCount = 2, staleCount = 5)
        assertEquals(TrailingBadge.AlertDot, LinearSidebarProjection.trailingFor("/notifications/alerts", n))
        assertEquals(TrailingBadge.Count(2, CountSemantic.Vehicles), LinearSidebarProjection.trailingFor("/vehicles", n))
        assertEquals(TrailingBadge.Count(5, CountSemantic.Stale), LinearSidebarProjection.trailingFor("/data-repair", n))
        assertNull(LinearSidebarProjection.trailingFor("/energy", n))
    }

    @Test
    fun zeroCountsSuppressTheTrailingBadges() {
        val n = nav(alertCount = 0, vehicleCount = 0, staleCount = 0)
        assertNull(LinearSidebarProjection.trailingFor("/notifications/alerts", n))
        assertNull(LinearSidebarProjection.trailingFor("/vehicles", n))
        assertNull(LinearSidebarProjection.trailingFor("/data-repair", n))
    }

    // ── lifecycle phases + freshness (shared toUiState contract) ────────────────

    @Test
    fun loadingWithNoCacheIsTheLoadingPhase() {
        val model = LinearSidebarProjection.project(UiState.loading(), interaction())
        assertEquals(LinearSidebarPhase.Loading, model.display.phase)
        assertTrue(model.display.busy)
    }

    @Test
    fun emptyNavIsTheEmptyPhase() {
        val state = UiState(UiPhase.Empty, data = LinearSidebarNav(emptyList()), fetchedAt = 1L)
        val model = LinearSidebarProjection.project(state, interaction())
        assertEquals(LinearSidebarPhase.Empty, model.display.phase)
        assertFalse(model.display.hasFavorites)
    }

    @Test
    fun hardErrorWithNoCacheIsTheErrorPhaseWithRetry() {
        val state = UiState<LinearSidebarNav>(UiPhase.Error, errorKind = ErrorKind.Network)
        val model = LinearSidebarProjection.project(state, interaction())
        assertEquals(LinearSidebarPhase.Error, model.display.phase)
        assertTrue(model.display.canRetry)
    }

    @Test
    fun staleCacheStaysVisibleWithAStaleChip() {
        val state = UiState(UiPhase.Content, data = nav(), fetchedAt = 1L, stale = true)
        val model = LinearSidebarProjection.project(state, interaction())
        assertEquals(LinearSidebarPhase.Content, model.display.phase)
        assertTrue(model.display.stale)
        assertFalse(model.display.offline)
        assertTrue(model.display.showFreshnessChip)
    }

    @Test
    fun offlineCacheStaysVisibleWithAnOfflineChipAndRetry() {
        val state = UiState(UiPhase.Content, data = nav(), fetchedAt = 1L, stale = true, errorKind = ErrorKind.Network)
        val model = LinearSidebarProjection.project(state, interaction())
        assertEquals(LinearSidebarPhase.Content, model.display.phase)
        assertTrue(model.display.offline)
        assertFalse(model.display.stale)
        assertTrue(model.display.canRetry)
        assertTrue(model.display.sections.isNotEmpty())
    }

    @Test
    fun queryErrorKindFoldsTheFailureTaxonomy() {
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, 401))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, 500))
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private fun kindFor(
        kind: ErrorKind,
        status: Int?,
    ): QueryErrorKind {
        val state = UiState<LinearSidebarNav>(UiPhase.Error, errorKind = kind, httpStatus = status)
        return LinearSidebarProjection.queryErrorKind(LinearSidebarProjection.project(state, interaction()).display)
    }

    private fun interaction(filter: String = ""): LinearSidebarInteraction = LinearSidebarInteraction(filter = filter)

    private fun content(nav: LinearSidebarNav): UiState<LinearSidebarNav> = UiState(UiPhase.Content, data = nav, fetchedAt = 1L)

    private fun nav(
        activePath: String = "/energy",
        alertCount: Int = 0,
        vehicleCount: Int = 0,
        staleCount: Int = 0,
    ): LinearSidebarNav =
        LinearSidebarNav(
            sections =
                listOf(
                    LinearNavSection(
                        "Overview",
                        listOf(
                            LinearNavItem("/", "Dashboard", TeslaGlyphs.Octagon),
                            LinearNavItem("/vehicles", "Vehicles", TeslaGlyphs.Pin),
                        ),
                    ),
                    LinearNavSection(
                        "Energy",
                        listOf(
                            LinearNavItem("/energy", "Energy", TeslaGlyphs.Octagon),
                            LinearNavItem("/energy/battery", "Battery Health", TeslaGlyphs.Octagon),
                        ),
                    ),
                    LinearNavSection(
                        "Alerts",
                        listOf(LinearNavItem("/notifications/alerts", "Alerts", TeslaGlyphs.Warning)),
                    ),
                ),
            pinnedItems = listOf(LinearNavItem("/vehicles", "Vehicles", TeslaGlyphs.Pin)),
            activePath = activePath,
            alertCount = alertCount,
            vehicleCount = vehicleCount,
            staleCount = staleCount,
        )
}
