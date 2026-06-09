//
//  MonthlyCostTable.Model.swift
//  TeslaSync — P4 feature view · 0117 · MonthlyCostTable (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the monthly cost-breakdown table. The view binds through
//  `MonthlyCostTableModel`; no networking lives in the view. The web source
//  (MonthlyCostTable.tsx) is a pure presentational leaf fed a computed `data:
//  MonthlyBucket[]` prop by its parent (the cost-analysis page), so the input snapshot
//  here carries those buckets (plus the parent's loading / error / connectivity state)
//  rather than issuing HTTP itself.
//
//  States: the web leaf's own branch is data-driven (the `sortedData.length > 0 ? table
//  : empty` render). On top of that, this surface honours the P4 leaf contract: a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an orthogonal
//  `connection` axis (live / stale / offline) surfaced as a freshness chip + banner with a
//  one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol MonthlyCostTableTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogMonthlyCostTableTelemetry: MonthlyCostTableTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum MonthlyCostTableConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web prop from the cost-analysis page)

/// One coalesced snapshot of the table's inputs — the native mirror of the web prop
/// (`data`) plus the parent surface's lifecycle (`isLoading`, an error message, and
/// connectivity). The buckets carry pre-aggregated display values verbatim from upstream,
/// so no SI conversion applies at this layer.
public struct MonthlyCostTableInput: Sendable, Equatable {
    public var buckets: [MonthlyCostBucket]?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: MonthlyCostTableConnection

    public init(
        buckets: [MonthlyCostBucket]? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: MonthlyCostTableConnection = .live
    ) {
        self.buckets = buckets
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the table's render branches.
/// `phase` selects the body; `rows` is pre-sorted (web default month / desc) so the view
/// is a pure function of this value.
public struct MonthlyCostTableResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let rows: [MonthlyCostBucket]

    public init(phase: Phase, rows: [MonthlyCostBucket]) {
        self.phase = phase
        self.rows = rows
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port of
/// the web component's render branch plus the P4 leaf contract. Unit tested across loading
/// / empty / error / data and the default sort.
public enum MonthlyCostTableProjection {
    public static func resolve(_ input: MonthlyCostTableInput) -> MonthlyCostTableResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return MonthlyCostTableResolved(phase: .error(message), rows: [])
        }
        // Initial fetch (web parent `isLoading`) or no snapshot yet.
        guard !input.isLoading, let buckets = input.buckets else {
            return MonthlyCostTableResolved(phase: .loading, rows: [])
        }
        let rows = MonthlyCostSort.defaultSorted(buckets)
        // Web empty render: `sortedData.length > 0 ? table : noData`.
        guard !rows.isEmpty else {
            return MonthlyCostTableResolved(phase: .empty, rows: [])
        }
        return MonthlyCostTableResolved(phase: .data, rows: rows)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// cost-analysis page's resolved monthly-breakdown query; previews and tests use
/// `InMemoryMonthlyCostTableSource`. The view never talks to the network directly.
@MainActor
public protocol MonthlyCostTableSource: AnyObject {
    var onUpdate: (@MainActor (MonthlyCostTableInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The table's observable view-model. Subscribes to a `MonthlyCostTableSource`, recomputes
/// the resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class MonthlyCostTableModel {
    public private(set) var resolved: MonthlyCostTableResolved =
        MonthlyCostTableProjection.resolve(MonthlyCostTableInput(isLoading: true))
    public private(set) var connection: MonthlyCostTableConnection = .live

    public var phase: MonthlyCostTableResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any MonthlyCostTableSource
    @ObservationIgnored private let telemetry: any MonthlyCostTableTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any MonthlyCostTableSource,
        telemetry: any MonthlyCostTableTelemetry = OSLogMonthlyCostTableTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MonthlyCostTable.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: MonthlyCostTableInput) {
        resolved = MonthlyCostTableProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryMonthlyCostTableSource: MonthlyCostTableSource {
    public var onUpdate: (@MainActor (MonthlyCostTableInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MonthlyCostTableInput?

    public init(initial: MonthlyCostTableInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: MonthlyCostTableInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "MonthlyCostTable" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum MonthlyCostTableStrings {
    public static let table = "MonthlyCostTable"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
