//
//  VehicleSelect.Seams.swift
//  TeslaSync — P4 shared surface · 0164 · VehicleSelect (Apple)
//
//  The dependency seams the ``VehicleSelectModel`` binds through, kept apart from the model for the SwiftLint
//  file-length budget: the P1/S11 telemetry seam (the `view.opened` sink), the P4 render phase, the snapshot
//  the host pushes (the web `useSelectedVehicle()` value — the `vehicles` list + the current `vehicleId` —
//  plus the in-flight/error/connectivity axis), the P1/S8 read source seam, the production source, and the
//  in-memory source for previews + tests. The view never reads the source directly — it goes through the
//  model, which goes through these seams. No networking lives here.
//
//  Binding note: in production the source is implemented over the shared selected-vehicle state holder
//  (the persisted `SelectedVehicleStore` + the `useVehicles()` fleet feed); commits route back out through
//  the model's page-supplied `onSelect` closure (the native peer of `setVehicleId`). The seam keeps that
//  contract explicit without the view ever touching the network.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter forwarding to the consent-gated shared-core diagnostics sink.
public protocol VehicleSelectTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogVehicleSelectTelemetry: VehicleSelectTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Phase + snapshot (P4 leaf contract)

/// The render phase. The web component renders only the populated select (or nothing when the fleet is
/// empty); the rest are the P4 always-render leaf states so the surface never collapses to a blank box.
public enum VehicleSelectPhase: Sendable, Equatable {
    /// The fleet is resolving (web `useVehicles()` has not resolved) — skeleton chrome.
    case loading
    /// At least one vehicle resolved — the select control (the web body).
    case content
    /// The fleet resolved empty (web `vehicles.length === 0`, where the web returns `null`) — friendly empty.
    case empty
    /// The fleet read failed — a retry affordance (web has no peer; added so the surface never blanks).
    case error(String)
}

/// The host's current picker state pushed through the source — the web `useSelectedVehicle()` value
/// (`vehicles` + the current `vehicleId`), the in-flight / error flags, and the connectivity axis.
public struct VehicleSelectSnapshot: Sendable, Equatable {
    /// The fleet (web `vehicles`), in display order.
    public let vehicles: [VehicleSelectVehicle]
    /// The currently selected id (web `vehicleId`), `nil` when nothing is selected.
    public let selectedId: Int?
    /// Whether the fleet is still loading (web `useVehicles()` pending).
    public let isLoading: Bool
    /// The fleet failure reason, if any — surfaced verbatim by the error state.
    public let errorMessage: String?
    /// The live-state freshness axis.
    public let connection: VehicleSelectConnection

    public init(
        vehicles: [VehicleSelectVehicle],
        selectedId: Int? = nil,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleSelectConnection = .live
    ) {
        self.vehicles = vehicles
        self.selectedId = selectedId
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Read source seam (P1/S8) — the host's current fleet + selection

/// The read seam the model binds through. The production app re-emits the host's current
/// `useSelectedVehicle()` value (`LiveVehicleSelectSource`); previews and tests use
/// `InMemoryVehicleSelectSource`. The view never reads it directly.
@MainActor
public protocol VehicleSelectSource: AnyObject {
    var onUpdate: (@MainActor (VehicleSelectSnapshot) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the fleet (web refetch) — the error-state retry + the stale auto-refresh.
    func refresh()
}

/// The production read source — holds the host's current snapshot and re-emits it whenever the host updates
/// it (a fresh fleet, a new selection, or a connectivity transition). The production app builds this over
/// the shared selected-vehicle store + the `useVehicles()` fleet feed.
@MainActor
public final class LiveVehicleSelectSource: VehicleSelectSource {
    public var onUpdate: (@MainActor (VehicleSelectSnapshot) -> Void)?
    private var snapshot: VehicleSelectSnapshot

    public init(snapshot: VehicleSelectSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Push a fresh snapshot (the host's new fleet / selection / connectivity) and re-emit it.
    public func update(_ snapshot: VehicleSelectSnapshot) {
        self.snapshot = snapshot
        emit()
    }

    private func emit() {
        onUpdate?(snapshot)
    }
}

/// A fully-working in-memory source for previews + tests. Emits a fixed snapshot on `start()`, records
/// refreshes, and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryVehicleSelectSource: VehicleSelectSource {
    public var onUpdate: (@MainActor (VehicleSelectSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    private let snapshot: VehicleSelectSnapshot

    public init(snapshot: VehicleSelectSnapshot) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: VehicleSelectSnapshot) {
        onUpdate?(update)
    }
}
