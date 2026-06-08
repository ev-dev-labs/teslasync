//
//  AnomalyInlineRow.Seams.swift
//  TeslaSync — P4 feature view · 0238 · AnomalyInlineRow (Apple)
//
//  The dependency seams the AnomalyInlineRow view-model binds through, kept apart from
//  the model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n
//  facade (web has no `t()` of its own — these keys back the native-only chrome the
//  Apple surface contract requires), the coalesced source snapshot, the P1/S8 source
//  protocol (production wraps the shared `useVehicles` + `useAnomalies` holders), and
//  the in-memory source for previews / tests. The view never talks to the network.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted
/// there. `Sendable` so the model can emit from `start()` without a main-actor hop.
public protocol AnomalyInlineRowTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The
/// slug is a static, non-identifying constant logged verbatim; no payload, VIN, signal,
/// or location is ever recorded.
public struct OSLogAnomalyInlineRowTelemetry: AnomalyInlineRowTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web has no literals; native chrome only

/// Resolves the surface's strings by key with an English fallback, so the views hold no
/// hardcoded literals. Keys live in the "AnomalyInlineRow" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each
/// parallel prompt owns its own strings (parallel-safe across the concurrent slots).
public enum AnomalyInlineRowStrings {
    public static let table = "AnomalyInlineRow"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Live-stream freshness (ADR-013)

/// Live-stream freshness: drives the trailing freshness chip so a cached row is clearly
/// labeled while reconnecting / offline (ADR-013).
public enum AnomalyInlineRowConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by an `AnomalyInlineRowSource`: the load status, the
/// resolved anomalies payload (`nil` until the first response / when no vehicle is
/// available to query), the live-state freshness, and the last-updated stamp.
public struct AnomalyInlineRowUpdate: Sendable, Equatable {
    public var status: AnomalyInlineRowLoadStatus
    public var data: AnomalyData?
    public var connection: AnomalyInlineRowConnection
    public var updatedAt: Date?

    public init(
        status: AnomalyInlineRowLoadStatus = .loading,
        data: AnomalyData? = nil,
        connection: AnomalyInlineRowConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.data = data
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view-model binds through. Production implements this over the shared
/// P1/S8 holders: it reads the first vehicle id from the `useVehicles` holder (web
/// `vehicles?.[0]?.id`), runs the `useAnomalies` query for `days=1`, and pushes a
/// coalesced `AnomalyInlineRowUpdate`. Previews / tests use
/// `InMemoryAnomalyInlineRowSource`. No networking lives in the view.
@MainActor
public protocol AnomalyInlineRowSource: AnyObject {
    var onUpdate: (@MainActor (AnomalyInlineRowUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (the stale auto-refresh / the error-state retry).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAnomalyInlineRowSource: AnomalyInlineRowSource {
    public var onUpdate: (@MainActor (AnomalyInlineRowUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AnomalyInlineRowUpdate?

    public init(initial: AnomalyInlineRowUpdate? = nil) {
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
    public func push(_ update: AnomalyInlineRowUpdate) {
        onUpdate?(update)
    }
}
