//
//  DrivingDynamicsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0044 · DrivingDynamicsWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model and the testable accessibility summary. The view
//  binds through `DrivingDynamicsModel`; no networking lives here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol DrivingDynamicsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogDrivingDynamicsTelemetry: DrivingDynamicsTelemetry {
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
public enum DrivingDynamicsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum DrivingDynamicsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `DrivingDynamicsSource`: the cached
/// dynamics + acceleration distribution + the active locale + load/connection
/// status. The model turns this into the rendered projection.
public struct DrivingDynamicsUpdate: Sendable, Equatable {
    public var status: DrivingDynamicsLoadStatus
    public var connection: DrivingDynamicsConnection
    public var vehicle: DrivingDynamicsVehicle?
    public var dynamics: DrivingDynamicsDTO?
    public var distribution: DrivingDynamicsAccelerationDistribution?
    public var localeIdentifier: String
    public var updatedAt: Date?

    public init(
        status: DrivingDynamicsLoadStatus = .loading,
        connection: DrivingDynamicsConnection = .live,
        vehicle: DrivingDynamicsVehicle? = nil,
        dynamics: DrivingDynamicsDTO? = nil,
        distribution: DrivingDynamicsAccelerationDistribution? = nil,
        localeIdentifier: String = "en_US",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.dynamics = dynamics
        self.distribution = distribution
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useDrivingDynamics` + `useAccelerationDistribution`
/// projected from the KMP `DrivingStore`, with `useVehicles` supplying the scoped
/// id); previews and tests use `InMemoryDrivingDynamicsSource`. The view never
/// talks to the network.
@MainActor
public protocol DrivingDynamicsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DrivingDynamicsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `DrivingDynamicsSource`,
/// recomputes the `DrivingDynamicsProjection` via `DrivingDynamicsBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DrivingDynamicsModel {
    /// The mutually-exclusive render branches (web shell loading / error +
    /// dynamics-present gauges / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DrivingDynamicsConnection = .live
    public private(set) var projection: DrivingDynamicsProjection = .empty
    public private(set) var vehicle: DrivingDynamicsVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DrivingDynamicsSource
    @ObservationIgnored private let telemetry: any DrivingDynamicsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DrivingDynamicsSource,
        telemetry: any DrivingDynamicsTelemetry = OSLogDrivingDynamicsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DrivingDynamicsWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances and the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Compact (large `maxG` + badge, no gauges) when the widget is a single
    /// column — the web `isCompact = size.cols <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Wide (renders the acceleration histogram) at 3+ columns — the web
    /// `isWide = size.cols >= 3`.
    public static func isWide(_ size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: DrivingDynamicsUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = DrivingDynamicsBuilder.buildProjection(
            dynamics: update.dynamics,
            distribution: update.distribution,
            localeIdentifier: update.localeIdentifier
        )
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No dynamics data" empty whenever the dynamics
    /// summary is missing; resolved gauges stay visible behind a
    /// refresh/offline/error so a transient failure never blanks a populated
    /// widget (web shell keeps the last value under the chrome).
    static func resolvePhase(
        status: DrivingDynamicsLoadStatus,
        projection: DrivingDynamicsProjection
    ) -> Phase {
        switch status {
        case .loading:
            projection.hasDynamics ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            projection.hasDynamics ? .content : .empty
        case let .failed(message):
            projection.hasDynamics ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDrivingDynamicsSource: DrivingDynamicsSource {
    public var onUpdate: (@MainActor (DrivingDynamicsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DrivingDynamicsUpdate?

    public init(initial: DrivingDynamicsUpdate? = nil) {
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
    public func push(_ update: DrivingDynamicsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "DrivingDynamicsWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum DrivingDynamicsStrings {
    public static let table = "DrivingDynamicsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the widget. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum DrivingDynamicsAccessibility {
    /// Whole-widget summary, e.g.
    /// "Driving Dynamics. Max g 0.42. Smooth. Accel 0.18. Brake 0.21.
    ///  Lateral 0.30. Calm." — or the empty message when no dynamics resolved.
    public static func summary(for projection: DrivingDynamicsProjection) -> String {
        guard projection.hasDynamics else {
            return DrivingDynamicsStrings.string("widget.drivingDynamics.noData", "No dynamics data")
        }
        let title = DrivingDynamicsStrings.string("widget.drivingDynamics.title", "Driving Dynamics")
        let maxLabel = DrivingDynamicsStrings.string("widget.drivingDynamics.maxG", "Max g")
        let smoothness = projection.smooth
            ? DrivingDynamicsStrings.string("widget.drivingDynamics.smooth", "Smooth")
            : DrivingDynamicsStrings.string("widget.drivingDynamics.aggressive", "Aggressive")
        let severity = DrivingDynamicsStrings.string(projection.severity.labelKey, projection.severity.labelFallback)
        let gauges = projection.gauges.map(gaugeLabel).joined(separator: ". ")
        return "\(title). \(maxLabel) \(projection.maxGText). \(smoothness). \(gauges). \(severity)."
    }

    /// Per-gauge VoiceOver value: "<role>: <value> g" (e.g. "Accel: 0.18 g").
    public static func gaugeLabel(_ gauge: DrivingDynamicsGauge) -> String {
        let role = DrivingDynamicsStrings.string(gauge.role.labelKey, gauge.role.labelFallback)
        let unit = DrivingDynamicsStrings.string("widget.drivingDynamics.gUnit", "g")
        return "\(role): \(gauge.valueText) \(unit)"
    }

    /// Per-bar VoiceOver value for the histogram: "<range> g: <count>".
    public static func barLabel(_ bar: DrivingGForceBar) -> String {
        let unit = DrivingDynamicsStrings.string("widget.drivingDynamics.gUnit", "g")
        let count = DrivingDynamicsFormat.number(bar.count, decimals: 0)
        return "\(bar.rangeLabel) \(unit): \(count)"
    }
}
