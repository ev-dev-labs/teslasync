//
//  SignalStatsPanel.Model.swift
//  TeslaSync — P4 feature view · 0272 · SignalStatsPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the per-signal stats summary panel. The view binds through
//  `SignalStatsModel`; no networking lives in the view. The web source
//  (SignalStatsPanel.tsx) is a pure presentational leaf fed `stats` (and an optional
//  `selectedSignals` list) by its parent (the Workspace / Explorer telemetry pages),
//  so the input snapshot here carries those inputs plus the parent's loading / error
//  and the orthogonal connectivity state rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are data-driven (the gap-filled rows, the
//  count-driven empty hint, the "no stats" fallback). On top of those, this surface
//  honours the P4 leaf contract (the same one AcDcStatsPanel/0096 ships): a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness
//  chip + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol SignalStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogSignalStatsTelemetry: SignalStatsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum SignalStatsConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the telemetry pages)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web
/// props (`stats`, `selectedSignals`, `signalIndex`, `title`) plus the parent
/// surface's lifecycle (`loading`, an error message, and connectivity). The stat
/// values are unit-free numbers carried verbatim from upstream, so no SI conversion
/// applies at this layer.
public struct SignalStatsInput: Sendable, Equatable {
    public var stats: [SignalStat]
    public var selectedSignals: [String]?
    public var signalIndex: [String: Int]?
    public var title: String?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: SignalStatsConnection

    public init(
        stats: [SignalStat] = [],
        selectedSignals: [String]? = nil,
        signalIndex: [String: Int]? = nil,
        title: String? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: SignalStatsConnection = .live
    ) {
        self.stats = stats
        self.selectedSignals = selectedSignals
        self.signalIndex = signalIndex
        self.title = title
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the panel's render
/// branches. `phase` selects the body; the colour-indexed rows and the empty-row
/// count are pre-computed so the view is a pure function of this value (plus the
/// local hide-empty toggle it owns).
public struct SignalStatsResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let rows: [SignalStatRow]
    public let emptyCount: Int
    public let title: String?

    public init(phase: Phase, rows: [SignalStatRow], emptyCount: Int, title: String?) {
        self.phase = phase
        self.rows = rows
        self.emptyCount = emptyCount
        self.title = title
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branches plus the P4 leaf contract. Unit
/// tested across loading / empty / error / data and the gap-fill / empty-count
/// bookkeeping.
public enum SignalStatsProjection {
    public static func resolve(_ input: SignalStatsInput) -> SignalStatsResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return SignalStatsResolved(phase: .error(message), rows: [], emptyCount: 0, title: input.title)
        }
        // Web `loading ? <skeletons> : …` — the initial fetch chrome wins over data.
        guard !input.isLoading else {
            return SignalStatsResolved(phase: .loading, rows: [], emptyCount: 0, title: input.title)
        }
        let rows = SignalStatRows.rows(
            stats: input.stats,
            selectedSignals: input.selectedSignals,
            signalIndex: input.signalIndex
        )
        // Web shows "No stats available" when there is nothing at all to render.
        guard !rows.isEmpty else {
            return SignalStatsResolved(phase: .empty, rows: [], emptyCount: 0, title: input.title)
        }
        return SignalStatsResolved(
            phase: .data,
            rows: rows,
            emptyCount: SignalStatRows.emptyCount(rows),
            title: input.title
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// telemetry page's resolved signal-stats query; previews and tests use
/// `InMemorySignalStatsSource`. The view never talks to the network directly.
@MainActor
public protocol SignalStatsSource: AnyObject {
    var onUpdate: (@MainActor (SignalStatsInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `SignalStatsSource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class SignalStatsModel {
    public private(set) var resolved: SignalStatsResolved =
        SignalStatsProjection.resolve(SignalStatsInput(isLoading: true))
    public private(set) var connection: SignalStatsConnection = .live

    public var phase: SignalStatsResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any SignalStatsSource
    @ObservationIgnored private let telemetry: any SignalStatsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SignalStatsSource,
        telemetry: any SignalStatsTelemetry = OSLogSignalStatsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SignalStatsPanel.surfaceSlug)
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

    private func apply(_ input: SignalStatsInput) {
        resolved = SignalStatsProjection.resolve(input)
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
public final class InMemorySignalStatsSource: SignalStatsSource {
    public var onUpdate: (@MainActor (SignalStatsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalStatsInput?

    public init(initial: SignalStatsInput? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ input: SignalStatsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SignalStatsPanel" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum SignalStatsStrings {
    public static let table = "SignalStatsPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves `signalStats.hideEmpty` and interpolates the empty-row count (web
    /// `Hide empty ({{count}})`).
    public static func hideEmpty(count: Int) -> String {
        String(format: string("signalStats.hideEmpty", "Hide empty (%lld)"), count)
    }
}
