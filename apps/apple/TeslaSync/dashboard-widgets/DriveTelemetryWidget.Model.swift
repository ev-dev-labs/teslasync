//
//  DriveTelemetryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0041 · DriveTelemetryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through
//  `DriveTelemetryModel`; no networking lives here.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016), which is
/// consent-gated and redacted there.
public protocol DriveTelemetryDiagnostics: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogDriveTelemetryDiagnostics: DriveTelemetryDiagnostics {
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
/// cases the production source projects from `Resource<T>`.
public enum DriveTelemetryLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum DriveTelemetryConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `DriveTelemetrySource`: the cached drives +
/// the latest drive's telemetry + the user's measurement system + load/connection
/// status. The model turns this into the projection.
public struct DriveTelemetryUpdate: Sendable, Equatable {
    public var status: DriveTelemetryLoadStatus
    public var connection: DriveTelemetryConnection
    public var drives: [DriveTelemetrySummaryInput]
    public var telemetry: [DriveTelemetryPointInput]
    public var measurement: MeasurementSystem
    public var updatedAt: Date?

    public init(
        status: DriveTelemetryLoadStatus = .loading,
        connection: DriveTelemetryConnection = .live,
        drives: [DriveTelemetrySummaryInput] = [],
        telemetry: [DriveTelemetryPointInput] = [],
        measurement: MeasurementSystem = .metric,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.drives = drives
        self.telemetry = telemetry
        self.measurement = measurement
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the KMP `DriveStore` for the drive list +
/// `DriveTelemetryStore` for the selected drive's samples, plus the settings
/// `UnitStore`); previews and tests use `InMemoryDriveTelemetrySource`. The view
/// never talks to the network directly.
@MainActor
public protocol DriveTelemetrySource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DriveTelemetryUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `DriveTelemetrySource`,
/// recomputes the `DriveTelemetryProjection` via the pure builder, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DriveTelemetryModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DriveTelemetryConnection = .live
    public private(set) var projection: DriveTelemetryProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DriveTelemetrySource
    @ObservationIgnored private let diagnostics: any DriveTelemetryDiagnostics
    @ObservationIgnored private var started = false

    public init(
        source: any DriveTelemetrySource,
        diagnostics: any DriveTelemetryDiagnostics = OSLogDriveTelemetryDiagnostics()
    ) {
        self.source = source
        self.diagnostics = diagnostics
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        diagnostics.viewOpened(surface: DriveTelemetryWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: DriveTelemetryUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = DriveTelemetryProjectionBuilder.build(
            drives: update.drives,
            telemetry: update.telemetry,
            measurement: update.measurement
        )
        phase = Self.resolvePhase(status: update.status, hasDrive: projection.hasDrive)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the "No recent drives" empty state when there is no latest drive;
    /// whenever a drive exists the content renders (its telemetry may still be
    /// empty, which the view surfaces as an inner "No telemetry" state).
    static func resolvePhase(status: DriveTelemetryLoadStatus, hasDrive: Bool) -> Phase {
        switch status {
        case .loading:
            hasDrive ? .content : .loading
        case .loaded:
            hasDrive ? .content : .empty
        case .empty:
            .empty
        case let .failed(message):
            hasDrive ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDriveTelemetrySource: DriveTelemetrySource {
    public var onUpdate: (@MainActor (DriveTelemetryUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveTelemetryUpdate?

    public init(initial: DriveTelemetryUpdate? = nil) {
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
    public func push(_ update: DriveTelemetryUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "DriveTelemetryWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum DriveTelemetryStrings {
    public static let table = "DriveTelemetryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the chart. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum DriveTelemetryAccessibility {
    public static func summary(for projection: DriveTelemetryProjection) -> String {
        guard projection.hasData else {
            return DriveTelemetryStrings.string(
                "widget.driveTelemetry.noTelemetry",
                "No telemetry for this drive"
            )
        }
        var parts: [String] = []
        if let speed = projection.latestSpeed {
            let label = DriveTelemetryStrings.string("widget.driveTelemetry.speed", "Speed")
            let value = DriveTelemetryNumberFormat.decimal(speed, fractionDigits: 0)
            parts.append("\(label) \(value) \(projection.speedUnitLabel)")
        }
        if let power = projection.latestPower {
            let label = DriveTelemetryStrings.string("widget.driveTelemetry.power", "Power (kW)")
            parts.append("\(label) \(DriveTelemetryNumberFormat.decimal(power, fractionDigits: 0))")
        }
        if let battery = projection.latestBattery {
            let label = DriveTelemetryStrings.string("widget.driveTelemetry.battery", "Battery %")
            parts.append("\(label) \(DriveTelemetryNumberFormat.decimal(battery, fractionDigits: 0))")
        }
        return parts.joined(separator: ", ")
    }
}
