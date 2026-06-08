//
//  FSMStateDiagram.Model.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the FSM state-diagram panel. The web source
//  (features/system/components/FSMStateDiagram.tsx) is a pure presentational leaf fed
//  `fsmType` + `transitions` by its parent (the FSM debugger page), so the input snapshot
//  here carries those props plus the parent's lifecycle (loading / error) and the leaf
//  connectivity axis. The view binds through `FSMStateDiagramModel`; no networking lives
//  in the view.
//

import Foundation
import Observation
import OSLog

// MARK: - Diagnostics surface identity (P1/S11)

/// The surface slug emitted with the `view.opened` diagnostics event. Kept off the
/// SwiftUI view so the model + tests reference it without importing SwiftUI.
public enum FSMStateDiagramDiagnostics {
    public static let surface = "FSMStateDiagram"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter forwarding to the shared-core
/// diagnostics sink (consent-gated + redacted there).
public protocol FSMStateDiagramTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogFSMStateDiagramTelemetry: FSMStateDiagramTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// Reports the surface-open `view.opened` event (P1/S11). Extracted so the diagnostics
/// wiring is unit-testable without hosting SwiftUI.
public enum FSMStateDiagramOpenReporter {
    public static func report(using telemetry: any FSMStateDiagramTelemetry) {
        telemetry.viewOpened(surface: FSMStateDiagramDiagnostics.surface)
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as the
/// header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum FSMConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Transition (web FSMTransition API row)

/// One FSM transition row — the native mirror of the web `FSMTransition` interface
/// (snake_case JSON), the element of the `transitions` prop. Only `fsm_name`, `ts`,
/// `from_state`, and `to_state` drive the diagram; the rest is carried for parity.
public struct FSMTransition: Sendable, Equatable, Identifiable {
    public let id: Int
    public let vehicleID: Int
    public let ts: String
    public let fsmName: String
    public let fromState: String
    public let toState: String
    public let trigger: String
    public let details: [String: String]?

    public init(
        id: Int,
        vehicleID: Int,
        ts: String,
        fsmName: String,
        fromState: String,
        toState: String,
        trigger: String = "",
        details: [String: String]? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.ts = ts
        self.fsmName = fsmName
        self.fromState = fromState
        self.toState = toState
        self.trigger = trigger
        self.details = details
    }
}

// MARK: - Input snapshot (web props from the FSM debugger page)

/// One coalesced snapshot of the panel's inputs — the native mirror of the web props
/// (`fsmType`, `transitions`) plus the parent surface's lifecycle (`isLoading`, an error
/// message, and connectivity).
public struct FSMStateDiagramInput: Sendable, Equatable {
    public var fsmType: String
    public var transitions: [FSMTransition]
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: FSMConnection

    public init(
        fsmType: String,
        transitions: [FSMTransition] = [],
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: FSMConnection = .live
    ) {
        self.fsmType = fsmType
        self.transitions = transitions
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the FSM
/// debugger page's resolved transitions query (web `useFSMTransitions`); previews + tests
/// use `InMemoryFSMStateDiagramSource`. The view never talks to the network directly.
@MainActor
public protocol FSMStateDiagramSource: AnyObject {
    var onUpdate: (@MainActor (FSMStateDiagramInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryFSMStateDiagramSource: FSMStateDiagramSource {
    public var onUpdate: (@MainActor (FSMStateDiagramInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FSMStateDiagramInput?

    public init(initial: FSMStateDiagramInput? = nil) {
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
    public func push(_ input: FSMStateDiagramInput) {
        onUpdate?(input)
    }
}

// MARK: - View-model (P1/S8 binding)

/// The panel's observable view-model. Subscribes to a `FSMStateDiagramSource`, recomputes
/// the resolved projection, exposes the render `phase` + the resolved view-state and the
/// `connection` axis, and auto-refreshes once when the feed transitions to stale.
@MainActor
@Observable
public final class FSMStateDiagramModel {
    public private(set) var resolved: FSMStateDiagramResolved
    public private(set) var connection: FSMConnection = .live

    public var phase: FSMStateDiagramResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any FSMStateDiagramSource
    @ObservationIgnored private let telemetry: any FSMStateDiagramTelemetry
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared transitions feed.
    public init(
        source: any FSMStateDiagramSource,
        telemetry: any FSMStateDiagramTelemetry = OSLogFSMStateDiagramTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        resolved = FSMStateDiagramResolved(phase: .loading)
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Web-prop binding: render a fixed snapshot (previews / tests / host wiring) without
    /// the shared core. Mirrors the web `{ fsmType, transitions }` plus the leaf lifecycle.
    public convenience init(
        input: FSMStateDiagramInput,
        telemetry: any FSMStateDiagramTelemetry = OSLogFSMStateDiagramTelemetry()
    ) {
        self.init(source: InMemoryFSMStateDiagramSource(initial: input), telemetry: telemetry)
        apply(input)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FSMStateDiagramDiagnostics.surface)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: FSMStateDiagramInput) {
        resolved = FSMStateDiagramProjection.resolve(input)
        let previous = connection
        connection = input.connection
        // Stale → one-shot auto-refresh on the transition (web parent re-fetch).
        if input.connection == .stale, previous != .stale {
            source.refresh()
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "FSMStateDiagram" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time (kept separate so parallel surface
/// prompts never collide on the shared catalog).
public enum FSMStateDiagramStrings {
    public static let table = "FSMStateDiagram"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
