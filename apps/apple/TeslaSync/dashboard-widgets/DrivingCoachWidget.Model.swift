//
//  DrivingCoachWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0043 · DrivingCoachWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10). The
//  view binds through `DrivingCoachModel`; no networking lives in the view. The model
//  holds the raw cached coach payload + freshness and exposes a render `Phase` for
//  SwiftUI to switch over; the view derives the score/tip/savings projections via the
//  pure `DrivingCoachProjection`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core diagnostics (consent-gated + redacted there).
public protocol DrivingCoachTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogDrivingCoachTelemetry: DrivingCoachTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases
/// the production source projects from the driving-coach `Resource<T>` query.
public enum DrivingCoachLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum DrivingCoachConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `DrivingCoachSource`: the cached coach payload (or
/// `nil` when none has resolved) plus its load/connection status. The model turns this
/// into the render phase; the view derives the score/tips/savings.
public struct DrivingCoachUpdate: Sendable, Equatable {
    public var status: DrivingCoachLoadStatus
    public var connection: DrivingCoachConnection
    public var coach: DrivingCoachInput?
    public var updatedAt: Date?

    public init(
        status: DrivingCoachLoadStatus = .loading,
        connection: DrivingCoachConnection = .live,
        coach: DrivingCoachInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.coach = coach
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders (the driving-coach analytics store + the selected-vehicle store);
/// previews and tests use `InMemoryDrivingCoachSource`. The view never talks to the
/// network directly.
@MainActor
public protocol DrivingCoachSource: AnyObject {
    var onUpdate: (@MainActor (DrivingCoachUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `DrivingCoachSource`, stores the
/// raw cached coach payload + freshness, and exposes a render `Phase` for SwiftUI to
/// switch over. The size-responsive score/tip projection stays in the view (so a resize
/// re-derives the compact vs standard layout) via the pure adapter.
@MainActor
@Observable
public final class DrivingCoachModel {
    /// The mutually-exclusive render branches (web shell loading / error / content + the
    /// friendly "coach unavailable" empty state).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DrivingCoachConnection = .live
    public private(set) var coach: DrivingCoachInput?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DrivingCoachSource
    @ObservationIgnored private let telemetry: any DrivingCoachTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DrivingCoachSource,
        telemetry: any DrivingCoachTelemetry = OSLogDrivingCoachTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrivingCoachWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached payload stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: DrivingCoachUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        coach = update.coach
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase, mirroring the web `WidgetShell`: a skeleton only on the
    /// initial fetch (no cached payload), the full `QueryError` on any failure, and the
    /// friendly empty state when the load resolves with no coach payload at all. When a
    /// payload is cached it stays visible (the freshness chip/banner reflects
    /// stale/offline).
    public static func resolvePhase(_ update: DrivingCoachUpdate) -> Phase {
        let hasCoach = update.coach != nil
        switch update.status {
        case .loading:
            return hasCoach ? .content : .loading
        case let .failed(message):
            return .error(message)
        case .empty:
            return .empty
        case .loaded:
            return hasCoach ? .content : .empty
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDrivingCoachSource: DrivingCoachSource {
    public var onUpdate: (@MainActor (DrivingCoachUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DrivingCoachUpdate?

    public init(initial: DrivingCoachUpdate? = nil) {
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
    public func push(_ update: DrivingCoachUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "DrivingCoachWidget" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum DrivingCoachStrings {
    public static let table = "DrivingCoachWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
