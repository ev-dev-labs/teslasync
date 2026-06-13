// Pure, framework-free model + projection for the TreeSelect shared surface — the native analogue of
// everything the web component derives before returning JSX (web/src/components/forms/TreeSelect.tsx). No
// Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web `TreeSelect` is the shared two-level (groups → leaves) tri-state multi-select primitive used by
// signal pickers, column choosers and vehicle filters. It is a controlled component: the parent owns the
// `groups` catalog, the `selectedIds`, the `searchValue` and the expanded-group ids, and the component only
// derives the filtered view, the per-group tri-state, the visible/selected counts and the select-all state.
// This native surface keeps that contract by binding the catalog through the shared S8 state-holder seam
// ([TreeSelectSource]) — never HTTP of its own — and projects the resulting cache-then-network feed (folded
// once by the canonical [io.teslasync.android.data.toUiState]) onto the full lifecycle the prompt mandates:
// loading / content / empty / error, plus the ADR-013 stale·refreshing·offline freshness flags carried over
// cached rows, plus the web source's own "no results after filter" branch.
//
// On top of the lifecycle this reproduces the rest of the web source's derivations exactly: the
// search filter that narrows the tree without flattening it (a matching group keeps all of its leaves,
// otherwise only matching leaves survive, empty groups drop), the force-expand-while-searching rule, the
// per-group tri-state (none/partial/all) computed over the visible-and-enabled leaves, the per-group
// `{selected}/{total}` counts, the top-level select-all/clear state, and the disabled-leaf predicate
// (disabled leaves stay visible but uncheckable, and group / select-all actions only touch enabled leaves).
//
// Selection is independent of the filter: leaves selected then filtered out of view stay selected, and group
// / "select visible" actions only ever affect currently-visible (filtered) leaves — matching the web source
// so clearing the search never silently drops picks.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/TreeSelect — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.treeselect

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.forms.TreeGroup
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug is pinned here so the native and web surfaces stay in lockstep.
 */
object TreeSelectRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TreeSelect"
}

/**
 * The mutually-exclusive primary surface the tree body renders for the bound catalog feed — the native
 * mirror of the web TreeSelect's body branches (the skeleton chrome, the tree, the empty-catalog row)
 * extended with the explicit error surface the prompt's state matrix mandates. Freshness
 * (stale/refreshing/offline) and the search-eliminated-everything "no results" branch are carried as
 * orthogonal flags on [TreeSelectDisplay] so cached rows stay visible while a chip is shown.
 */
enum class TreeSelectPhase {
    /** A first catalog load is in flight with nothing cached — shimmering skeleton chrome (web `isLoading`). */
    Loading,

    /** The catalog resolved with one or more groups — render the tree (fresh or cached). */
    Content,

    /** The catalog resolved with zero groups — a friendly empty row, never a blank box (web `emptyState`). */
    Empty,

    /** A hard catalog-load failure with nothing cached to fall back on — an error surface with retry. */
    Error,
}

/**
 * Tri-state of a group / the top-level select-all control — the native mirror of the web checkbox's
 * `checked` + `indeterminate` pair. [None] = no visible-enabled leaf selected, [All] = every visible-enabled
 * leaf selected, [Partial] = some-but-not-all (the "mixed" / indeterminate state).
 */
enum class GroupSelectionState { None, Partial, All }

/**
 * One render-ready leaf row — a leaf enriched with the three flags the web `<div role="treeitem">` carries:
 * whether it is currently [selected], whether it is [disabled] (visible but uncheckable), and the optional
 * [disabledReason] surfaced to the user / screen reader (web `getLeafDisabledReason`).
 */
data class TreeSelectLeafRow(
    val id: String,
    val label: String,
    val selected: Boolean,
    val disabled: Boolean,
    val disabledReason: String?,
)

/**
 * One render-ready group row — the filtered group enriched with everything the web group header derives: its
 * tri-state [selectionState] over the visible-and-enabled leaves, the `{selectedCount}/{totalCount}` counts,
 * whether it is [expanded] (force-true while searching), whether its checkbox is [toggleEnabled] (at least
 * one visible-and-enabled leaf), and the projected [leaves] (empty while collapsed, mirroring the web DOM).
 */
data class TreeSelectGroupRow(
    val id: String,
    val label: String,
    val selectionState: GroupSelectionState,
    val selectedCount: Int,
    val totalCount: Int,
    val expanded: Boolean,
    val toggleEnabled: Boolean,
    val leaves: List<TreeSelectLeafRow>,
)

/**
 * The projected, render-ready tree state — everything the web component computes before mapping it to rows,
 * plus the ADR-013 freshness flags.
 *
 * @property phase the primary body surface to render.
 * @property groups the filtered, projected group rows (web `filtered.map(...)`).
 * @property noResults true when the catalog has groups but the search filter eliminated them all (web `showNoResults`).
 * @property isSearching whether a non-blank search needle is active (web `isSearching`).
 * @property totalLeafCount leaves across ALL groups, unfiltered (web `totalLeafCount`).
 * @property visibleLeafCount leaves across the filtered groups (web `visibleLeafIds.length`).
 * @property selectedCount total selected leaf ids, filter-independent (web `selectedIds.length`).
 * @property visibleSelectedCount selected leaves that are currently visible (web `visibleSelectedCount`).
 * @property selectAllState the top-level select-all tri-state over the visible leaves.
 * @property selectAllEnabled whether the select-all control is actionable (any visible leaf — web disabled rule).
 * @property stale whether the shown rows are flagged stale (older than TTL, refresh in flight, no failure).
 * @property offline whether cached rows are shown because a refresh failed (network unreachable).
 * @property refreshing whether a refresh is currently running over already-shown rows.
 * @property errorKind the classification of the most recent failure, or `null` when there is none.
 * @property httpStatus the HTTP status when [errorKind] is [ErrorKind.Http], else `null`.
 * @property canRetry whether a retry affordance should be offered (hard error, or stale/offline cache).
 * @property freshnessStamp the `fetchedAt` of the shown rows; keys the stale auto-refresh effect.
 */
data class TreeSelectDisplay(
    val phase: TreeSelectPhase,
    val groups: List<TreeSelectGroupRow> = emptyList(),
    val noResults: Boolean = false,
    val isSearching: Boolean = false,
    val totalLeafCount: Int = 0,
    val visibleLeafCount: Int = 0,
    val selectedCount: Int = 0,
    val visibleSelectedCount: Int = 0,
    val selectAllState: GroupSelectionState = GroupSelectionState.None,
    val selectAllEnabled: Boolean = false,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val canRetry: Boolean = false,
    val freshnessStamp: Long? = null,
) {
    /** True while a loading mark should spin (a first load, or a refresh over cached rows). */
    val busy: Boolean get() = phase == TreeSelectPhase.Loading || refreshing

    /** True when a freshness chip (stale or offline) should be shown over the cached rows. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when the resolved tree (one or more groups) should be drawn, rather than a no-results row. */
    val showTree: Boolean get() = phase == TreeSelectPhase.Content && !noResults
}

/**
 * The immutable, render-ready model the composable draws — the tree [display] folded together with the
 * controlled [searchQuery] the search box reflects. Pure data so the projection is unit-tested with no UI host.
 */
data class TreeSelectUiModel(
    val display: TreeSelectDisplay,
    val searchQuery: String,
)

/**
 * The controlled interaction state the web TreeSelect owns alongside the catalog feed — the [selectedIds],
 * the [searchQuery], the [expandedIds], and the disabled-leaf configuration ([disabledIds] +
 * [disabledReasons], the native mapping of the web `getLeafDisabled` / `getLeafDisabledReason` predicates).
 * Grouped into one value so [TreeSelectProjection.project] folds the feed and the interaction in a single call.
 */
data class TreeSelectInteraction(
    val selectedIds: Set<String> = emptySet(),
    val searchQuery: String = "",
    val expandedIds: Set<String> = emptySet(),
    val disabledIds: Set<String> = emptySet(),
    val disabledReasons: Map<String, String> = emptyMap(),
)

/**
 * Pure projection from the catalog feed + interaction state to the render-ready [TreeSelectUiModel] — a 1:1
 * port of the web TreeSelect's derivations (the non-flattening search filter, the force-expand-while-searching
 * rule, the per-group tri-state over visible-and-enabled leaves, the counts, the top-level select-all state,
 * and the disabled-leaf handling), layered onto the shared cache-then-network lifecycle so freshness is
 * interpreted identically here and on every other native surface.
 */
object TreeSelectProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Folds the catalog-feed [state] together with the [interaction] inputs into the render-ready model. The
     * body phase is taken verbatim from the shared [io.teslasync.android.data.toUiState] projection (so an
     * error-with-cache stays a visible Content/Empty surface flagged offline, never a blank error), the tree
     * is filtered by the search needle, each group is folded to its tri-state + counts, and the top-level
     * select-all state is derived over the currently-visible leaves.
     */
    fun project(
        state: UiState<List<TreeGroup>>,
        interaction: TreeSelectInteraction,
    ): TreeSelectUiModel {
        val groups = state.data ?: emptyList()
        val phase = phaseOf(state.phase)
        val isSearching = interaction.searchQuery.trim().isNotEmpty()
        val filtered = filterGroups(groups, interaction.searchQuery)
        val groupRows = filtered.map { group -> projectGroup(group, interaction, isSearching) }

        val visibleLeafIds = filtered.flatMap { group -> group.leaves.map { it.value } }
        val visibleSelectedCount = visibleLeafIds.count { it in interaction.selectedIds }
        val noResults = phase == TreeSelectPhase.Content && filtered.isEmpty() && groups.isNotEmpty()

        val display =
            TreeSelectDisplay(
                phase = phase,
                groups = groupRows,
                noResults = noResults,
                isSearching = isSearching,
                totalLeafCount = groups.sumOf { it.leaves.size },
                visibleLeafCount = visibleLeafIds.size,
                selectedCount = interaction.selectedIds.size,
                visibleSelectedCount = visibleSelectedCount,
                selectAllState = selectAllState(visibleLeafIds, visibleSelectedCount, interaction.selectedIds),
                selectAllEnabled = visibleLeafIds.isNotEmpty(),
                stale = state.stale && state.errorKind == null,
                offline = state.stale && state.hasData && state.errorKind != null,
                refreshing = state.refreshing,
                errorKind = state.errorKind,
                httpStatus = state.httpStatus,
                canRetry = state.canRetry,
                freshnessStamp = state.fetchedAt,
            )
        return TreeSelectUiModel(display = display, searchQuery = interaction.searchQuery)
    }

    /**
     * Filters [groups] by the search [query] (case-insensitive substring against the leaf label) WITHOUT
     * flattening the tree: a group whose own label matches keeps all of its leaves, otherwise only matching
     * leaves survive, and groups with zero surviving leaves drop. Returns the original [groups] reference when
     * no search is active, for cheap equality. The native port of the web `filterGroups`.
     */
    fun filterGroups(
        groups: List<TreeGroup>,
        query: String,
    ): List<TreeGroup> {
        val needle = query.trim().lowercase()
        if (needle.isEmpty()) return groups
        val out = ArrayList<TreeGroup>(groups.size)
        for (group in groups) {
            val groupMatches = group.label.lowercase().contains(needle)
            val leaves = if (groupMatches) group.leaves else group.leaves.filter { it.label.lowercase().contains(needle) }
            if (leaves.isEmpty()) continue
            out += if (groupMatches) group else group.copy(leaves = leaves)
        }
        return out
    }

    /** Toggles a single leaf in/out of the selection (web `toggleLeaf` — set-membership toggle). */
    fun toggleLeaf(
        selected: Set<String>,
        leafId: String,
    ): Set<String> = if (leafId in selected) selected - leafId else selected + leafId

    /**
     * Toggles a list of [ids] as a block: when every id is already selected they are all removed, otherwise
     * the missing ones are added — the shared core of the web `toggleGroup` / `toggleAllVisible` "select all
     * or clear all" actions. Ids outside [ids] (out-of-filter or disabled picks) are always preserved.
     */
    fun toggleIds(
        selected: Set<String>,
        ids: List<String>,
    ): Set<String> {
        if (ids.isEmpty()) return selected
        val allSelected = ids.all { it in selected }
        return if (allSelected) selected - ids.toSet() else selected + ids
    }

    /** The visible-and-enabled leaf ids across all filtered groups (the universe of the top-level select-all). */
    fun visibleEnabledLeafIds(
        groups: List<TreeGroup>,
        query: String,
        disabled: Set<String>,
    ): List<String> =
        filterGroups(groups, query)
            .flatMap { group -> group.leaves.map { it.value } }
            .filter { it !in disabled }

    /** The visible-and-enabled leaf ids of a single filtered [groupId] (the universe of that group's toggle). */
    fun groupVisibleEnabledLeafIds(
        groups: List<TreeGroup>,
        query: String,
        groupId: String,
        disabled: Set<String>,
    ): List<String> =
        filterGroups(groups, query)
            .firstOrNull { it.id == groupId }
            ?.leaves
            ?.map { it.value }
            ?.filter { it !in disabled }
            ?: emptyList()

    /** Toggles every visible-and-enabled leaf of [groupId] (web `toggleGroup`). */
    fun toggleGroup(
        groups: List<TreeGroup>,
        query: String,
        groupId: String,
        selected: Set<String>,
        disabled: Set<String>,
    ): Set<String> = toggleIds(selected, groupVisibleEnabledLeafIds(groups, query, groupId, disabled))

    /** Toggles every visible-and-enabled leaf across all filtered groups (web `toggleAllVisible`). */
    fun toggleAllVisible(
        groups: List<TreeGroup>,
        query: String,
        selected: Set<String>,
        disabled: Set<String>,
    ): Set<String> = toggleIds(selected, visibleEnabledLeafIds(groups, query, disabled))

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP/decode/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: TreeSelectDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }

    private fun phaseOf(phase: UiPhase): TreeSelectPhase =
        when (phase) {
            UiPhase.Loading -> TreeSelectPhase.Loading
            UiPhase.Empty -> TreeSelectPhase.Empty
            UiPhase.Error -> TreeSelectPhase.Error
            UiPhase.Content -> TreeSelectPhase.Content
        }

    private fun projectGroup(
        group: TreeGroup,
        interaction: TreeSelectInteraction,
        isSearching: Boolean,
    ): TreeSelectGroupRow {
        val expanded = isSearching || group.id in interaction.expandedIds
        val selected = interaction.selectedIds
        val visibleEnabled = group.leaves.filter { it.value !in interaction.disabledIds }
        val groupSelectedCount = group.leaves.count { it.value in selected }
        val allSelected = visibleEnabled.isNotEmpty() && visibleEnabled.all { it.value in selected }
        val someSelected = groupSelectedCount > 0 && !allSelected
        val leaves =
            if (expanded) {
                group.leaves.map { leaf ->
                    TreeSelectLeafRow(
                        id = leaf.value,
                        label = leaf.label,
                        selected = leaf.value in selected,
                        disabled = leaf.value in interaction.disabledIds,
                        disabledReason = interaction.disabledReasons[leaf.value],
                    )
                }
            } else {
                emptyList()
            }
        return TreeSelectGroupRow(
            id = group.id,
            label = group.label,
            selectionState = triState(allSelected, someSelected),
            selectedCount = groupSelectedCount,
            totalCount = group.leaves.size,
            expanded = expanded,
            toggleEnabled = visibleEnabled.isNotEmpty(),
            leaves = leaves,
        )
    }

    private fun selectAllState(
        visibleLeafIds: List<String>,
        visibleSelectedCount: Int,
        selected: Set<String>,
    ): GroupSelectionState {
        val allSelected = visibleLeafIds.isNotEmpty() && visibleLeafIds.all { it in selected }
        return triState(allSelected, visibleSelectedCount > 0 && !allSelected)
    }

    private fun triState(
        all: Boolean,
        some: Boolean,
    ): GroupSelectionState =
        when {
            all -> GroupSelectionState.All
            some -> GroupSelectionState.Partial
            else -> GroupSelectionState.None
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [TreeSelectRegistration.SLUG] — never a group / leaf label or a selected id — so a diagnostics line can
 * never leak the catalog contents or what the user picked.
 */
object TreeSelectDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** The structured event name emitted when the catalog feed is re-fetched after an error/stale chip. */
    const val REFRESH_EVENT: String = "treeSelect.refresh"

    /** The single structured field every diagnostic carries — the surface slug, nothing else. */
    fun surfaceField(): Map<String, String> = mapOf(SURFACE_KEY to TreeSelectRegistration.SLUG)

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) = logger.info(VIEW_OPENED, surfaceField())

    /** Emits the `treeSelect.refresh` diagnostic when the catalog feed is re-fetched (retry / stale refresh). */
    fun recordRefresh(logger: Logger) = logger.info(REFRESH_EVENT, surfaceField())
}
