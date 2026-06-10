//
//  TelemetryPipelineCard.Model.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  State-holder seam (P1/S8) + the surface's observable view-model. The card binds through
//  `TelemetryPipelineSource`; no networking lives in the view. SwiftUI parity of
//  features/system/components/status/TelemetryPipelineCard.tsx — the operator-grade
//  per-vehicle telemetry-liveness card. The production app implements the source over the
//  shared P1/S8 state holders, composing the vehicle list (web `vehicles` prop) with the
//  polling-status query (web `getPollingStatus`) and the MQTT/Fleet-Telemetry status query
//  (web `useMQTTStatus`); previews + tests use `InMemoryTelemetryPipelineSource`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - State-holder seam (P1/S8 layer)

/// The coalesced load lifecycle of the card's data (the vehicle list + the two status
/// queries), mirroring the shared `LoadableState` cases the web projects.
public enum TelemetryPipelineLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness banner + the cached-data behavior
/// so cached rows are clearly labeled while reconnecting / offline.
public enum TelemetryPipelineConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One vehicle joined across the three web data sources: the vehicle row (`id` / display
/// name / VIN / state), its REST poll facts (last poll, next poll, battery), and its Fleet
/// Telemetry stream fact (last received). Absent timestamps/battery are `nil`.
public struct TelemetryVehicleInput: Sendable, Equatable, Identifiable {
    public var id: Int64
    public var displayName: String
    public var vin: String
    public var state: String?
    public var lastPoll: Date?
    public var nextPoll: Date?
    public var lastStream: Date?
    public var batteryLevel: Double?

    public init(
        id: Int64,
        displayName: String,
        vin: String,
        state: String? = nil,
        lastPoll: Date? = nil,
        nextPoll: Date? = nil,
        lastStream: Date? = nil,
        batteryLevel: Double? = nil
    ) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.state = state
        self.lastPoll = lastPoll
        self.nextPoll = nextPoll
        self.lastStream = lastStream
        self.batteryLevel = batteryLevel
    }
}

/// The fleet-rollup totals the card's header grid renders (web props `positionCount` /
/// `drivesCount` / `chargingSessionsCount` / `signalLogCount`). The charging + signal-log
/// counts are optional (web renders the em-dash when absent).
public struct TelemetryFleetTotals: Sendable, Equatable {
    public var positions: Int
    public var drives: Int
    public var chargingSessions: Int?
    public var signalLog: Int?

    public init(positions: Int = 0, drives: Int = 0, chargingSessions: Int? = nil, signalLog: Int? = nil) {
        self.positions = positions
        self.drives = drives
        self.chargingSessions = chargingSessions
        self.signalLog = signalLog
    }
}

/// One coalesced snapshot pushed by a `TelemetryPipelineSource`: the load status, the joined
/// vehicles, the rollup totals, the two domain-status flags (MQTT broker connected, polling
/// engine enabled), the (shared) live-state connection, and the last-update time.
public struct TelemetryPipelineUpdate: Sendable, Equatable {
    public var status: TelemetryPipelineLoadStatus
    public var vehicles: [TelemetryVehicleInput]
    public var totals: TelemetryFleetTotals
    public var mqttConnected: Bool
    public var pollingEnabled: Bool
    public var connection: TelemetryPipelineConnection
    public var updatedAt: Date?

    public init(
        status: TelemetryPipelineLoadStatus = .loading,
        vehicles: [TelemetryVehicleInput] = [],
        totals: TelemetryFleetTotals = TelemetryFleetTotals(),
        mqttConnected: Bool = false,
        pollingEnabled: Bool = true,
        connection: TelemetryPipelineConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.vehicles = vehicles
        self.totals = totals
        self.mqttConnected = mqttConnected
        self.pollingEnabled = pollingEnabled
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. Production implements this over the shared P1/S8 state
/// holders; previews/tests use `InMemoryTelemetryPipelineSource`. The view never talks to
/// the network directly.
@MainActor
public protocol TelemetryPipelineSource: AnyObject {
    var onUpdate: (@MainActor (TelemetryPipelineUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-reads the polling + MQTT status queries (web refetch) — the error-state retry and
    /// the stale auto-refresh.
    func refresh()
}

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryTelemetryPipelineSource: TelemetryPipelineSource {
    public var onUpdate: (@MainActor (TelemetryPipelineUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TelemetryPipelineUpdate?

    public init(initial: TelemetryPipelineUpdate? = nil) {
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
    public func push(_ update: TelemetryPipelineUpdate) {
        onUpdate?(update)
    }
}

// MARK: - View-model

/// The surface's observable view-model. Subscribes to a `TelemetryPipelineSource`, projects
/// the joined vehicles into view-ready rows + the fleet liveness summary, and exposes a
/// render `TelemetryPipelinePhase` plus the connectivity flags + freshness for SwiftUI to
/// switch over. Navigation is delegated to the injected `TelemetryPipelineNavigator`.
@MainActor
@Observable
public final class TelemetryPipelineModel {
    public private(set) var phase: TelemetryPipelinePhase = .loading
    public private(set) var rows: [TelemetryPipelineVehicleRow] = []
    public private(set) var summary = TelemetryFleetSummary()
    public private(set) var totals = TelemetryFleetTotals()
    public private(set) var vehicleCount = 0
    public private(set) var mqttConnected = false
    public private(set) var pollingEnabled = true
    public private(set) var connection: TelemetryPipelineConnection = .live
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TelemetryPipelineSource
    @ObservationIgnored private let telemetry: any TelemetryPipelineTelemetry
    @ObservationIgnored private let navigator: any TelemetryPipelineNavigator
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TelemetryPipelineSource,
        telemetry: any TelemetryPipelineTelemetry = OSLogTelemetryPipelineTelemetry(),
        navigator: any TelemetryPipelineNavigator = OSLogTelemetryPipelineNavigator()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.navigator = navigator
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TelemetryPipelineCard.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream queries.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-reads the status queries (error-state retry + stale auto-refresh).
    public func refresh() {
        source.refresh()
    }

    /// Routes a link tap through the navigation seam (web `<Link>`).
    public func navigate(to destination: TelemetryPipelineDestination) {
        navigator.navigate(to: destination)
    }

    private func apply(_ update: TelemetryPipelineUpdate) {
        let now = Date()
        connection = update.connection
        updatedAt = update.updatedAt
        mqttConnected = update.mqttConnected
        pollingEnabled = update.pollingEnabled
        totals = update.totals
        vehicleCount = update.vehicles.count
        rows = Self.projectRows(update.vehicles, now: now)
        summary = TelemetryPipelineProjection.summary(for: rows)
        phase = TelemetryPipelineProjection.resolvePhase(update.status, hasVehicles: !rows.isEmpty)
        handleAutoRefresh(for: update.connection)
    }

    /// Projects the joined vehicle inputs into view rows (web per-vehicle `<li>` derivation).
    static func projectRows(_ inputs: [TelemetryVehicleInput], now: Date) -> [TelemetryPipelineVehicleRow] {
        inputs.map { input in
            let result = TelemetryPipelineProjection.liveness(
                lastPoll: input.lastPoll,
                lastStream: input.lastStream,
                now: now
            )
            return TelemetryPipelineVehicleRow(
                id: input.id,
                displayName: TelemetryPipelineProjection.displayName(
                    raw: input.displayName,
                    id: input.id,
                    localize: TelemetryPipelineStrings.string
                ),
                vinTail: TelemetryPipelineProjection.vinTail(input.vin),
                state: TelemetryPipelineProjection.stateLabel(for: input.state),
                level: result.level,
                source: result.source,
                lastSeen: result.lastSeen,
                nextPoll: input.nextPoll,
                batteryPercent: input.batteryLevel.map { Int($0.rounded()) }
            )
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live
    /// so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: TelemetryPipelineConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - Surface identity (P1/S11 `view.opened`)

public extension TelemetryPipelineCard {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "TelemetryPipelineCard"
}
