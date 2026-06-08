//
//  TirePressureVisualWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0102 · TirePressureVisualWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + the SwiftUI half of the
//  P1/S10 i18n facade. The view binds through `TirePressureModel`; no networking
//  lives in the view. The production app wires `TirePressureSource` over the
//  shared TPMS state holder (web `useLatestTirePressure` + `usePressureFormat`);
//  previews and tests drive it with `InMemoryTirePressureSource`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` / `screen_view` product-analytics event for the
/// surface. The default logs via `os.Logger`; the production app injects an
/// adapter that forwards to the shared core `Telemetry.track(.screenView(…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol TirePressureTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogTirePressureTelemetry: TirePressureTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from the TPMS `Resource<T>` query.
public enum TirePressureVisualWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum TirePressureVisualWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One cached TPMS snapshot (web `TirePressureSnapshot`). The four pressures are
/// carried in kilopascals — the app's documented SI base for pressure (the
/// production source maps the API's SI Pascals → kPa at the seam boundary). Any
/// corner may be `nil` (web `front_left: number | null`), and each carries its
/// own last-seen time (web `last_seen_time_fl…`).
public struct TirePressureReading: Sendable, Equatable {
    public var frontLeftKilopascals: Double?
    public var frontRightKilopascals: Double?
    public var rearLeftKilopascals: Double?
    public var rearRightKilopascals: Double?
    public var lastSeenFrontLeft: Date?
    public var lastSeenFrontRight: Date?
    public var lastSeenRearLeft: Date?
    public var lastSeenRearRight: Date?

    public init(
        frontLeftKilopascals: Double? = nil,
        frontRightKilopascals: Double? = nil,
        rearLeftKilopascals: Double? = nil,
        rearRightKilopascals: Double? = nil,
        lastSeenFrontLeft: Date? = nil,
        lastSeenFrontRight: Date? = nil,
        lastSeenRearLeft: Date? = nil,
        lastSeenRearRight: Date? = nil
    ) {
        self.frontLeftKilopascals = frontLeftKilopascals
        self.frontRightKilopascals = frontRightKilopascals
        self.rearLeftKilopascals = rearLeftKilopascals
        self.rearRightKilopascals = rearRightKilopascals
        self.lastSeenFrontLeft = lastSeenFrontLeft
        self.lastSeenFrontRight = lastSeenFrontRight
        self.lastSeenRearLeft = lastSeenRearLeft
        self.lastSeenRearRight = lastSeenRearRight
    }
}

/// One coalesced snapshot pushed by a `TirePressureSource`: the cached reading +
/// the user's pressure preference + load/connection status. The model turns this
/// into the `TirePressureVisualWidgetProjection`.
public struct TirePressureUpdate: Sendable, Equatable {
    public var status: TirePressureVisualWidgetLoadStatus
    public var connection: TirePressureVisualWidgetConnection
    public var reading: TirePressureReading?
    public var unit: TirePressureVisualWidgetUnit
    public var localeIdentifier: String?
    public var updatedAt: Date?

    public init(
        status: TirePressureVisualWidgetLoadStatus = .loading,
        connection: TirePressureVisualWidgetConnection = .live,
        reading: TirePressureReading? = nil,
        unit: TirePressureVisualWidgetUnit = .bar,
        localeIdentifier: String? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.reading = reading
        self.unit = unit
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 TPMS state holder (the `useLatestTirePressure` 10 s poll + the
/// `usePressureFormat` preference); previews and tests use
/// `InMemoryTirePressureSource`. The view never talks to the network directly.
@MainActor
public protocol TirePressureSource: AnyObject {
    var onUpdate: (@MainActor (TirePressureUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `TirePressureSource`,
/// recomputes the `TirePressureVisualWidgetProjection`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class TirePressureModel {
    /// The mutually-exclusive render branches (web shell loading / content / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: TirePressureVisualWidgetConnection = .live
    public private(set) var projection: TirePressureVisualWidgetProjection?
    public private(set) var unit: TirePressureVisualWidgetUnit = .bar
    public private(set) var locale: Locale = .current
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TirePressureSource
    @ObservationIgnored private let telemetry: any TirePressureTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TirePressureSource,
        telemetry: any TirePressureTelemetry = OSLogTirePressureTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TirePressureVisualWidget.surfaceSlug)
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

    private func apply(_ update: TirePressureUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        unit = update.unit
        locale = update.localeIdentifier.map(Locale.init(identifier:)) ?? .current
        projection = update.reading.map(TirePressureVisualWidgetProjection.project(from:))
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the "No tire pressure data" empty state when there is no
    /// snapshot; whenever a snapshot is known the widget renders (cached values
    /// stay visible behind refresh/errors, with the freshness chip reflecting
    /// staleness/failure). An all-null snapshot still renders content (four red
    /// tires + em-dash values), matching the web `tireData ? … : EmptyState`.
    public static func resolvePhase(_ update: TirePressureUpdate) -> Phase {
        let hasReading = update.reading != nil
        switch update.status {
        case .loading:
            return hasReading ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasReading ? .content : .empty
        case let .failed(message):
            return hasReading ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTirePressureSource: TirePressureSource {
    public var onUpdate: (@MainActor (TirePressureUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TirePressureUpdate?

    public init(initial: TirePressureUpdate? = nil) {
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
    public func push(_ update: TirePressureUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "TirePressureVisualWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum TirePressureStrings {
    public static let table = "TirePressureVisualWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
