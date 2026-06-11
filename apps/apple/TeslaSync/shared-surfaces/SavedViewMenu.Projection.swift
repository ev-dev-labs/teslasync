//
//  SavedViewMenu.Projection.swift
//  TeslaSync — P4 shared surface · 0102 · SavedViewMenu (Apple)
//
//  The pure projection from the input snapshot to the resolved view-state, split from the model for
//  the lint length budget. Everything here is deterministic and resolves its copy through the injected
//  `SavedViewMenuResolve` seam, so the rendered text + every render branch is asserted without a view
//  or a bundle. The web "while loading `viewsRaw` is undefined → views = []" collapses to a friendly
//  empty state in the web source; the P4 leaf contract splits that into a distinct loading skeleton
//  vs the resolved-empty state, plus an error state (the web has no `QueryError` peer for this menu —
//  it is added here so the surface never collapses to a blank box).
//

import Foundation

// MARK: - Resolved row (web popover / manage `<li>`)

/// One fully-resolved menu row — the projected, Equatable peer of a web saved-view `<li>`: the stable
/// identity, the display `name` + canonical `query`, whether it is the applied view (web
/// `v.query === currentQuery`), the default / pinned flags, the localized query description (web
/// manage-row title), and the composed VoiceOver labels for each affordance. The view is a pure
/// function of this value.
public struct SavedViewRow: Sendable, Equatable, Identifiable {
    public let id: Int
    public let name: String
    public let query: String
    public let isActive: Bool
    public let isDefault: Bool
    public let isPinned: Bool
    public let applyAccessibilityLabel: String
    public let defaultToggleLabel: String
    public let pinToggleLabel: String
    public let renameLabel: String
    public let deleteLabel: String
    public let queryDescription: String

    public init(
        id: Int,
        name: String,
        query: String,
        isActive: Bool,
        isDefault: Bool,
        isPinned: Bool,
        applyAccessibilityLabel: String,
        defaultToggleLabel: String,
        pinToggleLabel: String,
        renameLabel: String,
        deleteLabel: String,
        queryDescription: String
    ) {
        self.id = id
        self.name = name
        self.query = query
        self.isActive = isActive
        self.isDefault = isDefault
        self.isPinned = isPinned
        self.applyAccessibilityLabel = applyAccessibilityLabel
        self.defaultToggleLabel = defaultToggleLabel
        self.pinToggleLabel = pinToggleLabel
        self.renameLabel = renameLabel
        self.deleteLabel = deleteLabel
        self.queryDescription = queryDescription
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — `phase` selects the body, and every label is already localized so
/// the view is a pure function of this value. Carries the menu rows, the applied view (when one
/// matches the current query), the default row id, and the localized chrome (trigger / title / manage
/// / save / empty / badge) shared across the menu, the active badge, and the manage dialog.
public struct SavedViewMenuResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case loaded
    }

    public let phase: Phase
    public let rows: [SavedViewRow]
    public let activeView: SavedViewRow?
    public let defaultViewID: Int?
    public let triggerLabel: String
    public let menuTitle: String
    public let manageLabel: String
    public let saveCurrentLabel: String
    public let emptyMessage: String
    public let appliedBadgeLabel: String
    public let clearAppliedLabel: String

    public var hasViews: Bool {
        !rows.isEmpty
    }

    public var hasActiveView: Bool {
        activeView != nil
    }

    public init(
        phase: Phase,
        rows: [SavedViewRow],
        activeView: SavedViewRow?,
        defaultViewID: Int?,
        triggerLabel: String,
        menuTitle: String,
        manageLabel: String,
        saveCurrentLabel: String,
        emptyMessage: String,
        appliedBadgeLabel: String,
        clearAppliedLabel: String
    ) {
        self.phase = phase
        self.rows = rows
        self.activeView = activeView
        self.defaultViewID = defaultViewID
        self.triggerLabel = triggerLabel
        self.menuTitle = menuTitle
        self.manageLabel = manageLabel
        self.saveCurrentLabel = saveCurrentLabel
        self.emptyMessage = emptyMessage
        self.appliedBadgeLabel = appliedBadgeLabel
        self.clearAppliedLabel = clearAppliedLabel
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

/// Pure projection from the input snapshot to the resolved view-state — the native port of the web
/// component's derivations (`activeView` / `defaultView` / the row mapping) plus the P4 leaf contract.
/// Unit tested across loading / empty / error / loaded and the active-view / default-row derivations.
public enum SavedViewMenuProjection {
    public static func resolve(
        _ input: SavedViewMenuInput,
        strings: SavedViewMenuResolve = SavedViewMenuStrings.string
    ) -> SavedViewMenuResolved {
        let rows = input.views.map { view in row(for: view, currentQuery: input.currentQuery, strings: strings) }
        let activeView = rows.first { $0.isActive }
        let defaultViewID = input.views.first { $0.isDefault }?.id
        let chrome = Chrome(strings: strings, activeName: activeView?.name)

        return SavedViewMenuResolved(
            phase: phase(for: input),
            rows: rows,
            activeView: activeView,
            defaultViewID: defaultViewID,
            triggerLabel: chrome.triggerLabel,
            menuTitle: chrome.menuTitle,
            manageLabel: chrome.manageLabel,
            saveCurrentLabel: chrome.saveCurrentLabel,
            emptyMessage: chrome.emptyMessage,
            appliedBadgeLabel: chrome.appliedBadgeLabel,
            clearAppliedLabel: chrome.clearAppliedLabel
        )
    }

    /// The render phase — error first (P4 leaf, no web peer), then the initial-fetch skeleton (only
    /// while there is nothing cached to keep on screen), then the resolved-empty state, else loaded.
    private static func phase(for input: SavedViewMenuInput) -> SavedViewMenuResolved.Phase {
        if let message = input.errorMessage, !message.isEmpty { return .error(message) }
        if input.isLoading, input.views.isEmpty { return .loading }
        if input.views.isEmpty { return .empty }
        return .loaded
    }

    /// Projects one saved view into its resolved row — the web `v.query === currentQuery` active rule
    /// plus every affordance's localized VoiceOver label.
    private static func row(
        for view: SavedView,
        currentQuery: String,
        strings: SavedViewMenuResolve
    ) -> SavedViewRow {
        SavedViewRow(
            id: view.id,
            name: view.name,
            query: view.query,
            isActive: view.query == currentQuery,
            isDefault: view.isDefault,
            isPinned: view.isPinned,
            applyAccessibilityLabel: SavedViewMenuAccessibility.applyLabel(
                name: view.name, isDefault: view.isDefault, strings: strings
            ),
            defaultToggleLabel: SavedViewMenuAccessibility.defaultToggleLabel(
                isDefault: view.isDefault, strings: strings
            ),
            pinToggleLabel: SavedViewMenuAccessibility.pinToggleLabel(
                isPinned: view.isPinned, strings: strings
            ),
            renameLabel: SavedViewMenuAccessibility.renameLabel(strings: strings),
            deleteLabel: SavedViewMenuAccessibility.deleteLabel(strings: strings),
            queryDescription: SavedViewMenuFormat.queryDescription(query: view.query, strings: strings)
        )
    }

    /// The localized chrome shared by the menu, the badge, and the manage dialog — kept together so
    /// the projection body stays within the lint budget.
    private struct Chrome {
        let triggerLabel: String
        let menuTitle: String
        let manageLabel: String
        let saveCurrentLabel: String
        let emptyMessage: String
        let appliedBadgeLabel: String
        let clearAppliedLabel: String

        init(strings: SavedViewMenuResolve, activeName: String?) {
            triggerLabel = SavedViewMenuFormat.triggerLabel(activeName: activeName, strings: strings)
            menuTitle = strings("savedViews.title", "Saved views")
            manageLabel = strings("savedViews.manage", "Manage views")
            saveCurrentLabel = strings("savedViews.saveCurrent", "Save current view…")
            emptyMessage = strings("savedViews.empty", "No saved views yet")
            appliedBadgeLabel = strings("savedViews.appliedBadge", "View")
            clearAppliedLabel = strings("savedViews.clearApplied", "Clear applied view")
        }
    }
}
