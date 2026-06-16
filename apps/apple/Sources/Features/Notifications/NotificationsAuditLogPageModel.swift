import Foundation
import Observation

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// Owns the list state and the client-side search box, reading the audit feed through the
/// injected `NotificationsAuditLogDataSource` seam (web `useAuditLogs` + `useFilteredList`).
@MainActor
@Observable
public final class NotificationsAuditLogPageModel {
    public private(set) var state: NotificationsAuditLogState = .loading

    /// Web `search` state driving the `SearchInput` + the active-filter chip.
    public var search = ""

    @ObservationIgnored private let dataSource: any NotificationsAuditLogDataSource

    public init(
        dataSource: any NotificationsAuditLogDataSource = SampleNotificationsAuditLogDataSource()
    ) {
        self.dataSource = dataSource
    }

    /// The loaded entries (empty unless the state is `.loaded`).
    public var entries: [AuditLogEntry] {
        if case let .loaded(entries) = state { return entries }
        return []
    }

    /// The entries matching the search box (web `filtered = useFilteredList(...)`).
    public var filteredEntries: [AuditLogEntry] {
        AuditEntryFormat.filter(entries, query: search)
    }

    /// Whether the active-filter chip shows (web `search ? [chip] : []` — a non-empty string).
    public var hasActiveSearch: Bool {
        !search.isEmpty
    }

    /// Loads the audit feed (web `useAuditLogs`). Zero rows fold to `.empty` (web
    /// "No audit entries found"); a failure folds to `.error` (web error branch).
    public func load() async {
        state = .loading
        do {
            let entries = try await dataSource.loadAuditLogs()
            state = entries.isEmpty ? .empty : .loaded(entries)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Web `ActiveFilterChips` remove / clear-all (`onRemove` / `onClearAll` → `setSearch('')`).
    public func clearSearch() {
        search = ""
    }
}
