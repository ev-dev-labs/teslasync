import Foundation
import Observation

// MARK: - Data source seam (web `useFeedbackList` / `useUpdateFeedback`)

/// Supplies the two feedback feeds the page renders + the inline mutation. The
/// production implementation binds the shared KMP feedback endpoints (ADR-004 — the
/// view holds no networking); previews and tests inject doubles to drive every data
/// state. Mirrors the `AuditLogDataSource` seam used by the sibling Audit Log page.
public protocol FeedbackQueueDataSource: Sendable {
    /// Web `useFeedbackList` → `GET /admin/feedback{buildQuery(params)}`.
    func loadFeedback(_ query: FeedbackQuery) async throws -> FeedbackListResult
    /// Web `useUpdateFeedback` → `PATCH /admin/feedback/{id}`.
    func updateFeedback(id: Int64, update: FeedbackUpdate) async throws -> FeedbackEntry
}

// MARK: - Page state (web `isLoading` / `isError` / empty / success phases)

/// The list state for the feedback queue. `.empty` is a successful load with zero
/// rows (web `items.length === 0`); `.error` is a retryable failure (web `isError`
/// → `QueryError`); `.loaded` carries one or more rows.
public enum FeedbackQueueState: Equatable, Sendable {
    case loading
    case empty
    case error(String)
    case loaded([FeedbackEntry])
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the list state, the status/category filter row, pagination, the
/// row-expansion set, the GitHub-bridge flag, and the inline-update in-flight flag,
/// reading the two feeds through the injected `FeedbackQueueDataSource` seam.
@MainActor
@Observable
public final class FeedbackQueuePageModel {
    /// Web `PAGE_SIZE = 25` — aliases the nonisolated `FeedbackQuery.pageSize` so the
    /// view + tests can read it through the model.
    public static let pageSize = FeedbackQuery.pageSize

    public private(set) var state: FeedbackQueueState = .loading
    public private(set) var total = 0
    public private(set) var bridgeEnabled = false
    public private(set) var githubRepo: String?

    /// True while a background list refetch is in flight (web `isFetching`) — drives the
    /// Refresh spinner + the prev/next disabled guards.
    public private(set) var isRefreshing = false
    /// True while an inline PATCH is in flight (web `update.isPending`) — disables the
    /// expansion's status/url/forward controls.
    public private(set) var isUpdating = false
    /// The last inline-update failure (web mutation `onError` toast). Surfaced as a
    /// dismissible banner; crucially it does NOT replace the loaded list — the web
    /// mutation error is independent of the list query, so the queue stays rendered.
    public private(set) var updateError: String?

    // Filter row (web `statusFilter` / `categoryFilter` `useState`s). `nil` is the web
    // empty-string "All …" selection that omits the query param.
    public var statusFilter: FeedbackStatus?
    public var categoryFilter: FeedbackCategory?
    public private(set) var page = 0

    /// The expanded row ids (web `expanded` state driving `renderExpanded`).
    public var expanded: Set<Int64> = []

    @ObservationIgnored private let dataSource: any FeedbackQueueDataSource

    public init(dataSource: any FeedbackQueueDataSource = SampleFeedbackQueueDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded rows (empty unless the state is `.loaded`).
    public var items: [FeedbackEntry] {
        if case let .loaded(rows) = state { return rows }
        return []
    }

    /// The query the current filter row + page produce (web `useFeedbackList` params).
    public var currentQuery: FeedbackQuery {
        FeedbackQuery(
            status: statusFilter,
            category: categoryFilter,
            limit: Self.pageSize,
            offset: page * Self.pageSize
        )
    }

    /// Web `Math.max(1, Math.ceil(total / PAGE_SIZE))`.
    public var totalPages: Int {
        max(1, Int(ceil(Double(total) / Double(Self.pageSize))))
    }

    /// Web "Previous" disabled guard (`page === 0 || isFetching`), inverted.
    public var canGoPrev: Bool {
        page > 0 && !isRefreshing
    }

    /// Web "Next" disabled guard (`page + 1 >= totalPages || isFetching`), inverted.
    public var canGoNext: Bool {
        page + 1 < totalPages && !isRefreshing
    }

    /// Loads the first page (web mounts `useFeedbackList`). Idempotent re-entry guard so
    /// the `.task` modifier never double-fetches an already-loaded page.
    public func load() async {
        if case .loaded = state { return }
        await reload()
    }

    /// Re-runs the list query with the current filters + page (web `useFeedbackList`).
    public func reload() async {
        isRefreshing = true
        if case .loaded = state {} else { state = .loading }
        defer { isRefreshing = false }
        do {
            let result = try await dataSource.loadFeedback(currentQuery)
            total = result.total
            bridgeEnabled = result.githubBridgeEnabled
            githubRepo = result.githubRepo
            state = result.items.isEmpty ? .empty : .loaded(result.items)
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Web Refresh button (`refetch()`).
    public func refresh() async {
        await reload()
    }

    /// Web filter `onChange` (`setStatusFilter(...) ; setPage(0)`), then the query
    /// refetches. Called when either filter selection changes.
    public func onFilterChanged() async {
        page = 0
        await reload()
    }

    /// Web "Next" (`setPage((p) => p + 1)`).
    public func nextPage() async {
        guard canGoNext else { return }
        page += 1
        await reload()
    }

    /// Web "Previous" (`setPage((p) => Math.max(0, p - 1))`).
    public func prevPage() async {
        guard canGoPrev else { return }
        page = max(0, page - 1)
        await reload()
    }

    /// Web inline action (`update.mutate({ id, update })`). On success the web mutation
    /// invalidates the list query, so we reload the current page to reflect the change.
    /// On failure the web only fires a toast (the mutation is independent of the list
    /// query), so we record `updateError` and leave the loaded list — and the admin's
    /// typed-in URL — intact rather than replacing the panel with an error view.
    public func applyUpdate(id: Int64, update: FeedbackUpdate) async {
        isUpdating = true
        updateError = nil
        defer { isUpdating = false }
        do {
            _ = try await dataSource.updateFeedback(id: id, update: update)
            await reload()
        } catch {
            updateError = error.localizedDescription
        }
    }

    /// Dismisses the inline-update error banner (web toast auto-dismiss).
    public func dismissUpdateError() {
        updateError = nil
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
