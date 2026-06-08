//
//  BackgroundWorkersCard.Model.swift
//  TeslaSync — P4 feature view · 0240 · BackgroundWorkersCard (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n
//  facade (P1/S10) for the Background-workers card. The view binds through
//  `BackgroundWorkersModel`; no networking lives in the view. The web card is a
//  presentational leaf fed by the page's `useQuery(getWorkersHealth)` (a 30s
//  refetch of GET /system/workers), so the native surface carries the coalesced
//  query snapshot — loading / fetching / error / response + the freshness +
//  connectivity flags the P4 states contract requires — rather than a parent
//  prop.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core diagnostics sink (consent-gated + redacted
/// there).
public protocol BackgroundWorkersTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogBackgroundWorkersTelemetry: BackgroundWorkersTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web useQuery state for getWorkersHealth)

/// One coalesced snapshot of the query — the native mirror of the fields the web
/// page reads off the hook (`isLoading`, `isFetching`, `error`, `data`) plus the
/// `isStale` / `isOffline` freshness + connectivity flags the production
/// state-holder derives from the query meta + network reachability (the P4 stale
/// / offline states). The view never touches HTTP — it reacts to this struct.
public struct WorkersInput: Sendable, Equatable {
    public var isLoading: Bool
    public var isFetching: Bool
    public var errorMessage: String?
    public var response: WorkersHealthSnapshot?
    public var isStale: Bool
    public var isOffline: Bool

    public init(
        isLoading: Bool = false,
        isFetching: Bool = false,
        errorMessage: String? = nil,
        response: WorkersHealthSnapshot? = nil,
        isStale: Bool = false,
        isOffline: Bool = false
    ) {
        self.isLoading = isLoading
        self.isFetching = isFetching
        self.errorMessage = errorMessage
        self.response = response
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

// MARK: - Resolved state (web render branches + P4 overlays)

/// The resolved, view-ready state — the native mirror of the web card's two
/// render branches (empty vs. populated) lifted into the standard P4 phase set,
/// plus the freshness / connectivity overlays the populated branch carries.
public struct WorkersResolved: Sendable, Equatable {
    /// The mutually-exclusive primary branches. `loading` / `error` come from the
    /// query seam (the web page owns them); `empty` is the web
    /// `!health || workers.length === 0` branch; `data` is the populated card.
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case empty
        case data
    }

    public let phase: Phase
    public let groups: [WorkerGroupProjection]
    public let summary: WorkersSummary
    public let isFetching: Bool
    public let isStale: Bool
    public let isOffline: Bool

    public init(
        phase: Phase,
        groups: [WorkerGroupProjection],
        summary: WorkersSummary,
        isFetching: Bool,
        isStale: Bool,
        isOffline: Bool
    ) {
        self.phase = phase
        self.groups = groups
        self.summary = summary
        self.isFetching = isFetching
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

/// Pure projection from the query snapshot to the resolved view-state — the
/// native port of the web `!health || workers.length === 0 ? empty : populated`
/// branch, lifted under the standard `loading` / `error` precedence. `error`
/// deliberately takes precedence over cached data (the page would surface the
/// failure, not stale rows). The stale / offline flags only annotate a populated
/// snapshot — they are overlays, not phases. Unit tested across every branch.
public enum WorkersProjection {
    public static func resolve(_ input: WorkersInput) -> WorkersResolved {
        let workers = input.response?.workers ?? []
        let groups = WorkersAdapter.group(workers)
        let summary = WorkersAdapter.summary(of: groups)
        let hasContent = !workers.isEmpty
        let isStale = hasContent && input.isStale
        let isOffline = hasContent && input.isOffline

        let phase: WorkersResolved.Phase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if workers.isEmpty {
            .empty
        } else {
            .data
        }

        return WorkersResolved(
            phase: phase,
            groups: groups,
            summary: summary,
            isFetching: input.isFetching,
            isStale: isStale,
            isOffline: isOffline
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared state-holder / query-parity layer (the 30s refetch of
/// GET /system/workers); previews and tests use `InMemoryWorkersSource`.
/// `refresh()` maps to the hook's `refetch`. The view never talks to the network.
@MainActor
public protocol WorkersSource: AnyObject {
    var onUpdate: (@MainActor (WorkersInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The card's observable view-model. Subscribes to a `WorkersSource`, recomputes
/// the resolved projection, and exposes a render `Phase` (plus the grouped rows,
/// summary, and freshness flags) for SwiftUI to switch over.
@MainActor
@Observable
public final class BackgroundWorkersModel {
    public private(set) var phase: WorkersResolved.Phase = .loading
    public private(set) var groups: [WorkerGroupProjection] = []
    public private(set) var summary = WorkersSummary(
        healthyGroups: 0,
        groupCount: 0,
        healthyInstances: 0,
        totalInstances: 0,
        multiInstanceGroups: 0
    )
    public private(set) var isFetching = false
    public private(set) var isStale = false
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any WorkersSource
    @ObservationIgnored private let telemetry: any BackgroundWorkersTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any WorkersSource,
        telemetry: any BackgroundWorkersTelemetry = OSLogBackgroundWorkersTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BackgroundWorkersCard.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches worker health (wired to the Refresh button + the error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: WorkersInput) {
        let resolved = WorkersProjection.resolve(input)
        phase = resolved.phase
        groups = resolved.groups
        summary = resolved.summary
        isFetching = resolved.isFetching
        isStale = resolved.isStale
        isOffline = resolved.isOffline
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryWorkersSource: WorkersSource {
    public var onUpdate: (@MainActor (WorkersInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WorkersInput?

    public init(initial: WorkersInput? = nil) {
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
    public func push(_ input: WorkersInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web literal copy → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "BackgroundWorkersCard"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time.
public enum BWStrings {
    public static let table = "BackgroundWorkersCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a key then fills `{{name}}` tokens, mirroring the web
    /// `t(key, default, { name: value })` i18next interpolation. An unmatched
    /// token is left verbatim.
    public static func format(_ key: String, _ fallback: String, _ args: [String: String]) -> String {
        var out = string(key, fallback)
        for (name, value) in args {
            out = out.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return out
    }
}
