//
//  RouteEfficiencyWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0082 · RouteEfficiencyWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10). The
//  view binds through `RouteEfficiencyModel`; no networking lives in the view. The
//  model holds the raw cached routes + unit preference and a render `Phase`; the view
//  derives the size-responsive ranked rows via the pure `RouteEfficiencyProjection`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core diagnostics (consent-gated + redacted there).
public protocol RouteEfficiencyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogRouteEfficiencyTelemetry: RouteEfficiencyTelemetry {
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
/// cases the production source projects from the route-efficiency `Resource<T>` query.
public enum RouteEfficiencyLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum RouteEfficiencyConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `RouteEfficiencySource`: the cached routes + the
/// user's distance preference plus their load/connection status. The model turns this
/// into the render phase; the view derives the ranked rows.
public struct RouteEfficiencyUpdate: Sendable, Equatable {
    public var status: RouteEfficiencyLoadStatus
    public var connection: RouteEfficiencyConnection
    public var routes: [RouteEfficiencyInput]
    public var unit: RouteDistancePreference
    public var updatedAt: Date?

    public init(
        status: RouteEfficiencyLoadStatus = .loading,
        connection: RouteEfficiencyConnection = .live,
        routes: [RouteEfficiencyInput] = [],
        unit: RouteDistancePreference = .kilometers,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.routes = routes
        self.unit = unit
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders (the route-efficiency analytics store + the unit-preference
/// store); previews and tests use `InMemoryRouteEfficiencySource`. The view never talks
/// to the network directly.
@MainActor
public protocol RouteEfficiencySource: AnyObject {
    var onUpdate: (@MainActor (RouteEfficiencyUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `RouteEfficiencySource`, stores
/// the raw cached routes + unit + freshness, and exposes a render `Phase` for SwiftUI
/// to switch over. The size-responsive ranked-row projection stays in the view (so a
/// resize re-derives the wide best/worst suffix) via the pure adapter.
@MainActor
@Observable
public final class RouteEfficiencyModel {
    /// The mutually-exclusive render branches (web shell loading / error / content +
    /// the ranked-list empty state).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: RouteEfficiencyConnection = .live
    public private(set) var routes: [RouteEfficiencyInput] = []
    public private(set) var unit: RouteDistancePreference = .kilometers
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any RouteEfficiencySource
    @ObservationIgnored private let telemetry: any RouteEfficiencyTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any RouteEfficiencySource,
        telemetry: any RouteEfficiencyTelemetry = OSLogRouteEfficiencyTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: RouteEfficiencyWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached routes stay visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: RouteEfficiencyUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        routes = update.routes
        unit = update.unit
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase, mirroring the web `WidgetShell`: a skeleton only on
    /// the initial fetch (no cached routes), the full `QueryError` on any failure, and
    /// the "No route data" empty state when the load resolves with zero routes. When
    /// routes are cached they stay visible (the freshness chip/banner reflects
    /// stale/offline).
    public static func resolvePhase(_ update: RouteEfficiencyUpdate) -> Phase {
        let hasRoutes = !update.routes.isEmpty
        switch update.status {
        case .loading:
            return hasRoutes ? .content : .loading
        case let .failed(message):
            return .error(message)
        case .empty:
            return .empty
        case .loaded:
            return hasRoutes ? .content : .empty
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryRouteEfficiencySource: RouteEfficiencySource {
    public var onUpdate: (@MainActor (RouteEfficiencyUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: RouteEfficiencyUpdate?

    public init(initial: RouteEfficiencyUpdate? = nil) {
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
    public func push(_ update: RouteEfficiencyUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "RouteEfficiencyWidget" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum RouteEfficiencyStrings {
    public static let table = "RouteEfficiencyWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
