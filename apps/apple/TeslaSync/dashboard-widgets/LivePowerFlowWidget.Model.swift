//
//  LivePowerFlowWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0056 · LivePowerFlowWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the locale-aware kW formatter and the testable accessibility summary. The
//  view binds through `LivePowerFlowModel`; no networking lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted
/// there).
public protocol LivePowerFlowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogLivePowerFlowTelemetry: LivePowerFlowTelemetry {
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
/// cases the production source projects from `Resource<T>`.
public enum PowerFlowLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum PowerFlowConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `LivePowerFlowSource`: the cached site +
/// live-status inputs plus their load/connection status. The model turns this
/// into the diagram projection + render phase.
public struct LivePowerFlowUpdate: Sendable, Equatable {
    public var status: PowerFlowLoadStatus
    public var connection: PowerFlowConnection
    public var hasSites: Bool
    public var site: PowerFlowSite?
    public var liveStatus: PowerFlowLiveStatus?
    public var updatedAt: Date?

    public init(
        status: PowerFlowLoadStatus = .loading,
        connection: PowerFlowConnection = .live,
        hasSites: Bool = false,
        site: PowerFlowSite? = nil,
        liveStatus: PowerFlowLiveStatus? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.hasSites = hasSites
        self.site = site
        self.liveStatus = liveStatus
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` over the KMP
/// `EnergyStore`); previews and tests use `InMemoryLivePowerFlowSource`.
@MainActor
public protocol LivePowerFlowSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (LivePowerFlowUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `LivePowerFlowSource`,
/// recomputes the `PowerFlowProjection` via `PowerFlowBuilder`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class LivePowerFlowModel {
    /// The mutually-exclusive render branches (web shell + diagram states).
    public enum Phase: Equatable {
        case loading
        case noSite
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: PowerFlowConnection = .live
    public private(set) var projection: PowerFlowProjection = .empty
    public private(set) var site: PowerFlowSite?
    public private(set) var hasSites = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any LivePowerFlowSource
    @ObservationIgnored private let telemetry: any LivePowerFlowTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LivePowerFlowSource,
        telemetry: any LivePowerFlowTelemetry = OSLogLivePowerFlowTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LivePowerFlowWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of both queries (web `handleRefresh`). Cached values stay
    /// visible.
    public func refresh() {
        source.refresh()
    }

    /// Whether the diagram should compact to its three largest flows (web
    /// `isCompact = size.cols <= 1`).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    private func apply(_ update: LivePowerFlowUpdate) {
        hasSites = update.hasSites
        site = update.site
        connection = update.connection
        updatedAt = update.updatedAt
        projection = PowerFlowBuilder.buildProjection(update.liveStatus)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase, keeping cached content visible behind
    /// background refreshes and errors (web: the shell only shows the skeleton on
    /// the initial fetch, the "No site" empty state when there are no sites, and
    /// the diagram's "No live power data" when the live status is absent).
    static func resolvePhase(_ update: LivePowerFlowUpdate) -> Phase {
        let hasLive = update.liveStatus != nil
        switch update.status {
        case .loading:
            return hasLive ? .content : .loading
        case .loaded, .empty:
            if !update.hasSites { return .noSite }
            return hasLive ? .content : .empty
        case let .failed(message):
            return hasLive ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryLivePowerFlowSource: LivePowerFlowSource {
    public var onUpdate: (@MainActor (LivePowerFlowUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LivePowerFlowUpdate?

    public init(initial: LivePowerFlowUpdate? = nil) {
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
    public func push(_ update: LivePowerFlowUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "LivePowerFlowWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum LivePowerFlowStrings {
    public static let table = "LivePowerFlowWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// The localized display label for a node id (web node `label`).
    public static func nodeLabel(_ id: PowerFlowNodeID) -> String {
        switch id {
        case .solar: string("widget.livePowerFlow.solar", "Solar")
        case .grid: string("widget.livePowerFlow.grid", "Grid")
        case .home: string("widget.livePowerFlow.home", "Home")
        case .battery: string("widget.livePowerFlow.battery", "Battery")
        }
    }
}

// MARK: - kW formatting (locale-aware, web `fmtNumber(value, 1)` + " kW")

/// Formats kW magnitudes the way the web `fmtNumber(abs(kw), 1)` does: one
/// fraction digit, locale-aware grouping.
public enum PowerFlowFormat {
    private static let formatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 1
        formatter.maximumFractionDigits = 1
        return formatter
    }()

    /// The bare number, e.g. `"1.2"` (web node `AnimatedNumber`, no unit).
    public static func number(_ kw: Double) -> String {
        formatter.string(from: NSNumber(value: kw)) ?? String(format: "%.1f", kw)
    }

    /// The number with its unit, e.g. `"1.2 kW"` (web `formattedValue`).
    public static func value(_ kw: Double) -> String {
        let unit = LivePowerFlowStrings.string("widget.livePowerFlow.unitKw", "kW")
        return "\(number(kw)) \(unit)"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the flow diagram. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum LivePowerFlowAccessibility {
    public static func summary(for projection: PowerFlowProjection) -> String {
        guard projection.hasData, !projection.nodes.isEmpty else {
            return LivePowerFlowStrings.string("widget.livePowerFlow.noData", "No live power data")
        }
        let parts = projection.nodes.map { node in
            "\(LivePowerFlowStrings.nodeLabel(node.id)) \(PowerFlowFormat.value(node.valueKw))"
        }
        return parts.joined(separator: ". ")
    }
}
