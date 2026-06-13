//
//  VehicleMultiSelect.Seams.swift
//  TeslaSync — P4 shared surface · 0163 · VehicleMultiSelect (Apple)
//
//  The dependency seams the ``VehicleMultiSelectModel`` binds through, kept apart from the model for the
//  SwiftLint file-length budget: the P1/S11 telemetry seam (the `view.opened` sink), the P4 render phase, the
//  snapshot the host pushes (the web editor's `value` selection + the `vehicles` fleet from `useVehicles()`,
//  plus the validation `errorKey`, the `disabled` flag, and the in-flight / fetch-error / connectivity axis),
//  the P1/S8 read source seam, the production source, and the in-memory source for previews + tests. The view
//  never reads the source directly — it goes through the model, which goes through these seams. No networking
//  lives here.
//
//  Binding note: in production the source is implemented over the shared fleet feed (`useVehicles()`) and the
//  Alert Studio editor's controlled `value`; a toggle routes back out through the model's host-supplied
//  `onChange` closure (the native peer of the web `onChange` prop), and the host re-emits the new value as a
//  fresh snapshot — preserving the web controlled-component contract without the view ever touching the
//  network.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter forwarding to the consent-gated shared-core diagnostics sink.
public protocol VehicleMultiSelectTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogVehicleMultiSelectTelemetry: VehicleMultiSelectTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Phase (P4 leaf contract)

/// The render phase. The web component always renders the trigger (disabled for an empty fleet) and never
/// fetches; `loading` / `error` are the P4 always-render leaf states the native surface adds so it never
/// collapses to a blank box. The validation `errorKey` is orthogonal — it tints the trigger + shows inline
/// error text in EVERY phase, exactly as the web `errorKey` prop does.
public enum VehicleMultiSelectPhase: Sendable, Equatable {
    /// The fleet is resolving (web `useVehicles()` has not resolved) — skeleton chrome.
    case loading
    /// At least one vehicle resolved — the trigger + popover (the web body).
    case content
    /// The fleet resolved empty (web `vehicles.length === 0`) — the disabled trigger + the empty-fleet help.
    case empty
    /// The fleet read failed — a retry affordance (web has no peer; added so the surface never blanks).
    case error(String)
}

// MARK: - Snapshot (the host's current editor + fleet state)

/// The host's current picker state pushed through the source — the web editor's controlled `value`, the
/// `vehicles` fleet (`useVehicles()`), the validation `errorKey` + `disabled` props, the in-flight / fetch-
/// error flags, and the connectivity axis.
public struct VehicleMultiSelectSnapshot: Sendable, Equatable {
    /// The fleet (web `vehicles`), in display order.
    public let vehicles: [VehicleMultiSelectVehicle]
    /// The controlled selection (web `value`).
    public let value: VehicleMultiSelectValue
    /// The inline validation error key (web `errorKey`), resolved by the facade; `nil` when valid.
    public let errorKey: String?
    /// Whether the control is disabled (web `disabled`).
    public let disabled: Bool
    /// Whether the fleet is still loading (web `useVehicles()` pending).
    public let isLoading: Bool
    /// The fleet failure reason, if any — surfaced verbatim by the error state.
    public let errorMessage: String?
    /// The live-state freshness axis.
    public let connection: VehicleMultiSelectConnection

    public init(
        vehicles: [VehicleMultiSelectVehicle],
        value: VehicleMultiSelectValue = .allSticky,
        errorKey: String? = nil,
        disabled: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleMultiSelectConnection = .live
    ) {
        self.vehicles = vehicles
        self.value = value
        self.errorKey = errorKey
        self.disabled = disabled
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Read source seam (P1/S8) — the host's current fleet + selection

/// The read seam the model binds through. The production app re-emits the host's current `useVehicles()`
/// fleet + the editor's controlled `value` (`LiveVehicleMultiSelectSource`); previews and tests use
/// `InMemoryVehicleMultiSelectSource`. The view never reads it directly.
@MainActor
public protocol VehicleMultiSelectSource: AnyObject {
    var onUpdate: (@MainActor (VehicleMultiSelectSnapshot) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the fleet (web refetch) — the error-state retry + the stale auto-refresh.
    func refresh()
}

/// The production read source — holds the host's current snapshot and re-emits it whenever the host updates
/// it (a fresh fleet, a new selection, a validation change, or a connectivity transition). The production app
/// builds this over the `useVehicles()` fleet feed + the Alert Studio editor's controlled value.
@MainActor
public final class LiveVehicleMultiSelectSource: VehicleMultiSelectSource {
    public var onUpdate: (@MainActor (VehicleMultiSelectSnapshot) -> Void)?
    private var snapshot: VehicleMultiSelectSnapshot

    public init(snapshot: VehicleMultiSelectSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Push a fresh snapshot (the host's new fleet / selection / validation / connectivity) and re-emit it.
    public func update(_ snapshot: VehicleMultiSelectSnapshot) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

/// A fully-working in-memory source for previews + tests. Emits a fixed snapshot on `start()`, records
/// refreshes, and lets a test push further snapshots via `push(_:)` (the controlled-parent re-emit).
@MainActor
public final class InMemoryVehicleMultiSelectSource: VehicleMultiSelectSource {
    public var onUpdate: (@MainActor (VehicleMultiSelectSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    private let snapshot: VehicleMultiSelectSnapshot

    public init(snapshot: VehicleMultiSelectSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        startCount += 1
        onUpdate?(snapshot)
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
        onUpdate?(snapshot)
    }

    /// Pushes a snapshot to the bound model (test / preview affordance — the controlled-parent re-emit).
    public func push(_ update: VehicleMultiSelectSnapshot) {
        onUpdate?(update)
    }
}
