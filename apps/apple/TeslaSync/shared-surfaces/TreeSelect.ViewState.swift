//
//  TreeSelect.ViewState.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The value types the TreeSelect view-model is built from, kept apart from the state-holder for the lint
//  length budget: the connectivity axis, the coalesced input snapshot (the web props + the parent
//  lifecycle), the resolved view-ready state (web render branches + the P4 leaf contract), and the pure
//  projection that maps one to the other. All Foundation-only and `Equatable` / `Sendable`, so the whole
//  filter / count / tri-state derivation is unit-tested without a view or a store.
//

import Foundation

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound catalog feed — the orthogonal connectivity axis rendered as the freshness
/// chip. `live` hides the chip; `stale` / `offline` show it.
public enum TreeSelectConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (the web props + parent lifecycle)

/// One coalesced snapshot of the surface's inputs — the web `groups` / `selectedIds` / `searchValue` /
/// optional `expandedGroupIds` / `search-prompt` / `emptyState` / `noResultsState` / `ariaLabel` props
/// plus the parent's lifecycle (`isLoading`, an error message, connectivity). The host callbacks are NOT
/// here — they live on the source / model so this value stays `Equatable` / `Sendable`.
public struct TreeSelectSnapshot: Sendable, Equatable {
    /// The full catalog (web `groups`); the engine filters in-place.
    public var groups: [TreeSelectGroup]
    /// The controlled selection (web `selectedIds`).
    public var selectedIDs: [String]
    /// The controlled search box value (web `searchValue`).
    public var searchValue: String
    /// The controlled expanded-group set, or `nil` for uncontrolled (web `expandedGroupIds`).
    public var expandedGroupIDs: [String]?
    /// The tree's accessibility label override (web `ariaLabel`); `nil` → the localized default.
    public var ariaLabel: String?
    /// The search field prompt override (web `search-prompt`); `nil` → the localized default.
    public var searchPrompt: String?
    /// The empty-catalog body override (web `emptyState`); `nil` → the localized default.
    public var emptyText: String?
    /// The no-results body override (web `noResultsState`); `nil` → the localized default.
    public var noResultsText: String?
    /// The parent's catalog fetch is in flight → loading chrome (P4 leaf).
    public var isLoading: Bool
    /// The parent's catalog fetch failed → error chrome (P4 leaf, web `QueryError` peer).
    public var errorMessage: String?
    /// The bound feed freshness (P4 leaf connectivity axis).
    public var connection: TreeSelectConnection

    public init(
        groups: [TreeSelectGroup] = [],
        selectedIDs: [String] = [],
        searchValue: String = "",
        expandedGroupIDs: [String]? = nil,
        ariaLabel: String? = nil,
        searchPrompt: String? = nil,
        emptyText: String? = nil,
        noResultsText: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TreeSelectConnection = .live
    ) {
        self.groups = groups
        self.selectedIDs = selectedIDs
        self.searchValue = searchValue
        self.expandedGroupIDs = expandedGroupIDs
        self.ariaLabel = ariaLabel
        self.searchPrompt = searchPrompt
        self.emptyText = emptyText
        self.noResultsText = noResultsText
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the chrome, `body` the ready sub-state, and the
/// filtered groups + counters + aggregate tri-state + label overrides are carried so the view is a pure
/// function of this value plus the model's live selection / expansion. The label overrides stay raw (the
/// view falls back to the P1/S10 facade) so the projection needs no bundle.
public struct TreeSelectResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case ready
        case error(String)
    }

    public enum Body: Sendable, Equatable {
        case empty
        case noResults(query: String)
        case tree
    }

    public let phase: Phase
    public let body: Body
    /// The search-filtered groups rendered as the tree (web `filtered`).
    public let filteredGroups: [TreeSelectGroup]
    /// The current selection as a set for O(1) per-row membership tests.
    public let selected: Set<String>
    /// A non-blank search is active (web `isSearching`).
    public let isSearching: Bool
    /// Total leaves across the unfiltered catalog (web `totalLeafCount`).
    public let totalLeafCount: Int
    /// Total selected ids (web `selectedIds.length`).
    public let selectedTotal: Int
    /// Visible (filtered) leaf count (web `visibleLeafIds.length`).
    public let visibleLeafCount: Int
    /// The top "select all visible" tri-state (web `allVisibleSelected` / `someVisibleSelected`).
    public let aggregateState: TreeSelectCheckState
    /// The top control is disabled when there is nothing visible to select (web `visibleLeafIds.length===0`).
    public let selectAllDisabled: Bool
    /// There is at least one selected id (gates the "Clear all selected" button, web `selectedIds.length>0`).
    public let hasSelection: Bool
    /// Caller search prompt override (web `search-prompt`); `nil` → localized default.
    public let customSearchPrompt: String?
    /// Caller empty body override (web `emptyState`); `nil` → localized default.
    public let customEmptyText: String?
    /// Caller no-results body override (web `noResultsState`); `nil` → localized default.
    public let customNoResultsText: String?
    /// Caller tree accessibility label override (web `ariaLabel`); `nil` → localized default.
    public let customAriaLabel: String?

    public init(
        phase: Phase,
        body: Body = .tree,
        filteredGroups: [TreeSelectGroup] = [],
        selected: Set<String> = [],
        isSearching: Bool = false,
        totalLeafCount: Int = 0,
        selectedTotal: Int = 0,
        visibleLeafCount: Int = 0,
        aggregateState: TreeSelectCheckState = .none,
        selectAllDisabled: Bool = true,
        hasSelection: Bool = false,
        customSearchPrompt: String? = nil,
        customEmptyText: String? = nil,
        customNoResultsText: String? = nil,
        customAriaLabel: String? = nil
    ) {
        self.phase = phase
        self.body = body
        self.filteredGroups = filteredGroups
        self.selected = selected
        self.isSearching = isSearching
        self.totalLeafCount = totalLeafCount
        self.selectedTotal = selectedTotal
        self.visibleLeafCount = visibleLeafCount
        self.aggregateState = aggregateState
        self.selectAllDisabled = selectAllDisabled
        self.hasSelection = hasSelection
        self.customSearchPrompt = customSearchPrompt
        self.customEmptyText = customEmptyText
        self.customNoResultsText = customNoResultsText
        self.customAriaLabel = customAriaLabel
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state. A non-empty error message surfaces
/// as `error` (web `QueryError` peer), an in-flight parent fetch as `loading`, otherwise the `ready` tree —
/// whose `body` is `empty` when the catalog has no groups, `noResults` when the search filters every group
/// out, else `tree`. The filtered groups, counters, and aggregate tri-state are computed here so the view
/// holds no derivation. Unit tested across loading / error / empty / no-results / tree.
public enum TreeSelectProjection {
    public static func resolve(_ input: TreeSelectSnapshot) -> TreeSelectResolved {
        let phase: TreeSelectResolved.Phase = if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if input.isLoading {
            .loading
        } else {
            .ready
        }

        let isSearching = TreeSelectEngine.isSearching(input.searchValue)
        let filtered = TreeSelectEngine.filterGroups(input.groups, needle: input.searchValue)
        let visibleIDs = TreeSelectEngine.visibleLeafIDs(filtered)
        let selectedSet = Set(input.selectedIDs)
        let trimmedQuery = input.searchValue.trimmingCharacters(in: .whitespacesAndNewlines)

        let body: TreeSelectResolved.Body = if input.groups.isEmpty {
            .empty
        } else if filtered.isEmpty {
            .noResults(query: trimmedQuery)
        } else {
            .tree
        }

        return TreeSelectResolved(
            phase: phase,
            body: body,
            filteredGroups: filtered,
            selected: selectedSet,
            isSearching: isSearching,
            totalLeafCount: TreeSelectEngine.totalLeafCount(input.groups),
            selectedTotal: input.selectedIDs.count,
            visibleLeafCount: visibleIDs.count,
            aggregateState: TreeSelectEngine.aggregateCheckState(visibleLeafIDs: visibleIDs, selected: selectedSet),
            selectAllDisabled: visibleIDs.isEmpty,
            hasSelection: !input.selectedIDs.isEmpty,
            customSearchPrompt: input.searchPrompt,
            customEmptyText: input.emptyText,
            customNoResultsText: input.noResultsText,
            customAriaLabel: input.ariaLabel
        )
    }
}
