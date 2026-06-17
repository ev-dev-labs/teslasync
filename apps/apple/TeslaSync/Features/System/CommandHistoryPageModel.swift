//
//  CommandHistoryPageModel.swift
//  TeslaSync — P4 feature view · P7 · system/CommandHistory (Apple) — View Model
//
//  Native SwiftUI parity of `web/src/features/system/pages/CommandHistoryPage.tsx`
//  (route `/command-history`): the audit log of every vehicle command. This file owns the
//  `@Observable` state holder, the wire value types, the injectable data-source seam, and
//  the pure display-boundary formatters — the view holds no networking (ADR-004). Filters
//  (status / search / range), pagination, and the full-history stats are derived here so
//  the view only renders. All copy resolves from `Localizable.xcstrings`; SI is irrelevant
//  to this control-plane surface (counts / timestamps round-trip verbatim).
//

import Observation
import SwiftUI

// MARK: - Status filter (web `STATUS_FILTERS` — all / success / failed)

/// The status tab the timeline is filtered by (web `statusFilter` `useUrlEnum`, default
/// `all`). Carries its catalog label key + SF Symbol so the tab bar stays declarative.
public enum CommandHistoryStatusFilter: String, CaseIterable, Identifiable, Sendable {
    case all
    case success
    case failed

    public var id: String { rawValue }

    /// The catalog key for the tab label (web `commandHistory.filter*`).
    var titleKey: LocalizedStringKey {
        switch self {
        case .all: "commandHistory.filterAll"
        case .success: "commandHistory.filterSuccess"
        case .failed: "commandHistory.filterFailed"
        }
    }

    var systemImage: String {
        switch self {
        case .all: "terminal"
        case .success: "checkmark.circle"
        case .failed: "xmark.circle"
        }
    }
}

// MARK: - Wire value types (web `CommandLogEntry` / vehicle list)

/// One command-log row — the native peer of the web `CommandLogEntry`
/// (`GET /vehicles/{vehicleId}/commands/history`). Field names mirror the wire 1:1 so the
/// production KMP binding maps straight across; `status` is the raw `success` / `failed`
/// string the backend emits, matched verbatim by the filters.
public struct CommandLogEntry: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let vehicleID: Int64
    public let command: String
    public let params: String
    public let status: String
    public let error: String
    public let createdAt: Date

    public init(
        id: Int64,
        vehicleID: Int64,
        command: String,
        params: String,
        status: String,
        error: String,
        createdAt: Date
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.command = command
        self.params = params
        self.status = status
        self.error = error
        self.createdAt = createdAt
    }

    /// Web `c.status === 'success'`.
    public var isSuccess: Bool { status == "success" }
}

/// A vehicle the picker can select (web `useSelectedVehicle().vehicles[]`). Only the id +
/// display name are needed to populate the selector and key the history query.
public struct CommandHistoryVehicle: Identifiable, Hashable, Sendable {
    public let id: Int64
    public let displayName: String?

    public init(id: Int64, displayName: String?) {
        self.id = id
        self.displayName = displayName
    }

    /// Web ``v.display_name || `Vehicle ${v.id}` ``.
    public var label: String {
        if let displayName, !displayName.isEmpty { return displayName }
        return "Vehicle \(id)"
    }
}

/// The full-history roll-ups (web `stats` memo): computed from the *unfiltered* command
/// list so the cards stay stable while the timeline filters change.
public struct CommandHistoryStats: Equatable, Sendable {
    public let total24h: Int
    public let successRate: Int
    public let mostUsed: String?
    public let lastCommand: CommandLogEntry?

    public static let empty = CommandHistoryStats(
        total24h: 0, successRate: 0, mostUsed: nil, lastCommand: nil
    )
}

// MARK: - Data-source seam (web `useCommandHistory`, GET …/commands/history)

/// Supplies the vehicle list + per-vehicle command history the page renders. Production
/// binds the shared KMP store (ADR-004 — no networking in the view); previews / tests
/// inject doubles to drive the loading / empty / error / success states. Mirrors the
/// `VehicleCostDataSource` seam used by the sibling admin pages.
public protocol CommandHistoryDataSource: Sendable {
    func vehicles() async throws -> [CommandHistoryVehicle]
    func commandHistory(vehicleID: Int64, limit: Int) async throws -> [CommandLogEntry]
}

// MARK: - Page state (web PageContainer query phases + timeline empty)

/// The command-source data state. `.empty` is a successful load with zero commands (web
/// `allCommands.length === 0`); `.error` is a retryable failure (web PageContainer error);
/// `.loaded` carries one or more rows. The loading skeleton + error live at page level; the
/// stats / filters / timeline render for both `.empty` and `.loaded`.
public enum CommandHistoryState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([CommandLogEntry])
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004). Owns the vehicle selection,
/// the command-source state, the filter/pagination controls, and the derived stats. The
/// search field mirrors the web `useDeferredValue` split: `searchQuery` is the immediate
/// field text, `deferredSearchQuery` is what filtering uses, and `isSearchPending` drives
/// the spinner while the two diverge.
@MainActor
@Observable
public final class CommandHistoryPageModel {
    /// History-fetch limit (web `?limit=200`).
    public static let historyLimit = 200
    /// Timeline page size (web `PAGE_SIZE`).
    public static let pageSize = 25

    public private(set) var state: CommandHistoryState = .loading
    public private(set) var vehicles: [CommandHistoryVehicle] = []
    public var selectedVehicleID: Int64?

    public var statusFilter: CommandHistoryStatusFilter = .all
    public private(set) var searchQuery: String = ""
    public private(set) var deferredSearchQuery: String = ""
    public var page: Int = 1
    public var rangeStart: Date
    public var rangeEnd: Date

    @ObservationIgnored private let dataSource: any CommandHistoryDataSource
    @ObservationIgnored private var searchTask: Task<Void, Never>?

    public init(dataSource: any CommandHistoryDataSource = SampleCommandHistoryDataSource()) {
        self.dataSource = dataSource
        // Web `useRangeState` default preset `all` ⇒ an effectively unbounded window.
        rangeEnd = Date()
        rangeStart = Date(timeIntervalSince1970: 0)
    }

    // MARK: Derived — command list

    /// All loaded commands (empty unless `.loaded`).
    public var allCommands: [CommandLogEntry] {
        if case let .loaded(commands) = state { return commands }
        return []
    }

    /// Web `selectedVehicle` for the picker binding (string id, nil when none).
    public var selectedVehicleStringID: String? {
        get { selectedVehicleID.map(String.init) }
        set { selectedVehicleID = newValue.flatMap(Int64.init) }
    }

    /// Web `filtered` memo — range, then status, then deferred search.
    public var filtered: [CommandLogEntry] {
        var result = allCommands.filter { $0.createdAt >= rangeStart && $0.createdAt <= rangeEnd }
        if statusFilter != .all {
            result = result.filter { $0.status == statusFilter.rawValue }
        }
        let query = deferredSearchQuery.trimmingCharacters(in: .whitespaces).lowercased()
        if !query.isEmpty {
            result = result.filter {
                $0.command.lowercased().contains(query)
                    || CommandHistoryFormat.commandName($0.command).lowercased().contains(query)
            }
        }
        return result
    }

    /// Web `paginatedCommands` — the current page slice of `filtered`.
    public var paginated: [CommandLogEntry] {
        let all = filtered
        let lower = max(0, (page - 1) * Self.pageSize)
        guard lower < all.count else { return [] }
        let upper = min(all.count, page * Self.pageSize)
        return Array(all[lower ..< upper])
    }

    /// Whether the deferred search is still catching up (web `isSearchPending`).
    public var isSearchPending: Bool { searchQuery != deferredSearchQuery }

    /// Whether any filter is narrowing the list (web `searchQuery || statusFilter !== 'all'`).
    public var hasActiveFilters: Bool {
        !searchQuery.trimmingCharacters(in: .whitespaces).isEmpty || statusFilter != .all
    }

    /// Whether the pagination control shows (web `filtered.length > PAGE_SIZE`).
    public var showsPagination: Bool { filtered.count > Self.pageSize }

    // MARK: Derived — stats (web `stats` memo, from the full unfiltered history)

    public var stats: CommandHistoryStats {
        let commands = allCommands
        guard !commands.isEmpty else { return .empty }

        let dayAgo = Date().addingTimeInterval(-24 * 60 * 60)
        let total24h = commands.filter { $0.createdAt > dayAgo }.count
        let successCount = commands.filter(\.isSuccess).count
        let successRate = Int((Double(successCount) / Double(commands.count) * 100).rounded())

        var counts: [String: Int] = [:]
        for command in commands { counts[command.command, default: 0] += 1 }
        let mostUsed = counts.min { lhs, rhs in
            lhs.value == rhs.value ? lhs.key < rhs.key : lhs.value > rhs.value
        }?.key

        return CommandHistoryStats(
            total24h: total24h,
            successRate: successRate,
            mostUsed: mostUsed,
            lastCommand: commands.first
        )
    }

    // MARK: Actions

    /// Initial load — fetch the vehicle list, settle the selection, then the history.
    public func load() async {
        state = .loading
        do {
            let loadedVehicles = try await dataSource.vehicles()
            vehicles = loadedVehicles
            if selectedVehicleID == nil || !loadedVehicles.contains(where: { $0.id == selectedVehicleID }) {
                selectedVehicleID = loadedVehicles.first?.id
            }
            try await fetchHistory()
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Re-run the load from scratch (web error-retry / refetch).
    public func refresh() async {
        await load()
    }

    /// Re-query when the selected vehicle changes (web `['command-history', id]` re-key).
    public func vehicleChanged(to id: Int64?) async {
        guard id != selectedVehicleID else { return }
        selectedVehicleID = id
        page = 1
        state = .loading
        do {
            try await fetchHistory()
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Apply a status-tab change, resetting to page 1 (web `handleStatusChange`).
    public func statusChanged(to filter: CommandHistoryStatusFilter) {
        statusFilter = filter
        page = 1
    }

    /// Feed the search field, debouncing the deferred value (web `useDeferredValue`).
    public func searchChanged(to value: String) {
        searchQuery = value
        page = 1
        searchTask?.cancel()
        searchTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            self?.deferredSearchQuery = value
        }
    }

    /// Apply a date-range change, resetting to page 1 (web `RangePicker.onChange`).
    public func rangeChanged(start: Date, end: Date) {
        rangeStart = start
        rangeEnd = end
        page = 1
    }

    private func fetchHistory() async throws {
        guard let vehicleID = selectedVehicleID else {
            state = .empty
            return
        }
        let commands = try await dataSource.commandHistory(
            vehicleID: vehicleID, limit: Self.historyLimit
        )
        state = commands.isEmpty ? .empty : .loaded(commands)
    }
}
