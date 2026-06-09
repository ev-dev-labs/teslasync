//
//  QueueStatusPanel.Model.swift
//  TeslaSync — P4 feature view · 0037 · QueueStatusPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n
//  facade (P1/S10) for the Queue-status panel. The view binds through
//  `QueueStatusModel`; no networking lives in the view. The web panel is fed by
//  `useQueueStatus` (a 30s refetch of GET /system/queues that pauses while the
//  tab is hidden), so the native surface carries the coalesced query snapshot —
//  loading / fetching / error / response + the freshness + connectivity flags
//  the P4 states contract requires — rather than a parent prop.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core diagnostics sink (consent-gated + redacted
/// there).
public protocol QueueStatusTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogQueueStatusTelemetry: QueueStatusTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web useQueueStatus query state)

/// One coalesced snapshot of the query — the native mirror of the fields the web
/// panel reads off the hook (`isLoading`, `isFetching`, `error`, `data`) plus the
/// `isStale` / `isOffline` freshness + connectivity flags the production
/// state-holder derives from the query meta + network reachability (the P4 stale
/// / offline states). The view never touches HTTP — it reacts to this struct.
public struct QueueStatusInput: Sendable, Equatable {
    public var isLoading: Bool
    public var isFetching: Bool
    public var errorMessage: String?
    public var response: QueueStatusSnapshot?
    public var isStale: Bool
    public var isOffline: Bool

    public init(
        isLoading: Bool = false,
        isFetching: Bool = false,
        errorMessage: String? = nil,
        response: QueueStatusSnapshot? = nil,
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

/// The resolved, view-ready state — the native mirror of the web panel's render
/// branches (loading / error / empty / populated) plus the freshness /
/// connectivity overlays the populated branch carries and the `generated_at`
/// "Updated …" stamp the header shows.
public struct QueueStatusResolved: Sendable, Equatable {
    /// The mutually-exclusive primary branches: `loading` is the web
    /// `isLoading` spinner, `error` is the web `error` box, `empty` is the web
    /// `workers.length === 0` branch, and `data` is the populated grid.
    public enum Phase: Sendable, Equatable {
        case loading
        case error(String)
        case empty
        case data
    }

    public let phase: Phase
    public let workers: [QueueWorkerProjection]
    public let generatedAt: Date?
    public let isFetching: Bool
    public let isStale: Bool
    public let isOffline: Bool

    public init(
        phase: Phase,
        workers: [QueueWorkerProjection],
        generatedAt: Date?,
        isFetching: Bool,
        isStale: Bool,
        isOffline: Bool
    ) {
        self.phase = phase
        self.workers = workers
        self.generatedAt = generatedAt
        self.isFetching = isFetching
        self.isStale = isStale
        self.isOffline = isOffline
    }
}

/// Pure projection from the query snapshot to the resolved view-state — the
/// native port of the web `isLoading ? … : error ? … : workers.length === 0 ? …
/// : grid` precedence. `error` deliberately takes precedence over cached data
/// (the panel surfaces the failure, not stale rows). The stale / offline flags
/// only annotate a populated snapshot — they are overlays, not phases. Unit
/// tested across every branch.
public enum QueueStatusProjection {
    public static func resolve(_ input: QueueStatusInput) -> QueueStatusResolved {
        let workers = input.response?.workers ?? []
        let projections = QueueStatusAdapter.project(workers)
        let hasContent = !workers.isEmpty
        let isStale = hasContent && input.isStale
        let isOffline = hasContent && input.isOffline

        let phase: QueueStatusResolved.Phase = if input.isLoading {
            .loading
        } else if let message = input.errorMessage, !message.isEmpty {
            .error(message)
        } else if workers.isEmpty {
            .empty
        } else {
            .data
        }

        return QueueStatusResolved(
            phase: phase,
            workers: projections,
            generatedAt: input.response?.generatedAt,
            isFetching: input.isFetching,
            isStale: isStale,
            isOffline: isOffline
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared state-holder / query-parity layer (the 30s refetch of
/// GET /system/queues); previews and tests use `InMemoryQueueStatusSource`.
/// `refresh()` maps to the hook's `refetch`. The view never talks to the network.
@MainActor
public protocol QueueStatusSource: AnyObject {
    var onUpdate: (@MainActor (QueueStatusInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to a `QueueStatusSource`,
/// recomputes the resolved projection, and exposes a render `Phase` (plus the
/// worker rows, the `generated_at` stamp, and the freshness flags) for SwiftUI to
/// switch over.
@MainActor
@Observable
public final class QueueStatusModel {
    public private(set) var phase: QueueStatusResolved.Phase = .loading
    public private(set) var workers: [QueueWorkerProjection] = []
    public private(set) var generatedAt: Date?
    public private(set) var isFetching = false
    public private(set) var isStale = false
    public private(set) var isOffline = false

    @ObservationIgnored private let source: any QueueStatusSource
    @ObservationIgnored private let telemetry: any QueueStatusTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any QueueStatusSource,
        telemetry: any QueueStatusTelemetry = OSLogQueueStatusTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: QueueStatusPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches queue status (wired to the Refresh button + the error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: QueueStatusInput) {
        let resolved = QueueStatusProjection.resolve(input)
        phase = resolved.phase
        workers = resolved.workers
        generatedAt = resolved.generatedAt
        isFetching = resolved.isFetching
        isStale = resolved.isStale
        isOffline = resolved.isOffline
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryQueueStatusSource: QueueStatusSource {
    public var onUpdate: (@MainActor (QueueStatusInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: QueueStatusInput?

    public init(initial: QueueStatusInput? = nil) {
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
    public func push(_ input: QueueStatusInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web literal copy → keyed strings

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "QueueStatusPanel" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum QSStrings {
    public static let table = "QueueStatusPanel"

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
