//
//  SignalQueryControls.Source.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  The in-memory `SignalQueryControlsSource` for previews + unit/UI tests, split out of `…Model.swift`
//  (one file ≤ 400 lines per the SwiftLint contract). It records the forwarded action counts + the
//  last query request, and lets a caller push available-signal / result snapshots (and synthesise a
//  table-ready result straight from a backend `SignalHistoryResp` via the adapter) so the bound model
//  can be driven through every state without a network.
//

import Foundation

/// In-memory source for previews + unit/UI tests. Seed it with the initial snapshots, drive it with
/// `pushAvailable` / `pushResult` / `pushHistory`, and assert the forwarded action counts
/// (`startCount` / `refreshCount` / `runQueryCount`) + the last query request (`lastRequest`).
@MainActor
public final class InMemorySignalQueryControlsSource: SignalQueryControlsSource {
    public var onAvailable: (@MainActor (SignalQueryAvailableSnapshot) -> Void)?
    public var onResult: (@MainActor (SignalQueryResultSnapshot) -> Void)?

    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var runQueryCount = 0
    public private(set) var lastRequest: SignalQueryRequest?

    private let initialAvailable: SignalQueryAvailableSnapshot?
    private let initialResult: SignalQueryResultSnapshot?

    public init(
        available: SignalQueryAvailableSnapshot? = nil,
        result: SignalQueryResultSnapshot? = nil
    ) {
        initialAvailable = available
        initialResult = result
    }

    public func start() {
        startCount += 1
        if let initialAvailable { onAvailable?(initialAvailable) }
        if let initialResult { onResult?(initialResult) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    public func runQuery(_ request: SignalQueryRequest) {
        runQueryCount += 1
        lastRequest = request
    }

    // MARK: Test / preview affordances

    /// Pushes an available-signals snapshot to the bound model.
    public func pushAvailable(_ snapshot: SignalQueryAvailableSnapshot) {
        onAvailable?(snapshot)
    }

    /// Pushes an executed-query result snapshot to the bound model.
    public func pushResult(_ snapshot: SignalQueryResultSnapshot) {
        onResult?(snapshot)
    }

    /// Convenience: adapt a backend `SignalHistoryResp` into table rows (exactly as the production
    /// source would via `adaptSignalHistoryResp`) and push the result with server pagination derived
    /// from `total` + `perPage`.
    public func pushHistory(
        resp: SignalHistoryResp,
        page: Int = 1,
        perPage: Int = 50,
        total: Int
    ) {
        let rows = SignalQueryHistoryAdapter.response(resp)
        let totalPages = perPage > 0 ? Int((Double(total) / Double(perPage)).rounded(.up)) : 0
        onResult?(SignalQueryResultSnapshot(
            loading: false,
            rows: rows,
            pagination: SignalHistoryPagination(
                page: page, perPage: perPage, total: total, totalPages: totalPages
            )
        ))
    }
}
