//
//  DriveScoreWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0040 · DriveScoreWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10). The view
//  binds through `DriveScoreModel`; no networking lives in the view. The model holds the
//  cached analytics snapshot + unit preference + freshness and exposes a render `Phase`
//  for SwiftUI to switch over; the view derives the gauge readout via the pure
//  `DriveScoreProjection`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core diagnostics (consent-gated + redacted there).
public protocol DriveScoreTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogDriveScoreTelemetry: DriveScoreTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases
/// the production source projects from the fleet-analytics `Resource<T>` query.
public enum DriveScoreLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum DriveScoreConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `DriveScoreSource`: the cached analytics + the
/// user's distance preference plus the load/connection status. The model turns this into
/// the render phase; the view derives the gauge readout. A `nil` `analytics` is the web
/// `!analytics` empty branch.
public struct DriveScoreUpdate: Sendable, Equatable {
    public var status: DriveScoreLoadStatus
    public var connection: DriveScoreConnection
    public var analytics: DriveScoreInput?
    public var unit: DriveScoreDistancePreference
    public var updatedAt: Date?

    public init(
        status: DriveScoreLoadStatus = .loading,
        connection: DriveScoreConnection = .live,
        analytics: DriveScoreInput? = nil,
        unit: DriveScoreDistancePreference = .kilometers,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.analytics = analytics
        self.unit = unit
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders (the fleet-analytics store + the unit-preference store); previews
/// and tests use `InMemoryDriveScoreSource`. The view never talks to the network.
@MainActor
public protocol DriveScoreSource: AnyObject {
    var onUpdate: (@MainActor (DriveScoreUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `DriveScoreSource`, stores the
/// cached analytics + unit + freshness, and exposes a render `Phase` for SwiftUI to
/// switch over. The gauge readout itself is re-derived in the view via the pure adapter.
@MainActor
@Observable
public final class DriveScoreModel {
    /// The mutually-exclusive render branches (web shell loading / error / content + the
    /// `!analytics` empty state).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DriveScoreConnection = .live
    public private(set) var analytics: DriveScoreInput?
    public private(set) var unit: DriveScoreDistancePreference = .kilometers
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DriveScoreSource
    @ObservationIgnored private let telemetry: any DriveScoreTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DriveScoreSource,
        telemetry: any DriveScoreTelemetry = OSLogDriveScoreTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DriveScoreWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (the cached score stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: DriveScoreUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        analytics = update.analytics
        unit = update.unit
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase, mirroring the web `WidgetShell`: a skeleton only on the
    /// initial fetch (no cached analytics), the full `QueryError` on any failure, and the
    /// "No data yet" empty state when the load resolves with no analytics object. When
    /// analytics is cached it stays visible (the freshness chip/banner reflects
    /// stale/offline).
    public static func resolvePhase(_ update: DriveScoreUpdate) -> Phase {
        let hasData = update.analytics != nil
        switch update.status {
        case .loading:
            return hasData ? .content : .loading
        case let .failed(message):
            return .error(message)
        case .empty:
            return .empty
        case .loaded:
            return hasData ? .content : .empty
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDriveScoreSource: DriveScoreSource {
    public var onUpdate: (@MainActor (DriveScoreUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveScoreUpdate?

    public init(initial: DriveScoreUpdate? = nil) {
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
    public func push(_ update: DriveScoreUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "DriveScoreWidget" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum DriveScoreStrings {
    public static let table = "DriveScoreWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
