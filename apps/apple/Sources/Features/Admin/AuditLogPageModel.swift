import Foundation
import Observation

// MARK: - Data source seam (web `useAuditLog` / `useAuditCategories` / `useAuditActions` / `useAuditChainVerify`)

/// Supplies the four audit feeds the page renders. The production implementation binds
/// the shared KMP `OperatorConfidenceStore` audit endpoints (ADR-004 — the view holds
/// no networking); previews and tests inject doubles to drive every data state. Mirrors
/// the `DiskForecastDataSource` seam used by the sibling Disk Forecast page.
public protocol AuditLogDataSource: Sendable {
    func loadLog(_ query: AuditLogQuery) async throws -> [AuditLogRow]
    func loadCategories() async throws -> [String]
    func loadActions() async throws -> [String]
    func verifyChain(limit: Int) async throws -> AuditChainVerify
}

// MARK: - Page states (web `logQuery` phases + `subsystemMissing` + empty / verify query)

/// The list state for the audit feed. `.empty` is a successful load with zero rows
/// (web `rows.length === 0`); `.unavailable` is the 503 subsystem-missing branch;
/// `.error` is a generic retryable failure (web PageContainer error); `.loaded` carries
/// one or more rows.
public enum AuditLogState: Equatable, Sendable {
    case loading
    case empty
    case unavailable
    case error(String)
    case loaded([AuditLogRow])
}

/// The hash-chain verification state (web `verifyQuery` phases). `.idle` shows the
/// read-only hint; `.verifying` is the in-flight refetch; `.verified` carries the
/// re-derivation result; `.failed` surfaces the error banner.
public enum AuditVerifyState: Equatable, Sendable {
    case idle
    case verifying
    case verified(AuditChainVerify)
    case failed(String)
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the list + verify states, the filter row, pagination, and row-expansion
/// set, reading the four feeds through the injected `AuditLogDataSource` seam.
@MainActor
@Observable
public final class AuditLogPageModel {
    /// The fixed rows-per-page choices (web `LIMIT_OPTIONS`).
    public static let limitOptions: [Int] = [50, 100, 250, 500]

    /// Web `useAuditChainVerify(null, 1000, false)` — verifies the last 1 000 rows.
    public static let verifyLimit = 1000

    public private(set) var state: AuditLogState = .loading
    public private(set) var verifyState: AuditVerifyState = .idle
    public private(set) var categories: [String] = []
    public private(set) var actions: [String] = []

    // Filter row (web filter `useState`s). Dates are gated by an enable flag so an
    // unset filter (web empty datetime-local) maps to a `nil` query param.
    public var sinceEnabled = false
    public var since = Date()
    public var untilEnabled = false
    public var until = Date()
    public var category = ""
    public var action = ""
    public var actor = ""
    public var entityType = ""
    public var limit = 100
    public private(set) var offset = 0

    /// The expanded row ids (web `expanded` state driving `renderExpanded`).
    public var expanded: Set<Int64> = []

    @ObservationIgnored private let dataSource: any AuditLogDataSource

    public init(dataSource: any AuditLogDataSource = SampleAuditLogDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded rows (empty unless the state is `.loaded`).
    public var rows: [AuditLogRow] {
        if case let .loaded(rows) = state { return rows }
        return []
    }

    /// Whether the subsystem-unavailable banner shows (web `subsystemMissing`).
    public var isSubsystemUnavailable: Bool {
        state == .unavailable
    }

    /// The query the current filter row + page produce (web `queryParams` memo).
    public var currentQuery: AuditLogQuery {
        AuditLogQuery(
            since: sinceEnabled ? AuditLogFormat.iso(since) : nil,
            until: untilEnabled ? AuditLogFormat.iso(until) : nil,
            categories: category.isEmpty ? [] : [category],
            actors: actor.isEmpty ? [] : [actor],
            actions: action.isEmpty ? [] : [action],
            entityType: entityType.isEmpty ? nil : entityType,
            limit: limit,
            offset: offset
        )
    }

    /// Web pagination `from` (`rows.length === 0 ? 0 : offset + 1`).
    public var pageFrom: Int {
        rows.isEmpty ? 0 : offset + 1
    }

    /// Web pagination `to` (`offset + rows.length`).
    public var pageTo: Int {
        offset + rows.count
    }

    /// Web "Previous" disabled guard (`offset === 0`), inverted.
    public var canGoPrev: Bool {
        offset > 0
    }

    /// Web "Next" disabled guard (`rows.length < limit`), inverted.
    public var canGoNext: Bool {
        rows.count >= limit
    }

    /// Loads the dropdown feeds then the first page (web mounts four queries). Category
    /// and action feeds are non-fatal (web shows the "All …" option regardless), so a
    /// failure folds to an empty list rather than blocking the page.
    public func load() async {
        categories = await (try? dataSource.loadCategories()) ?? []
        actions = await (try? dataSource.loadActions()) ?? []
        await reloadLog()
    }

    /// Re-runs the list query with the current filters + page (web `useAuditLog`).
    public func reloadLog() async {
        state = .loading
        do {
            let rows = try await dataSource.loadLog(currentQuery)
            state = rows.isEmpty ? .empty : .loaded(rows)
        } catch is AuditLogSubsystemUnavailable {
            state = .unavailable
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Web "Search" button (`logQuery.refetch()` from page 0).
    public func applyFilters() async {
        offset = 0
        await reloadLog()
    }

    /// Web "Reset" button (`handleReset` — clears every filter + offset, then reloads).
    public func resetFilters() async {
        sinceEnabled = false
        untilEnabled = false
        category = ""
        action = ""
        actor = ""
        entityType = ""
        offset = 0
        await reloadLog()
    }

    /// Web "Verify chain" button (`verifyQuery.refetch()`).
    public func verify() async {
        verifyState = .verifying
        do {
            let result = try await dataSource.verifyChain(limit: Self.verifyLimit)
            verifyState = .verified(result)
        } catch {
            verifyState = .failed(error.localizedDescription)
        }
    }

    /// Web "Next" (`setOffset(offset + limit)`).
    public func nextPage() async {
        guard canGoNext else { return }
        offset += limit
        await reloadLog()
    }

    /// Web "Previous" (`setOffset(max(0, offset - limit))`).
    public func prevPage() async {
        guard canGoPrev else { return }
        offset = max(0, offset - limit)
        await reloadLog()
    }

    /// Web row `toggleExpanded` (`expanded.includes(id) ? remove : add`).
    public func toggleExpanded(_ id: Int64) {
        if expanded.contains(id) {
            expanded.remove(id)
        } else {
            expanded.insert(id)
        }
    }

    /// Whether a given row's detail panel is currently expanded.
    public func isExpanded(_ id: Int64) -> Bool {
        expanded.contains(id)
    }
}
