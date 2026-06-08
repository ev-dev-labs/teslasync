//
//  EventHistoryTable.Model.swift
//  TeslaSync — P4 feature view · 0042 · EventHistoryTable (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the Security Event History table. The view binds through
//  `EventHistoryModel`; no networking lives in the view. The web source
//  (EventHistoryTable.tsx) is a pure presentational leaf — its only hook is
//  `useTranslation`; it receives `history` + `isLoading` as props from its parent
//  (SecurityAccessPage's security-history query). So the native `EventHistorySource`
//  carries that parent prop snapshot (events / isLoading / an optional error) rather
//  than issuing HTTP itself; the projection is the same one the web render performs.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept here (not on
/// the SwiftUI view) so the model + tests reference it without importing SwiftUI.
public enum EventHistoryDiagnostics {
    public static let surface = "EventHistoryTable"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol EventHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogEventHistoryTelemetry: EventHistoryTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web props from the parent security-history query)

/// One coalesced snapshot of the table's inputs — the native mirror of the web props
/// (`history`, `isLoading`) plus an optional `errorMessage` so a failed parent query can
/// surface natively (the web leaf has no error branch; its parent owns the query and a
/// failure arrives as an error snapshot here, rendered as the QueryError-equivalent the
/// P4 states contract requires).
public struct EventHistoryInput: Sendable, Equatable {
    public var events: [SecurityEventInput]
    public var isLoading: Bool
    public var errorMessage: String?

    public init(
        events: [SecurityEventInput] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil
    ) {
        self.events = events
        self.isLoading = isLoading
        self.errorMessage = errorMessage
    }
}

// MARK: - Resolved render state (the web render branches)

/// The resolved, view-ready state — the native mirror of the web render
/// (`isLoading ? <Skeleton/> : <DataTable …/>`, where the table resolves data vs its
/// empty message), plus the native error branch.
public struct EventHistoryResolved: Sendable, Equatable {
    /// The mutually-exclusive render branches.
    public enum Phase: Sendable, Equatable {
        case loading
        case data
        case empty
        case error(String)
    }

    public let phase: Phase
    public let rows: [EventHistoryRow]

    public init(phase: Phase, rows: [EventHistoryRow]) {
        self.phase = phase
        self.rows = rows
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web `isLoading ? skeleton : (history.length ? table : emptyMessage)` ladder,
/// with the native error branch slotted after loading. Unit-tested across every branch.
public enum EventHistoryProjection {
    public static func resolve(_ input: EventHistoryInput) -> EventHistoryResolved {
        if input.isLoading {
            return EventHistoryResolved(phase: .loading, rows: [])
        }
        if let message = input.errorMessage, !message.isEmpty {
            return EventHistoryResolved(phase: .error(message), rows: [])
        }
        let rows = EventHistoryAdapter.rows(from: input.events)
        return EventHistoryResolved(phase: rows.isEmpty ? .empty : .data, rows: rows)
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the parent
/// security-history query (web `useSecurityHistory`); previews + tests use
/// `InMemoryEventHistorySource`. The view never talks to the network directly.
@MainActor
public protocol EventHistorySource: AnyObject {
    var onUpdate: (@MainActor (EventHistoryInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The table's observable view-model. Subscribes to an `EventHistorySource`, recomputes
/// the resolved projection, and exposes a render `Phase` + rows for SwiftUI to switch over.
@MainActor
@Observable
public final class EventHistoryModel {
    public private(set) var phase: EventHistoryResolved.Phase = .loading
    public private(set) var rows: [EventHistoryRow] = []

    @ObservationIgnored private let source: any EventHistorySource
    @ObservationIgnored private let telemetry: any EventHistoryTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any EventHistorySource,
        telemetry: any EventHistoryTelemetry = OSLogEventHistoryTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EventHistoryDiagnostics.surface)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the history (wired to the retry affordance in the error state).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: EventHistoryInput) {
        let resolved = EventHistoryProjection.resolve(input)
        phase = resolved.phase
        rows = resolved.rows
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryEventHistorySource: EventHistorySource {
    public var onUpdate: (@MainActor (EventHistoryInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EventHistoryInput?

    public init(initial: EventHistoryInput? = nil) {
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
    public func push(_ input: EventHistoryInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "EventHistoryTable" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time so each parallel surface owns its
/// own strings without editing the shared catalog.
public enum EHStrings {
    public static let table = "EventHistoryTable"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
