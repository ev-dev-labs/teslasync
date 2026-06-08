//
//  DrivingPerformanceCards.Model.swift
//  TeslaSync — P4 feature view · 0055 · DrivingPerformanceCards (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `DrivingPerformanceModel`; no networking lives in the
//  view. SwiftUI parity of
//  features/analytics/components/analytics/DrivingPerformanceCards.tsx — the analytics
//  "Driving Performance" summary that renders the fleet `drive_analytics` speed / power /
//  regen / distance stats as six unit-aware metric tiles. The web component reads its data
//  from a parent `useFleetAnalytics` query and its display units from `useUnits`; the
//  production app composes both into the `DrivingPerformanceSource` seam below.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that forwards
/// to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and
/// redacted there.
public protocol DrivingPerformanceTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogDrivingPerformanceTelemetry: DrivingPerformanceTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's analytics query, mirroring the shared
/// `LoadableState` cases the web source's parent projects from `useFleetAnalytics`
/// (web `isLoading` skeleton / resolved payload / empty / failure).
public enum DrivingPerformanceLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data
/// banner so cached tiles are clearly labeled while reconnecting / offline.
public enum DrivingPerformanceConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One stat group's two read fields (web `StatsSummary`). The source reads only `max` +
/// `avg` for these tiles; the other percentile fields the backend returns are not modeled.
public struct DrivingStat: Sendable, Equatable {
    public var max: Double
    public var avg: Double

    public init(max: Double, avg: Double) {
        self.max = max
        self.avg = avg
    }
}

/// The user's display-unit preferences for this surface (web `useUnits().unitPrefs`). Only
/// the distance + speed labels (and the optional locale) the source needs are modeled,
/// stored as the SI label strings the shared enums round-trip through (`"km"`, `"mph"`, …).
public struct DrivingUnitPrefs: Sendable, Equatable {
    public var distance: String
    public var speed: String
    public var locale: String?

    public init(distance: String = "km", speed: String = "km/h", locale: String? = nil) {
        self.distance = distance
        self.speed = speed
        self.locale = locale
    }
}

/// The fleet `drive_analytics` stat groups the web source reads (`speed_stats`,
/// `power_stats`, `regen_stats`, `distance_stats`). A `nil` group renders the em-dash
/// sentinel for its tile(s) — the web `ss ? … : '—'` guard.
public struct DrivingPerformanceInput: Sendable, Equatable {
    /// `speed_stats` (km/h) — drives Top Speed (max) + Avg Speed (avg).
    public var speed: DrivingStat?
    /// `power_stats` (kW) — drives Peak Power (max).
    public var power: DrivingStat?
    /// `regen_stats` (kW) — drives Peak Regen (max).
    public var regen: DrivingStat?
    /// `distance_stats` (km) — drives Avg Drive Distance (avg) + Longest Drive (max).
    public var distance: DrivingStat?

    public init(
        speed: DrivingStat? = nil,
        power: DrivingStat? = nil,
        regen: DrivingStat? = nil,
        distance: DrivingStat? = nil
    ) {
        self.speed = speed
        self.power = power
        self.regen = regen
        self.distance = distance
    }
}

/// One coalesced snapshot pushed by a `DrivingPerformanceSource`: the analytics load
/// status + the stat payload + the display-unit preferences + the (shared) connection +
/// the in-flight refresh flag.
public struct DrivingPerformanceUpdate: Sendable, Equatable {
    public var status: DrivingPerformanceLoadStatus
    public var input: DrivingPerformanceInput?
    public var unitPrefs: DrivingUnitPrefs
    public var refreshing: Bool
    public var connection: DrivingPerformanceConnection
    public var updatedAt: Date?

    public init(
        status: DrivingPerformanceLoadStatus = .loading,
        input: DrivingPerformanceInput? = nil,
        unitPrefs: DrivingUnitPrefs = DrivingUnitPrefs(),
        refreshing: Bool = false,
        connection: DrivingPerformanceConnection = .live,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.unitPrefs = unitPrefs
        self.refreshing = refreshing
        self.connection = connection
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the fleet-analytics query (web `useFleetAnalytics`) with
/// the unit-preference holder (web `useUnits`) and a refresh affordance. Previews + tests
/// use `InMemoryDrivingPerformanceSource`. The view never talks to the network directly.
@MainActor
public protocol DrivingPerformanceSource: AnyObject {
    var onUpdate: (@MainActor (DrivingPerformanceUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-fetches the analytics query from the backend (web `refetch()`).
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `DrivingPerformanceSource`,
/// projects the analytics payload + unit preferences into the six view-ready tiles, and
/// exposes a render `DrivingPerformancePhase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DrivingPerformanceModel {
    public private(set) var connection: DrivingPerformanceConnection = .live
    public private(set) var phase: DrivingPerformancePhase = .loading
    public private(set) var cards: [DrivingMetricCardModel] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DrivingPerformanceSource
    @ObservationIgnored private let telemetry: any DrivingPerformanceTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any DrivingPerformanceSource,
        telemetry: any DrivingPerformanceTelemetry = OSLogDrivingPerformanceTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrivingPerformanceCards.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-fetches the analytics query (web `refetch()`), used by the error-state retry.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: DrivingPerformanceUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        refreshing = update.refreshing
        cards = DrivingPerformanceProjection.cards(from: update.input, prefs: update.unitPrefs)
        phase = DrivingPerformanceProjection.resolvePhase(update.status, hasValue: update.input != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh of the analytics query (prompt "stale chip + auto-
    /// refresh"); reset once live so a later stale episode re-triggers exactly once.
    private func handleAutoRefresh(for connection: DrivingPerformanceConnection) {
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

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDrivingPerformanceSource: DrivingPerformanceSource {
    public var onUpdate: (@MainActor (DrivingPerformanceUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DrivingPerformanceUpdate?

    public init(initial: DrivingPerformanceUpdate? = nil) {
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
    public func push(_ update: DrivingPerformanceUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity + localization facade (P1/S10) — web `t(key, default)`

public extension DrivingPerformanceCards {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static let surfaceSlug = "DrivingPerformanceCards"
}

/// Resolves the surface's strings by key with the web English fallback, so the view holds
/// no hardcoded literals. Keys live in the "DrivingPerformanceCards" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum DrivingPerformanceStrings {
    public static let table = "DrivingPerformanceCards"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
