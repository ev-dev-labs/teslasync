//
//  SnapshotInspector.Seams.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  The dependency seams the SnapshotInspector view-model binds through, kept apart from
//  the model for the lint length budget: the P1/S11 telemetry contract, the P1/S10 i18n
//  facade (the web inspector resolves its strings through `t()` — these keys back the
//  same copy on Apple), the coalesced source snapshot, the P1/S8 source protocol
//  (production wraps the FSM-debugger's `useTelemetry` snapshot reads), and the in-memory
//  source for previews / tests. The view never talks to the network.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted there.
/// `Sendable` so the model can emit from `start()` without a main-actor hop.
public protocol SnapshotInspectorTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`. The slug
/// is a static, non-identifying constant logged verbatim; no payload, VIN, signal, or
/// location is ever recorded.
public struct OSLogSnapshotInspectorTelemetry: SnapshotInspectorTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10)

/// Resolves the surface's strings by key with an English fallback, so the views hold no
/// hardcoded literals. Keys live in the "SnapshotInspector" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel
/// prompt owns its own strings (parallel-safe across the concurrent slots).
public enum SnapshotInspectorStrings {
    public static let table = "SnapshotInspector"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Live-stream freshness (ADR-013)

/// Live-stream freshness: drives the trailing freshness chip so cached detail is clearly
/// labeled while reconnecting / offline (ADR-013).
public enum SnapshotInspectorConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `SnapshotInspectorSource`: the load status, the
/// resolved inspector input (the selected transition + snapshot + diff context), the
/// live-state freshness, and the last-updated stamp.
public struct SnapshotInspectorUpdate: Sendable, Equatable {
    public var status: SnapshotInspectorLoadStatus
    public var input: SnapshotInspectorInput
    public var connection: SnapshotInspectorConnection
    public var updatedAt: Date?

    public init(
        status: SnapshotInspectorLoadStatus = .loading,
        input: SnapshotInspectorInput,
        connection: SnapshotInspectorConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view-model binds through. Production implements this over the shared
/// P1/S8 holders: it observes the FSM-debugger selection + the `useTelemetry` snapshot
/// reads and pushes a coalesced `SnapshotInspectorUpdate`. Previews / tests use
/// `InMemorySnapshotInspectorSource`. No networking lives in the view.
@MainActor
public protocol SnapshotInspectorSource: AnyObject {
    var onUpdate: (@MainActor (SnapshotInspectorUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (the stale auto-refresh / the error-state retry).
    func refresh()
    /// Switches the debugger to Freeze mode and selects the last transition (web
    /// `onJumpToLast`).
    func jumpToLastTransition()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySnapshotInspectorSource: SnapshotInspectorSource {
    public var onUpdate: (@MainActor (SnapshotInspectorUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var jumpCount = 0

    private let initial: SnapshotInspectorUpdate?

    public init(initial: SnapshotInspectorUpdate? = nil) {
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

    public func jumpToLastTransition() {
        jumpCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: SnapshotInspectorUpdate) {
        onUpdate?(update)
    }
}
