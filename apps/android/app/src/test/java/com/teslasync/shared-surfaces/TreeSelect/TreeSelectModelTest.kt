// Unit tests for the pure [TreeSelectProjection] + co-located model — the parity-critical derivations the web
// TreeSelect performs before rendering (web/src/components/forms/TreeSelect.tsx): the non-flattening search
// filter, the block selection toggles (preserving out-of-filter + disabled picks), the per-group / select-all
// tri-state, the visible/total counts, the force-expand-while-searching rule, the disabled-leaf handling, the
// lifecycle phases and the ADR-013 stale/offline freshness flags. Pure JVM, runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.treeselect

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.forms.TreeGroup
import io.teslasync.android.components.forms.TreeLeaf
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class TreeSelectModelTest {
    // ── filterGroups (non-flattening search) ────────────────────────────────────

    @Test
    fun filterReturnsSameReferenceForBlankQuery() {
        val groups = catalog()
        assertSame(groups, TreeSelectProjection.filterGroups(groups, "   "))
    }

    @Test
    fun filterKeepsAllLeavesWhenGroupLabelMatches() {
        val filtered = TreeSelectProjection.filterGroups(catalog(), "Battery")
        assertEquals(1, filtered.size)
        assertEquals("battery", filtered.first().id)
        assertEquals(2, filtered.first().leaves.size)
    }

    @Test
    fun filterKeepsOnlyMatchingLeavesAndDropsEmptyGroups() {
        val filtered = TreeSelectProjection.filterGroups(catalog(), "speed")
        assertEquals(1, filtered.size)
        assertEquals("powertrain", filtered.first().id)
        assertEquals(listOf("speed"), filtered.first().leaves.map { it.value })
    }

    @Test
    fun filterIsCaseInsensitive() {
        val filtered = TreeSelectProjection.filterGroups(catalog(), "MOTOR")
        assertEquals(listOf("rpm"), filtered.flatMap { g -> g.leaves.map { it.value } })
    }

    // ── selection toggles ───────────────────────────────────────────────────────

    @Test
    fun toggleLeafAddsThenRemoves() {
        val once = TreeSelectProjection.toggleLeaf(emptySet(), "speed")
        assertEquals(setOf("speed"), once)
        assertEquals(emptySet<String>(), TreeSelectProjection.toggleLeaf(once, "speed"))
    }

    @Test
    fun toggleIdsAddsWhenAnyMissingAndClearsWhenAllPresent() {
        assertEquals(setOf("a", "b"), TreeSelectProjection.toggleIds(setOf("a"), listOf("a", "b")))
        assertEquals(emptySet<String>(), TreeSelectProjection.toggleIds(setOf("a", "b"), listOf("a", "b")))
        assertEquals(setOf("a"), TreeSelectProjection.toggleIds(setOf("a"), emptyList()))
    }

    @Test
    fun toggleGroupSelectsVisibleEnabledAndPreservesOutOfFilterPicks() {
        val next =
            TreeSelectProjection.toggleGroup(
                catalog(),
                query = "",
                groupId = "powertrain",
                selected = setOf("soc"),
                disabled = emptySet(),
            )
        assertEquals(setOf("soc", "speed", "rpm"), next)
    }

    @Test
    fun toggleGroupSkipsDisabledLeaves() {
        val next =
            TreeSelectProjection.toggleGroup(
                catalog(),
                query = "",
                groupId = "powertrain",
                selected = emptySet(),
                disabled = setOf("rpm"),
            )
        assertEquals(setOf("speed"), next)
    }

    @Test
    fun toggleAllVisibleOnlyTouchesFilteredEnabledLeaves() {
        assertEquals(setOf("speed", "rpm", "soc", "temp"), TreeSelectProjection.toggleAllVisible(catalog(), "", emptySet(), emptySet()))
        assertEquals(setOf("speed"), TreeSelectProjection.toggleAllVisible(catalog(), "speed", emptySet(), emptySet()))
    }

    // ── lifecycle phases ─────────────────────────────────────────────────────────

    @Test
    fun phaseMirrorsTheBoundFeed() {
        assertEquals(TreeSelectPhase.Loading, project(UiState.loading()).display.phase)
        assertEquals(TreeSelectPhase.Empty, project(UiState(UiPhase.Empty, emptyList())).display.phase)
        assertEquals(TreeSelectPhase.Content, content().display.phase)
        val error = project(UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = SERVER_ERROR))
        assertEquals(TreeSelectPhase.Error, error.display.phase)
        assertTrue(error.display.canRetry)
    }

    @Test
    fun noResultsWhenSearchEliminatesEveryLeaf() {
        val display = content(search = "zzz").display
        assertEquals(TreeSelectPhase.Content, display.phase)
        assertTrue(display.noResults)
        assertFalse(display.showTree)
    }

    // ── tri-state + counts ─────────────────────────────────────────────────────

    @Test
    fun groupTriStateReflectsSelection() {
        assertEquals(GroupSelectionState.None, groupRow(content(expanded = setOf("powertrain"))).selectionState)
        val partial = groupRow(content(selected = setOf("speed"), expanded = setOf("powertrain")))
        assertEquals(GroupSelectionState.Partial, partial.selectionState)
        val all = groupRow(content(selected = setOf("speed", "rpm"), expanded = setOf("powertrain")))
        assertEquals(GroupSelectionState.All, all.selectionState)
    }

    @Test
    fun groupCountsCoverAllLeavesRegardlessOfExpansion() {
        val row = groupRow(content(selected = setOf("speed")))
        assertEquals(1, row.selectedCount)
        assertEquals(2, row.totalCount)
    }

    @Test
    fun selectAllTriStateAndCountsAreFilterAware() {
        val all = content(selected = setOf("speed", "rpm", "soc", "temp")).display
        assertEquals(GroupSelectionState.All, all.selectAllState)
        assertEquals(4, all.totalLeafCount)

        val searched = content(selected = setOf("speed"), search = "speed").display
        assertEquals(4, searched.totalLeafCount)
        assertEquals(1, searched.visibleLeafCount)
        assertEquals(1, searched.visibleSelectedCount)
        assertEquals(GroupSelectionState.All, searched.selectAllState)
        assertTrue(searched.isSearching)
    }

    // ── expansion ───────────────────────────────────────────────────────────────

    @Test
    fun groupLeavesAreEmittedOnlyWhenExpanded() {
        assertEquals(0, groupRow(content()).leaves.size)
        assertEquals(2, groupRow(content(expanded = setOf("powertrain"))).leaves.size)
    }

    @Test
    fun searchForcesEveryGroupExpanded() {
        val display = content(search = "charge").display
        assertTrue(display.groups.all { it.expanded })
        val onlyGroup = display.groups.single()
        assertEquals(listOf("soc"), onlyGroup.leaves.map { it.id })
    }

    // ── disabled leaves ───────────────────────────────────────────────────────

    @Test
    fun disabledLeafIsVisibleUncheckableAndCarriesItsReason() {
        val row = groupRow(content(expanded = setOf("powertrain"), disabled = setOf("rpm"), reasons = mapOf("rpm" to "unavailable")))
        val rpm = row.leaves.single { it.id == "rpm" }
        assertTrue(rpm.disabled)
        assertEquals("unavailable", rpm.disabledReason)
        assertTrue(row.toggleEnabled)
    }

    @Test
    fun groupToggleIsDisabledWhenEveryLeafIsDisabled() {
        val row = groupRow(content(expanded = setOf("powertrain"), disabled = setOf("speed", "rpm")))
        assertFalse(row.toggleEnabled)
    }

    // ── freshness ─────────────────────────────────────────────────────────────

    @Test
    fun staleCacheIsFlaggedStaleNotOffline() {
        val display = project(UiState(UiPhase.Content, catalog(), stale = true)).display
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun failedRefreshCacheIsFlaggedOfflineWithRetry() {
        val display = project(UiState(UiPhase.Content, catalog(), stale = true, errorKind = ErrorKind.Network)).display
        assertTrue(display.offline)
        assertFalse(display.stale)
        assertTrue(display.canRetry)
    }

    @Test
    fun queryErrorKindMapsTheFailureTaxonomy() {
        assertEquals(QueryErrorKind.NotFound, errorKindFor(ErrorKind.Http, NOT_FOUND))
        assertEquals(QueryErrorKind.Unauthorized, errorKindFor(ErrorKind.Http, UNAUTHORIZED))
        assertEquals(QueryErrorKind.ServerError, errorKindFor(ErrorKind.Http, SERVER_ERROR))
        assertEquals(QueryErrorKind.Network, errorKindFor(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Waiting, errorKindFor(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.ServerError, errorKindFor(ErrorKind.Unknown, null))
    }

    // ── helpers ─────────────────────────────────────────────────────────────────

    private fun catalog(): List<TreeGroup> =
        listOf(
            TreeGroup("powertrain", "Powertrain", listOf(TreeLeaf("speed", "Vehicle speed"), TreeLeaf("rpm", "Motor RPM"))),
            TreeGroup("battery", "Battery", listOf(TreeLeaf("soc", "State of charge"), TreeLeaf("temp", "Pack temperature"))),
        )

    private fun project(state: UiState<List<TreeGroup>>): TreeSelectUiModel = TreeSelectProjection.project(state, TreeSelectInteraction())

    private fun content(
        selected: Set<String> = emptySet(),
        search: String = "",
        expanded: Set<String> = emptySet(),
        disabled: Set<String> = emptySet(),
        reasons: Map<String, String> = emptyMap(),
    ): TreeSelectUiModel =
        TreeSelectProjection.project(
            state = UiState(UiPhase.Content, catalog(), fetchedAt = STAMP),
            interaction =
                TreeSelectInteraction(
                    selectedIds = selected,
                    searchQuery = search,
                    expandedIds = expanded,
                    disabledIds = disabled,
                    disabledReasons = reasons,
                ),
        )

    private fun groupRow(model: TreeSelectUiModel): TreeSelectGroupRow = model.display.groups.first { it.id == "powertrain" }

    private fun errorKindFor(
        kind: ErrorKind,
        status: Int?,
    ): QueryErrorKind =
        TreeSelectProjection.queryErrorKind(
            project(UiState(UiPhase.Error, errorKind = kind, httpStatus = status)).display,
        )

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val NOT_FOUND = 404
        const val UNAUTHORIZED = 401
        const val SERVER_ERROR = 503
    }
}
