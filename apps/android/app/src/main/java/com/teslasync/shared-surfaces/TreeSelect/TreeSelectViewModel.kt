// UI-thread-free state holder backing the TreeSelect surface — the native port of the web component's
// controlled state (web/src/components/forms/TreeSelect.tsx): the selected leaf ids, the search needle, and
// the expanded-group ids, layered over the bound catalog feed. It binds the catalog through [TreeSelectSource]
// and performs no HTTP itself (ADR-002): the view collects [uiModel] (already folded through the pure
// [TreeSelectProjection]) and calls the intent methods below. The catalog feed is the genuine async dependency
// the surface resolves, so its cache-then-network lifecycle drives the surface's loading / content / empty /
// error / stale / offline states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/TreeSelect) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.treeselect

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.components.forms.TreeGroup
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * State holder for the TreeSelect surface.
 *
 * The catalog feed is re-shared as a lifecycle-aware [UiState] and combined with the controlled interaction
 * state into a single [uiModel] the composable renders without re-deriving the cache-then-network contract.
 * Typing ([onSearchChange]) narrows the in-surface filter; [toggleLeaf] / [toggleGroup] / [toggleAllVisible] /
 * [clearAll] mutate the selection (preserving out-of-filter and disabled picks, exactly as the web source);
 * [toggleExpanded] flips a group open/closed (a no-op while searching, when everything is force-expanded);
 * [retry] / [refresh] re-fetch the catalog; and [onViewOpened] emits the one PII-safe `view.opened`
 * diagnostic (P1/S11) — slug only, never a label or a selected id.
 *
 * @param source the catalog-feed seam (a static/store-backed adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 * @param disabledLeafIds leaves that are visible but uncheckable (web `getLeafDisabled`).
 * @param disabledLeafReasons per-leaf disabled reason surfaced to the user / screen reader (web `getLeafDisabledReason`).
 * @param initialSelectedIds the selection a host hydrates the surface with (web controlled `selectedIds`).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TreeSelectViewModel(
    private val source: TreeSelectSource,
    logger: Logger,
    scope: CoroutineScope? = null,
    private val disabledLeafIds: Set<String> = emptySet(),
    private val disabledLeafReasons: Map<String, String> = emptyMap(),
    initialSelectedIds: Set<String> = emptySet(),
) : BaseFeedViewModel(logger, scope) {
    private val searchFlow = MutableStateFlow("")
    private val selectedFlow = MutableStateFlow(initialSelectedIds)
    private val expandedFlow = MutableStateFlow<Set<String>>(emptySet())
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    /** The user's current selection (web `selectedIds`); a host observes it to react to picks. */
    val selected: StateFlow<Set<String>> = selectedFlow.asStateFlow()

    private val feedState: StateFlow<UiState<List<TreeGroup>>> =
        refreshTrigger
            .flatMapLatest { source.groups() }
            .asUiState(isEmpty = { it.isEmpty() })

    /** The single render-ready model the composable collects — the filtered tree + interaction state combined. */
    val uiModel: StateFlow<TreeSelectUiModel> =
        combine(feedState, searchFlow, selectedFlow, expandedFlow) { feed, search, selection, expanded ->
            TreeSelectProjection.project(feed, interactionOf(search, selection, expanded))
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = initialModel(),
        )

    private fun initialModel(): TreeSelectUiModel =
        TreeSelectProjection.project(
            state = feedState.value,
            interaction = interactionOf(searchFlow.value, selectedFlow.value, expandedFlow.value),
        )

    private fun interactionOf(
        search: String,
        selection: Set<String>,
        expanded: Set<String>,
    ): TreeSelectInteraction =
        TreeSelectInteraction(
            selectedIds = selection,
            searchQuery = search,
            expandedIds = expanded,
            disabledIds = disabledLeafIds,
            disabledReasons = disabledLeafReasons,
        )

    /** Raises the typed search needle into the in-surface filter (web `onSearchChange`). */
    fun onSearchChange(text: String) {
        searchFlow.value = text
    }

    /** Toggles a single leaf in/out of the selection (web `toggleLeaf`). */
    fun toggleLeaf(leafId: String) {
        selectedFlow.update { TreeSelectProjection.toggleLeaf(it, leafId) }
    }

    /** Toggles every visible-and-enabled leaf of [groupId] (web `toggleGroup`). */
    fun toggleGroup(groupId: String) {
        val groups = feedState.value.data ?: return
        selectedFlow.update { TreeSelectProjection.toggleGroup(groups, searchFlow.value, groupId, it, disabledLeafIds) }
    }

    /** Toggles every visible-and-enabled leaf across all filtered groups — "select visible" (web `toggleAllVisible`). */
    fun toggleAllVisible() {
        val groups = feedState.value.data ?: return
        selectedFlow.update { TreeSelectProjection.toggleAllVisible(groups, searchFlow.value, it, disabledLeafIds) }
    }

    /** Clears the entire selection, including out-of-filter picks (web `clearAll`). */
    fun clearAll() {
        selectedFlow.value = emptySet()
    }

    /** Replaces the selection wholesale — for a host that controls picks externally (web controlled `selectedIds`). */
    fun setSelected(ids: Set<String>) {
        selectedFlow.value = ids
    }

    /**
     * Flips a group open/closed (web `toggleExpanded`). A no-op while searching, when every group is
     * force-expanded so the matches are visible — mirroring the web source so the open/closed state is not
     * silently mutated underneath the search.
     */
    fun toggleExpanded(groupId: String) {
        if (searchFlow.value.trim().isNotEmpty()) return
        expandedFlow.update { if (groupId in it) it - groupId else it + groupId }
    }

    /** Re-fetches the catalog feed after an error/stale chip (web `refetch`); backs the retry affordance. */
    fun retry() {
        TreeSelectDiagnostics.recordRefresh(logger)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the catalog feed; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no group / leaf label or selected id. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        TreeSelectDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** Wires the surface from a concrete [source] (a static array or a store-backed async loader). */
        fun create(
            source: TreeSelectSource,
            logger: Logger,
            disabledLeafIds: Set<String> = emptySet(),
            disabledLeafReasons: Map<String, String> = emptyMap(),
            initialSelectedIds: Set<String> = emptySet(),
        ): TreeSelectViewModel =
            TreeSelectViewModel(
                source = source,
                logger = logger,
                disabledLeafIds = disabledLeafIds,
                disabledLeafReasons = disabledLeafReasons,
                initialSelectedIds = initialSelectedIds,
            )

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: TreeSelectSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { TreeSelectViewModel(source, logger) }
            }
    }
}
