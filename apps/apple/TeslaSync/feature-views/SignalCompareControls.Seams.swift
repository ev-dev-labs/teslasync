//
//  SignalCompareControls.Seams.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  The dependency seams the SignalCompareControls view-model binds through, kept apart
//  from the model for the lint length budget: the P1/S11 telemetry contract (web
//  `view.opened`), the change sink (web `onChangeA` / `onChangeB` / `onSearchChange` /
//  `onCategoryChange` coalesced into one controlled-selection echo), the coalesced
//  source snapshot, the P1/S8 source protocol, and the in-memory source for
//  previews/tests. Foundation + OSLog only (no SwiftUI / no network).
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared
/// core `Telemetry.track(.screenView(screen:…))` (ADR-016), consent-gated + redacted.
public protocol SignalCompareTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSignalCompareTelemetry: SignalCompareTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Change sink (web `onChange*`)

/// Receives each controlled-selection patch the bar produces (web `onChangeA` /
/// `onChangeB` / `onSearchChange` / `onCategoryChange`), so the host page can adopt it.
/// The production app injects a sink that writes into its compare query state; the
/// default logs the change so the view stays I/O-free.
public protocol SignalCompareChangeSink: Sendable {
    func selectionChanged(_ selection: SignalCompareSelection)
}

/// `os.Logger`-backed default that records each selection change for diagnostics. Window
/// timestamps are not logged (PII-adjacent); only their presence + the category id is.
public struct OSLogSignalCompareChangeSink: SignalCompareChangeSink {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "signal-compare")
    }

    public func selectionChanged(_ selection: SignalCompareSelection) {
        let summary = "a=\(selection.atA.isEmpty ? 0 : 1)"
            + " b=\(selection.atB.isEmpty ? 0 : 1)"
            + " q=\(selection.search.isEmpty ? 0 : 1)"
            + " cat=\(selection.category ?? "-")"
        logger.debug("signal.compare.changed \(summary, privacy: .public)")
    }
}

// MARK: - Source snapshot + P1/S8 source protocol

/// One coalesced snapshot pushed by a `SignalCompareSource`: the host's current
/// controlled selection (web parent props), the catalog of comparable signal names for
/// the vehicle (drives the empty vs. content phase + the a11y count), the load status,
/// the live-state freshness, the in-flight flag, and the last update time.
public struct SignalCompareUpdate: Sendable, Equatable {
    public var status: SignalCompareLoadStatus
    public var selection: SignalCompareSelection
    public var availableSignals: [String]
    public var connection: SignalCompareConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SignalCompareLoadStatus = .loading,
        selection: SignalCompareSelection = SignalCompareSelection(),
        availableSignals: [String] = [],
        connection: SignalCompareConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.selection = selection
        self.availableSignals = availableSignals
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8
/// signals state holder (available signals + the compare selection + live freshness);
/// previews/tests use `InMemorySignalCompareSource`. The view never talks to the
/// network directly.
@MainActor
public protocol SignalCompareSource: AnyObject {
    var onUpdate: (@MainActor (SignalCompareUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying available-signals query (web parent refetch / the stale
    /// auto-refresh).
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemorySignalCompareSource: SignalCompareSource {
    public var onUpdate: (@MainActor (SignalCompareUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SignalCompareUpdate?

    public init(initial: SignalCompareUpdate? = nil) {
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
    public func push(_ update: SignalCompareUpdate) {
        onUpdate?(update)
    }
}
