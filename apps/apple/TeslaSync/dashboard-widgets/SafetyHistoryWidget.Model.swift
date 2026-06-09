//
//  SafetyHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0084 · SafetyHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). The view binds through `SafetyModel`; no networking lives in the view.
//
//  SwiftUI parity of features/dashboard/widgets/SafetyHistoryWidget.tsx — the
//  composable "Safety History" ADAS surface that lists recent safety snapshots
//  (collision warnings, AEB, lane departures, disengagements) newest-first and
//  summarizes the last 30 days.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core diagnostics pipeline (consent-gated + redacted there).
public protocol SafetyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogSafetyTelemetry: SafetyTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the web source projects from the `useSafetyHistory` query.
public enum SafetyLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip + the cached-data banner (web `DataFreshness` indicator).
public enum SafetyConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One cached safety snapshot (web `SafetySnapshot`). Only the fields the web
/// `SafetyHistoryWidget` reads are modeled; the production source projects these from
/// the shared vehicle-systems store. The four ADAS enum fields are heterogeneous
/// (`SafetyEnumValue`) because the backend serializes raw `signal.SignalValue`.
public struct SafetyEventInput: Sendable, Equatable {
    public var id: Int64?
    public var vehicleID: Int64
    public var createdAt: Date?
    public var automaticEmergencyBrakingOff: Bool?
    public var forwardCollisionWarning: SafetyEnumValue
    public var laneDepartureAvoidance: SafetyEnumValue
    public var speedLimitWarning: SafetyEnumValue
    public var cruiseFollowDistance: SafetyEnumValue
    public var blindSpotCollisionWarning: Bool?
    public var emergencyLaneDepartureAvoidance: Bool?
    public var pinToDriveEnabled: Bool?

    public init(
        id: Int64? = nil,
        vehicleID: Int64,
        createdAt: Date? = nil,
        automaticEmergencyBrakingOff: Bool? = nil,
        forwardCollisionWarning: SafetyEnumValue = .null,
        laneDepartureAvoidance: SafetyEnumValue = .null,
        speedLimitWarning: SafetyEnumValue = .null,
        cruiseFollowDistance: SafetyEnumValue = .null,
        blindSpotCollisionWarning: Bool? = nil,
        emergencyLaneDepartureAvoidance: Bool? = nil,
        pinToDriveEnabled: Bool? = nil
    ) {
        self.id = id
        self.vehicleID = vehicleID
        self.createdAt = createdAt
        self.automaticEmergencyBrakingOff = automaticEmergencyBrakingOff
        self.forwardCollisionWarning = forwardCollisionWarning
        self.laneDepartureAvoidance = laneDepartureAvoidance
        self.speedLimitWarning = speedLimitWarning
        self.cruiseFollowDistance = cruiseFollowDistance
        self.blindSpotCollisionWarning = blindSpotCollisionWarning
        self.emergencyLaneDepartureAvoidance = emergencyLaneDepartureAvoidance
        self.pinToDriveEnabled = pinToDriveEnabled
    }

    /// Web `snap.created_at ?? new Date(0).toISOString()` — the feed sort/render key.
    public var displayTimestamp: Date {
        createdAt ?? Date(timeIntervalSince1970: 0)
    }

    /// Web `snap.id ?? Math.random()` — a stable feed-row identity (the native port
    /// uses a deterministic `vehicle-timestamp` fallback instead of a random id).
    public var stableID: String {
        if let id { return String(id) }
        return "\(vehicleID)-\(Int(displayTimestamp.timeIntervalSince1970))"
    }
}

/// One coalesced snapshot pushed by a `SafetySource`: the cached events plus their
/// load/connection status. The model turns this into the feed + stats projection.
public struct SafetyUpdate: Sendable, Equatable {
    public var status: SafetyLoadStatus
    public var connection: SafetyConnection
    public var events: [SafetyEventInput]
    public var updatedAt: Date?

    public init(
        status: SafetyLoadStatus = .loading,
        connection: SafetyConnection = .live,
        events: [SafetyEventInput] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.events = events
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the vehicles store (web `useVehicles`,
/// `id = vehicleId ?? vehicles[0].id`) with the safety-history query (web
/// `useSafetyHistory('/safety?vehicle_id=')`). Previews + tests use
/// `InMemorySafetySource`. The view never talks to the network directly.
@MainActor
public protocol SafetySource: AnyObject {
    var onUpdate: (@MainActor (SafetyUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SafetySource`, recomputes the
/// `SafetyFeedItem` + `SafetyStats` projections, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over. Size-agnostic: the view applies the
/// size-derived compact gate (web `isCompact`) via `SafetyLayout`.
@MainActor
@Observable
public final class SafetyModel {
    /// The mutually-exclusive render branches (web shell loading / content / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SafetyConnection = .live
    public private(set) var feedItems: [SafetyFeedItem] = []
    public private(set) var stats: SafetyStats = .init(totalEvents: 0, mostCommon: "—", trend: .none)
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SafetySource
    @ObservationIgnored private let telemetry: any SafetyTelemetry
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private var started = false

    public init(
        source: any SafetySource,
        telemetry: any SafetyTelemetry = OSLogSafetyTelemetry(),
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.source = source
        self.telemetry = telemetry
        self.now = now
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SafetyHistoryWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SafetyUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        feedItems = SafetyFeedBuilder.build(events: update.events, localize: SafetyStrings.string)
        stats = SafetyStatsBuilder.build(events: update.events, now: now(), localize: SafetyStrings.string)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial fetch
    /// (no rows yet) and the "No safety events" empty state when the resolved list is
    /// empty; whenever events are known the widget renders (cached rows stay visible
    /// behind refresh/errors, with the freshness chip + banner reflecting
    /// staleness/offline/failure).
    public static func resolvePhase(_ update: SafetyUpdate) -> Phase {
        let hasEvents = !update.events.isEmpty
        switch update.status {
        case .loading:
            return hasEvents ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasEvents ? .content : .empty
        case let .failed(message):
            return hasEvents ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySafetySource: SafetySource {
    public var onUpdate: (@MainActor (SafetyUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SafetyUpdate?

    public init(initial: SafetyUpdate? = nil) {
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
    public func push(_ update: SafetyUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/security.ts → "safety-history")

public extension SafetyHistoryWidget {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "SafetyHistoryWidget"

    /// Canonical registry metadata (registry/security.ts → "safety-history").
    static let registration = DashboardWidgetRegistration(
        id: "safety-history",
        nameKey: "widget.safetyHistory",
        descriptionKey: "widget.safetyHistory.description",
        category: "security",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SafetyHistoryWidget" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum SafetyStrings {
    public static let table = "SafetyHistoryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
