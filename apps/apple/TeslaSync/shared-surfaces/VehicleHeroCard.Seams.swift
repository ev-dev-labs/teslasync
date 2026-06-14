//
//  VehicleHeroCard.Seams.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The dependency seams the ``VehicleHeroCardModel`` binds through, kept apart from the model for the
//  SwiftLint file-length budget: the P1/S11 telemetry seam (the `view.opened` sink), the P4 render phase, the
//  snapshot the host pushes (the composed web props — the `vehicle`, the optional `vehicleState`, the
//  optional `photoUrl`, and the active `useUnits` labels — plus the in-flight / error / connectivity axis),
//  the P1/S8 read-source seam, the production source, and the in-memory source for previews + tests. The view
//  never reads the source directly — it goes through the model, which goes through these seams. No networking
//  lives here.
//

import Foundation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via `os.Logger`; the
/// production app injects an adapter forwarding to the consent-gated shared-core diagnostics sink. The slug
/// is a static, non-identifying constant.
public protocol VehicleHeroCardTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogVehicleHeroCardTelemetry: VehicleHeroCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Phase (P4 leaf contract)

/// The render phase. The web component is presentational (it always has a `vehicle`); the loading / empty /
/// error branches are the P4 always-render leaf states so the card never collapses to a blank box. Inside
/// `content`, the live-state-vs-no-live-state split (web `vs && (…)`) is read off the projection's
/// `hasLiveState`.
public enum VehicleHeroCardPhase: Sendable, Equatable {
    /// The vehicle / state is resolving — skeleton chrome.
    case loading
    /// A vehicle resolved — the hero card body (gauges + stats, or the friendly no-live-data fallback).
    case content
    /// No vehicle to show (e.g. nothing selected) — a friendly empty state (web has no peer).
    case empty
    /// The read failed — a retry affordance (web has no peer; added so the card never blanks).
    case error(String)
}

// MARK: - Connection (P4 connectivity axis)

/// The orthogonal freshness axis used by the P4 leaf-state contract: `live` (fresh), `stale` (older than the
/// freshness window — auto-refreshes once), `offline` (no connectivity — keeps the cached values visible).
/// The web component has no such axis; it is the native surface's always-render connectivity chip + banner.
public enum VehicleHeroCardConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Snapshot (the composed web prop value)

/// The host's current hero-card state pushed through the source — the composed web `vehicle` + `vehicleState`
/// + `photoUrl` props and the `useUnits` labels, plus the in-flight / error flags and the connectivity axis.
public struct VehicleHeroCardSnapshot: Sendable, Equatable {
    /// The vehicle to render (web `vehicle`); `nil` while loading or when the fleet is empty.
    public let vehicle: VehicleHeroCardVehicle?
    /// The live vehicle state (web `vehicleState`); `nil` when there is no live state (the no-live-data
    /// fallback).
    public let liveState: VehicleHeroCardLiveState?
    /// The user-uploaded hero photo URL (web `photoUrl`); `nil` keeps the gauges-only layout.
    public let photoURL: URL?
    /// The active display-unit labels (web `useUnits().unitPrefs`).
    public let unitPrefs: VehicleHeroCardUnitPrefs
    /// Whether the vehicle / state is still loading.
    public let isLoading: Bool
    /// The failure reason, if any — surfaced verbatim by the error state.
    public let errorMessage: String?
    /// The live-state freshness axis.
    public let connection: VehicleHeroCardConnection

    public init(
        vehicle: VehicleHeroCardVehicle?,
        liveState: VehicleHeroCardLiveState? = nil,
        photoURL: URL? = nil,
        unitPrefs: VehicleHeroCardUnitPrefs = .imperial,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: VehicleHeroCardConnection = .live
    ) {
        self.vehicle = vehicle
        self.liveState = liveState
        self.photoURL = photoURL
        self.unitPrefs = unitPrefs
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Read source seam (P1/S8)

/// The read seam the model binds through. The production app re-emits the host's composed `vehicle` +
/// `vehicleState` + `photoUrl` + `useUnits` value (`LiveVehicleHeroCardSource`); previews and tests use
/// `InMemoryVehicleHeroCardSource`. The view never reads it directly.
@MainActor
public protocol VehicleHeroCardSource: AnyObject {
    var onUpdate: (@MainActor (VehicleHeroCardSnapshot) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the vehicle / state (web refetch) — the error-state retry + the stale auto-refresh.
    func refresh()
}

/// The production read source — holds the host's current snapshot and re-emits it whenever the host updates
/// it (a fresh vehicle, new live state, a new photo, or a connectivity transition).
@MainActor
public final class LiveVehicleHeroCardSource: VehicleHeroCardSource {
    public var onUpdate: (@MainActor (VehicleHeroCardSnapshot) -> Void)?
    private var snapshot: VehicleHeroCardSnapshot

    public init(snapshot: VehicleHeroCardSnapshot) {
        self.snapshot = snapshot
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    /// Push a fresh snapshot (the host's new vehicle / state / photo / connectivity) and re-emit it.
    public func update(_ snapshot: VehicleHeroCardSnapshot) {
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
public final class InMemoryVehicleHeroCardSource: VehicleHeroCardSource {
    public var onUpdate: (@MainActor (VehicleHeroCardSnapshot) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    private let snapshot: VehicleHeroCardSnapshot

    public init(snapshot: VehicleHeroCardSnapshot) {
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
    public func push(_ update: VehicleHeroCardSnapshot) {
        onUpdate?(update)
    }
}
