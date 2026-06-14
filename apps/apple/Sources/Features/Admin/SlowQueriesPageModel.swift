import Foundation
import Observation

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the load state plus the two query controls (web `orderBy` + `limit`
/// `useState`s) and resolves them through the injected `SlowQueriesDataSource` seam.
///
/// Re-querying on a control change mirrors the web `useSlowQueries(orderBy, limit)`
/// re-fetch: the first load shows the skeleton, but a subsequent reorder/limit change
/// keeps the current rows on screen (web TanStack `isFetching`, not `isLoading`) so the
/// table never flashes back to a skeleton while the operator is scanning it.
@MainActor
@Observable
public final class SlowQueriesPageModel {
    public private(set) var state: SlowQueriesState = .loading

    /// Web `orderBy` select (default `'mean_time'`).
    public var orderBy: SlowQueryOrderBy = .meanTime

    /// Web `limit` select (default `25`).
    public var limit: Int = 25

    @ObservationIgnored private let dataSource: any SlowQueriesDataSource

    /// Web `LIMIT_OPTIONS`.
    public static let limitOptions = [10, 25, 50, 100]

    public init(dataSource: any SlowQueriesDataSource = SampleSlowQueriesDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded rows (empty unless the state is `.loaded`).
    public var rows: [SlowQueryRow] {
        if case let .loaded(rows) = state { return rows }
        return []
    }

    /// Whether the subsystem-unavailable banner shows (web `subsystemMissing`).
    public var isSubsystemUnavailable: Bool {
        state == .unavailable
    }

    /// Initial load (web first `useSlowQueries` fetch) — shows the skeleton.
    public func load() async {
        await fetch(showLoading: true)
    }

    /// Re-query after an `orderBy` / `limit` change. Keeps the current rows visible while
    /// the next page resolves (web `isFetching`) unless there is nothing to keep.
    public func reload() async {
        await fetch(showLoading: rows.isEmpty)
    }

    /// Re-runs the load from scratch (web error-retry / refetch) — shows the skeleton.
    public func refresh() async {
        await fetch(showLoading: true)
    }

    private func fetch(showLoading: Bool) async {
        if showLoading { state = .loading }
        let orderBy = orderBy
        let limit = limit
        do {
            let result = try await dataSource.load(orderBy: orderBy, limit: limit)
            state = result.rows.isEmpty ? .empty : .loaded(result.rows)
        } catch is SlowQueriesSubsystemUnavailable {
            state = .unavailable
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}
