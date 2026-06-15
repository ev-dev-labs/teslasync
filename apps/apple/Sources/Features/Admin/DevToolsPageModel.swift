import Foundation
import Observation

// MARK: - Page model (web `DevToolsPage` tab state + `ClientUtilitiesSection` UI state)

/// The `@Observable` state holder the DevTools page binds to. Owns the selected tab
/// (web `useUrlEnum`), the utilities search query and the expanded-tool id (web
/// `ClientUtilitiesSection` `search` / `expandedId`). Pure local state — no networking
/// or business logic in the view, per ADR-004. All reference data is the static
/// `DevToolsCatalog`; this model just tracks navigation/selection.
@MainActor
@Observable
public final class DevToolsPageModel {
    /// Active tab (web tabbed shell). Defaults to Fleet API (web `DEFAULT_TAB`).
    public var selectedTab: DevToolsTab

    /// Utilities search query (web `ClientUtilitiesSection.search`).
    public var toolSearch: String = ""

    /// Currently expanded utility tool id, or nil (web `expandedId`).
    public private(set) var expandedToolID: String?

    public init(selectedTab: DevToolsTab = .fleetAPI) {
        self.selectedTab = selectedTab
    }

    /// Tools matching the current search (web filtered grid).
    public var filteredTools: [DevToolsUtilityTool] {
        DevToolsCatalog.filterTools(toolSearch)
    }

    /// Whether any tool matches the search (web shows an empty message when none do).
    public var hasToolMatches: Bool {
        !filteredTools.isEmpty
    }

    /// Toggles a tool's expansion, collapsing the previously expanded one (web `onToggle`).
    public func toggleTool(_ id: String) {
        expandedToolID = expandedToolID == id ? nil : id
    }

    public func isToolExpanded(_ id: String) -> Bool {
        expandedToolID == id
    }

    /// Selects a tab (web `setTab`).
    public func select(_ tab: DevToolsTab) {
        selectedTab = tab
    }
}
