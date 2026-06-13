// UI-thread-free state holder backing the LinearSidebar surface — the native port of the web component's
// controlled state (web/src/components/layout/sidebar/LinearSidebar.tsx): the collapsed-section set and the
// inline tree-filter needle, layered over the bound nav feed. It binds the nav tree through
// [LinearSidebarSource] and performs no HTTP itself (ADR-002): the view collects [uiModel] (already folded
// through the pure [LinearSidebarProjection]) and calls the intent methods below. The nav feed is the genuine
// async dependency the surface resolves, so its cache-then-network lifecycle drives the surface's loading /
// content / empty / error / stale / offline states.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/LinearSidebar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.linearsidebar

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
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
 * State holder for the LinearSidebar surface.
 *
 * The nav feed is re-shared as a lifecycle-aware [UiState] and combined with the controlled interaction state
 * (collapsed sections + filter) into a single [uiModel] the composable renders without re-deriving the
 * cache-then-network contract. Typing ([onFilterChange]) narrows the in-surface filter; [clearFilter] resets
 * it (web's "Clear filter"); [toggleSection] flips a section open/closed; [expandSection] guarantees the
 * active section is open after navigation (web's `useEffect` on `activeSectionTitle`); [retry] / [refresh]
 * re-fetch the nav tree; and [onViewOpened] emits the one PII-safe `view.opened` diagnostic (P1/S11) — slug
 * only, never a label, route or pinned id.
 *
 * The collapsed set is lazily seeded from [LinearSidebarProjection.defaultCollapsed] (every section bar the
 * active one) the first time it is read or mutated, exactly mirroring the web component's initial state, so
 * the sidebar opens showing "where I am" rather than a wall of rows.
 *
 * @param source the nav-tree seam (a static/store-backed adapter in production, a fake in tests).
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LinearSidebarViewModel(
    private val source: LinearSidebarSource,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val filterFlow = MutableStateFlow("")

    // null until first seeded — lets us defer the "collapse all but the active section" default until the feed
    // resolves, then keep the user's subsequent toggles authoritative (web's `useState` initializer + effect).
    private val collapsedFlow = MutableStateFlow<Set<String>?>(null)
    private val refreshTrigger = MutableStateFlow(0)
    private var viewOpenedRecorded = false

    private val feedState: StateFlow<UiState<LinearSidebarNav>> =
        refreshTrigger
            .flatMapLatest { source.nav() }
            .asUiState(isEmpty = { it.sections.isEmpty() && it.pinnedItems.isEmpty() })

    /** The current filter needle (web `filter`); a host can observe it to mirror the inline tree-filter box. */
    val filter: StateFlow<String> = filterFlow.asStateFlow()

    /** The single render-ready model the composable collects — the filtered tree + interaction state combined. */
    val uiModel: StateFlow<LinearSidebarUiModel> =
        combine(feedState, collapsedFlow, filterFlow) { feed, collapsed, filter ->
            LinearSidebarProjection.project(feed, interactionOf(feed, collapsed, filter))
        }.stateIn(
            scope = stateScope,
            started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
            initialValue = initialModel(),
        )

    private fun initialModel(): LinearSidebarUiModel =
        LinearSidebarProjection.project(
            state = feedState.value,
            interaction = interactionOf(feedState.value, collapsedFlow.value, filterFlow.value),
        )

    private fun interactionOf(
        feed: UiState<LinearSidebarNav>,
        collapsed: Set<String>?,
        filter: String,
    ): LinearSidebarInteraction =
        LinearSidebarInteraction(
            collapsed = collapsed ?: defaultCollapsed(feed),
            filter = filter,
        )

    private fun defaultCollapsed(feed: UiState<LinearSidebarNav>): Set<String> =
        feed.data?.let { LinearSidebarProjection.defaultCollapsed(it) } ?: emptySet()

    /** Raises the typed search needle into the in-surface filter (web `onChange` on the filter box). */
    fun onFilterChange(text: String) {
        filterFlow.value = text
    }

    /** Clears the filter needle, restoring the full tree (web's "Clear filter" affordance). */
    fun clearFilter() {
        filterFlow.value = ""
    }

    /** Flips a section open/closed (web `toggleSection`), seeding the collapsed set from the default if needed. */
    fun toggleSection(title: String) {
        collapsedFlow.update { current ->
            val base = current ?: defaultCollapsed(feedState.value)
            if (title in base) base - title else base + title
        }
    }

    /**
     * Guarantees [title] is expanded (web's auto-expand `useEffect` when the active section changes after a
     * navigation). A no-op when the section is already open; never collapses anything.
     */
    fun expandSection(title: String) {
        collapsedFlow.update { current ->
            val base = current ?: defaultCollapsed(feedState.value)
            if (title in base) base - title else base
        }
    }

    /** Re-fetches the nav feed after an error/stale chip (web `refetch`); backs the retry affordance. */
    fun retry() {
        LinearSidebarDiagnostics.recordRefresh(logger)
        refreshTrigger.update { it + 1 }
    }

    /** Re-fetches the nav feed; backs the stale freshness chip's auto-refresh. */
    fun refresh() = retry()

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no nav label, route or pinned id. Call from the composable's first-composition effect.
     */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        LinearSidebarDiagnostics.recordViewOpened(logger)
    }

    companion object {
        /** Wires the surface from a concrete [source] (a static registry or a store-backed async loader). */
        fun create(
            source: LinearSidebarSource,
            logger: Logger,
        ): LinearSidebarViewModel = LinearSidebarViewModel(source = source, logger = logger)

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: LinearSidebarSource,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { LinearSidebarViewModel(source, logger) }
            }
    }
}
