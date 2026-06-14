import Foundation
import Observation

// MARK: - Data source seam (web `getAPICallLogs` / `getAPICallLogStats`)

/// Supplies the two feeds the page renders — the paginated, filtered call log and the
/// aggregate stats. The production implementation binds the shared KMP dev-tools endpoints
/// (ADR-004 — the view holds no networking); previews and tests inject doubles to drive
/// every data state. Mirrors the `AuditLogDataSource` seam used by the sibling Audit Log page.
public protocol ApiLogsDataSource: Sendable {
    func loadStats() async throws -> ApiCallLogStats
    func loadLogs(_ query: ApiLogsQuery) async throws -> ApiCallLogPage
}

// MARK: - List state (web `logsQuery` phases + empty)

/// The list state for the call-log feed. `.empty` is a successful load with zero rows
/// (web `logs.length === 0`); `.error` is a retryable failure (web `logsError`); `.loaded`
/// carries one or more rows. The aggregate stats load independently of this state so the
/// stat cards + service chips stay faithful to the web (two separate queries).
public enum ApiLogsListState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([ApiCallLog])
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the view).
/// Owns the list + stats states, the filter row, the date range, pagination, and the
/// row-expansion set, reading both feeds through the injected `ApiLogsDataSource` seam.
@MainActor
@Observable
public final class ApiLogsPageModel {
    /// Fixed page size (web `const limit = 25`).
    public static let limit = 25

    public private(set) var listState: ApiLogsListState = .loading
    public private(set) var stats: ApiCallLogStats?
    public private(set) var statsFailure: String?
    public private(set) var total = 0
    public private(set) var page = 0

    // Filter row (web URL-state filters). Empty string == unset (the "All …" option).
    public var service = ""
    public var method = ""
    public var status = ""
    public var endpoint = ""

    // Optional date range (web header `RangePicker` → `start` / `end` query params). Gated
    // by an enable flag so an unset bound maps to a `nil` query param.
    public var startEnabled = false
    public var start = Date()
    public var endEnabled = false
    public var end = Date()

    /// The expanded row ids (web `expandedId` state, generalized to a set).
    public var expanded: Set<Int64> = []

    @ObservationIgnored private let dataSource: any ApiLogsDataSource

    public init(dataSource: any ApiLogsDataSource = SampleApiLogsDataSource()) {
        self.dataSource = dataSource
    }

    // MARK: - Derived list values

    /// The loaded rows (empty unless the state is `.loaded`).
    public var logs: [ApiCallLog] {
        if case let .loaded(rows) = listState { return rows }
        return []
    }

    /// Web `hasFilters` (`method || status || endpoint || service`) — the date range is
    /// excluded, matching the web's "Clear" affordance scope.
    public var hasFilters: Bool {
        !service.isEmpty || !method.isEmpty || !status.isEmpty || !endpoint.isEmpty
    }

    /// Web `totalPages = Math.ceil(total / limit)`.
    public var totalPages: Int {
        guard total > 0 else { return 0 }
        return Int((Double(total) / Double(Self.limit)).rounded(.up))
    }

    /// Web showing-range `from` (`page * limit + 1`).
    public var pageFrom: Int {
        page * Self.limit + 1
    }

    /// Web showing-range `to` (`min((page + 1) * limit, total)`).
    public var pageTo: Int {
        min((page + 1) * Self.limit, total)
    }

    /// Web "Previous" disabled guard (`page === 0`), inverted.
    public var canGoPrev: Bool {
        page > 0
    }

    /// Web "Next" disabled guard (`page >= totalPages - 1`), inverted.
    public var canGoNext: Bool {
        page < totalPages - 1
    }

    /// Web pagination visibility (`totalPages > 1`).
    public var showsPagination: Bool {
        totalPages > 1
    }

    // MARK: - Derived stats values

    /// Web `stats?.by_service` count (`Object.keys(...).length`) for the "{{tracked}}" caption.
    public var trackedServiceCount: Int {
        stats?.byService.count ?? 0
    }

    /// Whether the "By Service" chip row renders (web `by_service` present + non-empty).
    public var hasServiceBreakdown: Bool {
        !(stats?.byService.isEmpty ?? true)
    }

    /// The "By Service" chips, sorted by descending count then name for a stable order.
    public var serviceBreakdown: [(service: String, count: Int)] {
        guard let byService = stats?.byService else { return [] }
        return byService
            .sorted { lhs, rhs in
                lhs.value == rhs.value ? lhs.key < rhs.key : lhs.value > rhs.value
            }
            .map { (service: $0.key, count: $0.value) }
    }

    /// The top-of-page error banner detail (web `[statsError, logsError].find(Boolean)`).
    public var loadFailureDetail: String? {
        if let statsFailure { return statsFailure }
        if case let .error(detail) = listState { return detail }
        return nil
    }

    // MARK: - Query

    /// The query the current filter row + page produce (web `getAPICallLogs` args).
    public var currentQuery: ApiLogsQuery {
        ApiLogsQuery(
            limit: Self.limit,
            offset: page * Self.limit,
            method: method.isEmpty ? nil : method,
            status: status.isEmpty ? nil : status,
            endpoint: endpoint.isEmpty ? nil : endpoint,
            service: service.isEmpty ? nil : service,
            start: startEnabled ? ApiLogsFormat.iso(start) : nil,
            end: endEnabled ? ApiLogsFormat.iso(end) : nil
        )
    }

    /// The JSON the "Export JSON" action shares (web `handleExport` blob contents).
    public var exportJSON: String {
        ApiLogsFormat.exportJSON(logs)
    }

    // MARK: - Loading

    /// Loads both feeds (web mounts the stats query + the logs query). The stats query is
    /// non-fatal to the list — a failure flips `statsFailure` (surfacing the banner + the
    /// "—" stat cards) without blocking the table, matching the web's independent queries.
    public func load() async {
        await refreshStats()
        await reloadLogs()
    }

    /// Re-runs the aggregate stats query (web `getAPICallLogStats`).
    public func refreshStats() async {
        do {
            stats = try await dataSource.loadStats()
            statsFailure = nil
        } catch {
            stats = nil
            statsFailure = Self.message(for: error)
        }
    }

    /// Re-runs the list query with the current filters + page (web `getAPICallLogs`).
    public func reloadLogs() async {
        listState = .loading
        do {
            let result = try await dataSource.loadLogs(currentQuery)
            total = result.total
            listState = result.logs.isEmpty ? .empty : .loaded(result.logs)
        } catch {
            listState = .error(Self.message(for: error))
        }
    }

    /// Applies a filter change from page 0 (web `setFilter` resets `page` then refetches).
    public func applyFilters() async {
        page = 0
        await reloadLogs()
    }

    /// Web "Clear" (`clearFilters` — clears method/status/endpoint/service + page, reloads).
    public func clearFilters() async {
        service = ""
        method = ""
        status = ""
        endpoint = ""
        page = 0
        await reloadLogs()
    }

    /// Web `selectService(svc)` — sets the service filter from a "By Service" chip + page 0.
    public func selectService(_ svc: String) async {
        service = svc
        page = 0
        await reloadLogs()
    }

    /// Web "Next" (`setPage(p + 1)`).
    public func nextPage() async {
        guard canGoNext else { return }
        page += 1
        await reloadLogs()
    }

    /// Web "Previous" (`setPage(max(0, p - 1))`).
    public func prevPage() async {
        guard canGoPrev else { return }
        page = max(0, page - 1)
        await reloadLogs()
    }

    // MARK: - Row expansion (web `expandedId` toggle)

    /// Web row toggle (`setExpandedId(expandedId === id ? null : id)`).
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

    /// Extracts a human-readable detail from a thrown error (web `getErrorMessage`).
    static func message(for error: Error) -> String {
        if let failure = error as? ApiLogsLoadFailure { return failure.detail }
        return error.localizedDescription
    }
}
