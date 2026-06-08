//
//  FSMSubFSMPanel.Model.swift
//  TeslaSync — P4 feature view · 0230 · FSMSubFSMPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the active sub-FSM panel. The view binds through `FSMSubFSMModel`; no
//  networking lives in the view. The web source (FSMSubFSMPanel.tsx) is a pure
//  presentational leaf fed `activeSubs` + `fsmType` props by its parent (the FSM debugger
//  / system page), so the input snapshot here carries those (plus the parent's loading /
//  error / connectivity state) rather than issuing HTTP itself.
//
//  States: the web leaf's own branches are the `isVehicleView` guard (`return null`), the
//  empty render (`subs.length === 0`), and the populated grid. On top of those, this
//  surface honours the P4 leaf contract (the same one AcDcStatsPanel/0096 ships): a `phase`
//  (notApplicable / loading / empty / error / data) fed by the parent's query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness chip +
//  banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol FSMSubFSMTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogFSMSubFSMTelemetry: FSMSubFSMTelemetry {
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
public enum FSMSubFSMConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the parent page)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web props
/// (`activeSubs`, `fsmType`) plus the parent surface's lifecycle (`isLoading`, an error
/// message, and connectivity).
public struct FSMSubFSMInput: Sendable, Equatable {
    public var fsmType: String
    public var activeSubs: [FSMSubFSMEntry]?
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: FSMSubFSMConnection

    public init(
        fsmType: String = "vehicle",
        activeSubs: [FSMSubFSMEntry]? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: FSMSubFSMConnection = .live
    ) {
        self.fsmType = fsmType
        self.activeSubs = activeSubs
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branches + P4 leaf contract)

/// One resolved row — the native, view-ready projection of an `FSMSubFSMEntry`. The
/// semantic `variant` and the `isActive` flag are pre-computed (pure) so the view is a pure
/// function of this value; `state` + `startTime` stay raw so the view formats the badge
/// label and the relative timestamp at render time.
public struct FSMSubFSMRow: Identifiable, Sendable, Equatable {
    public let id: String
    public let kind: FSMSubFSMKind
    public let state: String
    public let startTime: String
    public let variant: FSMSubFSMVariant
    public let isActive: Bool

    public init(
        id: String,
        kind: FSMSubFSMKind,
        state: String,
        startTime: String,
        variant: FSMSubFSMVariant,
        isActive: Bool
    ) {
        self.id = id
        self.kind = kind
        self.state = state
        self.startTime = startTime
        self.variant = variant
        self.isActive = isActive
    }
}

/// The resolved, view-ready state — the native mirror of the panel's render branches.
/// `phase` selects the body; `rows` carries the projected sub-FSM cards for `.data`.
public struct FSMSubFSMResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        /// Web `if (!isVehicleView) return null` — the surface renders nothing.
        case notApplicable
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let rows: [FSMSubFSMRow]

    public init(phase: Phase, rows: [FSMSubFSMRow]) {
        self.phase = phase
        self.rows = rows
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native port of
/// the web component's render branches plus the P4 leaf contract. Unit tested across
/// notApplicable / loading / empty / error / data and the row mapping.
public enum FSMSubFSMProjection {
    public static func resolve(_ input: FSMSubFSMInput) -> FSMSubFSMResolved {
        // Web guard #1: non-vehicle FSM types render nothing (`return null`). Takes
        // precedence over every other branch, exactly as the early return does in the source.
        guard FSMSubFSMApplicability.isVehicleView(input.fsmType) else {
            return FSMSubFSMResolved(phase: .notApplicable, rows: [])
        }
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return FSMSubFSMResolved(phase: .error(message), rows: [])
        }
        // P4 contract: initial fetch (web parent `isLoading`) → skeleton chrome.
        if input.isLoading {
            return FSMSubFSMResolved(phase: .loading, rows: [])
        }
        // Web `const subs = activeSubs ?? []` then the `subs.length === 0` empty branch.
        let rows = (input.activeSubs ?? []).map(row(from:))
        guard !rows.isEmpty else {
            return FSMSubFSMResolved(phase: .empty, rows: [])
        }
        return FSMSubFSMResolved(phase: .data, rows: rows)
    }

    /// Projects one entry into a view-ready row — the native port of the web `subs.map`
    /// body (the `key={sub.type}`, the icon/label selection, and the `isActive` derivation).
    static func row(from entry: FSMSubFSMEntry) -> FSMSubFSMRow {
        FSMSubFSMRow(
            id: entry.kind.rawValue,
            kind: entry.kind,
            state: entry.state,
            startTime: entry.startTime,
            variant: FSMSubFSMStateModel.variant(for: entry.kind, state: entry.state),
            isActive: FSMSubFSMStateModel.isActive(kind: entry.kind, state: entry.state)
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the FSM
/// debugger page's resolved `active_subs` query; previews and tests use
/// `InMemoryFSMSubFSMSource`. The view never talks to the network directly.
@MainActor
public protocol FSMSubFSMSource: AnyObject {
    var onUpdate: (@MainActor (FSMSubFSMInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The panel's observable view-model. Subscribes to an `FSMSubFSMSource`, recomputes the
/// resolved projection, exposes a render `phase` + the resolved view-state and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class FSMSubFSMModel {
    public private(set) var resolved: FSMSubFSMResolved =
        FSMSubFSMProjection.resolve(FSMSubFSMInput(isLoading: true))
    public private(set) var connection: FSMSubFSMConnection = .live

    public var phase: FSMSubFSMResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any FSMSubFSMSource
    @ObservationIgnored private let telemetry: any FSMSubFSMTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any FSMSubFSMSource,
        telemetry: any FSMSubFSMTelemetry = OSLogFSMSubFSMTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FSMSubFSMPanel.surfaceSlug)
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

    private func apply(_ input: FSMSubFSMInput) {
        resolved = FSMSubFSMProjection.resolve(input)
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
public final class InMemoryFSMSubFSMSource: FSMSubFSMSource {
    public var onUpdate: (@MainActor (FSMSubFSMInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FSMSubFSMInput?

    public init(initial: FSMSubFSMInput? = nil) {
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
    public func push(_ input: FSMSubFSMInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "FSMSubFSMPanel" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time.
public enum FSMSubFSMStrings {
    public static let table = "FSMSubFSMPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
