import Observation
import SwiftUI

// The `@Observable` state holder for the `AutomationListPage` parity surface (web
// `AutomationListPage.tsx`). Owns the automation list (driving the page phase) and the bulk
// selection (the web `useBulkSelection` primitive — selected ids, select-all state, toggle /
// clear), and performs the allow-listed bulk operation (web `useBulkAutomationsUpdate`). All data
// flows through the injected `AutomationListDataSource` — no networking in the view (ADR-004).

// MARK: - Data source seam (web hooks, names kept at the Swift call sites)

/// Supplies the automation rows and performs the bulk mutation. The production implementation binds
/// the shared KMP repositories / use-cases (ADR-004); previews + tests inject doubles to drive the
/// loading / empty / success / error states. The method names mirror the ported web hooks verbatim
/// so the parity mapping is visible at the call sites.
public protocol AutomationListDataSource: Sendable {
    /// web `useAutomations` → `GET /automations`
    func useAutomations() async throws -> [AutomationListItem]
    /// web `useBulkAutomationsUpdate` → `POST /automations/bulk`
    func useBulkAutomationsUpdate(ids: [Int64], op: AutomationBulkOperation) async throws -> AutomationBulkOutcome
}

// MARK: - Page phase (web `isLoading` / `error` / content)

/// The page's terminal phase, driven by the primary `useAutomations` source. `.error` is a
/// retryable failure (never a blank region, ADR-013); `.ready` renders the table whose region
/// resolves its own success / empty state.
public enum AutomationListPhase: Sendable, Equatable {
    case loading
    case ready
    case error(String)
}

// MARK: - Table region state (web `isLoading ? … : error ? … : length === 0 ? … : table`)

/// The single `GlassPanel` table region's render state (web ternary inside the panel): a load
/// skeleton, a retryable error, the no-data empty state, or the populated table.
public enum AutomationListTableState: Sendable, Equatable {
    case loading
    case error
    case empty
    case success
}

// MARK: - Page model

@MainActor
@Observable
public final class AutomationListPageModel {
    public private(set) var phase: AutomationListPhase = .loading
    public private(set) var items: [AutomationListItem] = []

    /// Web `useBulkSelection<number>()` — the selected automation ids. Mutated only through the
    /// selection helpers so it stays observable and funneled.
    public private(set) var selectedIDs: Set<Int64> = []

    /// The bulk operation currently in flight (web per-action `pending`) — drives the toolbar
    /// button spinner + disables the others while a mutation resolves.
    public private(set) var runningOperation: AutomationBulkOperation?

    /// The most recent bulk outcome (web mutation result) — surfaced as the partial-failure banner.
    public private(set) var lastOutcome: AutomationBulkOutcome?

    @ObservationIgnored private let dataSource: any AutomationListDataSource

    public init(dataSource: any AutomationListDataSource = SampleAutomationListDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: Loading

    /// Loads the automation list (driving the phase). Web initial `useAutomations` query.
    public func load() async {
        phase = .loading
        await fetch()
    }

    /// Re-runs the load while keeping current content visible (web refetch / pull-to-refresh).
    public func refresh() async {
        await fetch()
    }

    private func fetch() async {
        do {
            items = try await dataSource.useAutomations()
            phase = .ready
            pruneSelection()
        } catch {
            phase = .error(error.localizedDescription)
        }
    }

    // MARK: Selection (web `useBulkSelection`)

    /// Web `visibleIds = automations.map(a => a.id)`.
    public var visibleIDs: [Int64] {
        items.map(\.id)
    }

    public var selectedCount: Int {
        selectedIDs.count
    }

    /// Web `count > 0` — gates the bulk-action toolbar (it renders nothing while empty).
    public var hasSelection: Bool {
        !selectedIDs.isEmpty
    }

    /// Web `sel.isSelected(id)`.
    public func isSelected(_ id: Int64) -> Bool {
        selectedIDs.contains(id)
    }

    /// Web `sel.toggle(id)`.
    public func toggle(_ id: Int64) {
        if selectedIDs.contains(id) {
            selectedIDs.remove(id)
        } else {
            selectedIDs.insert(id)
        }
    }

    /// Web `sel.clear()`.
    public func clearSelection() {
        guard !selectedIDs.isEmpty else { return }
        selectedIDs.removeAll()
    }

    /// Web `sel.masterState(visibleIds)` — none / some (indeterminate) / all.
    public var selectAllState: AutomationSelectAllState {
        let visible = visibleIDs
        guard !visible.isEmpty else { return .none }
        let hits = visible.reduce(into: 0) { total, id in
            if selectedIDs.contains(id) { total += 1 }
        }
        if hits == 0 { return .none }
        return hits == visible.count ? .all : .some
    }

    /// Web `sel.toggleAll(visibleIds)` — deselect all visible if every one is selected, else select
    /// them all (gmail-style select-all checkbox).
    public func toggleAll() {
        let visible = visibleIDs
        guard !visible.isEmpty else { return }
        let allSelected = visible.allSatisfy { selectedIDs.contains($0) }
        if allSelected {
            selectedIDs.subtract(visible)
        } else {
            selectedIDs.formUnion(visible)
        }
    }

    /// Drops selected ids that no longer exist after a reload (keeps the select-all state honest).
    private func pruneSelection() {
        selectedIDs.formIntersection(Set(visibleIDs))
    }

    // MARK: Bulk mutation (web `useBulkAutomationsUpdate` + `sel.clear()`)

    /// Performs a bulk operation over the current selection (web action `onClick`): POST the op,
    /// then clear the selection and refetch the list. A failure keeps the selection so the user can
    /// retry (web mutation `onError`); it never corrupts the list. Ignored while empty or in-flight.
    public func performBulk(_ op: AutomationBulkOperation) async {
        guard hasSelection, runningOperation == nil else { return }
        let ids = selectedIDs.sorted()
        runningOperation = op
        defer { runningOperation = nil }
        do {
            lastOutcome = try await dataSource.useBulkAutomationsUpdate(ids: ids, op: op)
            clearSelection()
            await fetch()
        } catch {
            lastOutcome = nil
        }
    }

    /// Clears the surfaced bulk outcome banner once acknowledged.
    public func clearOutcome() {
        lastOutcome = nil
    }

    /// Whether the given operation's button should show its in-flight spinner.
    public func isRunning(_ op: AutomationBulkOperation) -> Bool {
        runningOperation == op
    }

    /// Whether the toolbar actions are disabled (any op in flight).
    public var isBusy: Bool {
        runningOperation != nil
    }

    // MARK: Derived render state

    /// Web table-region branch inside the single `GlassPanel`.
    public var tableState: AutomationListTableState {
        switch phase {
        case .loading: .loading
        case .error: .error
        case .ready: items.isEmpty ? .empty : .success
        }
    }

    /// The retry error message (web `ErrorDisplay error`), when the load failed.
    public var errorMessage: String? {
        if case let .error(message) = phase { return message }
        return nil
    }

    /// The selected-noun key (web `itemNoun.one` / `itemNoun.other`) for the toolbar count label.
    public var selectionNounKey: LocalizedStringKey {
        selectedCount == 1 ? "automationList.noun.one" : "automationList.noun.other"
    }
}
