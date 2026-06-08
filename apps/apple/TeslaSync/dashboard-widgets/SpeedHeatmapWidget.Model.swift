//
//  SpeedHeatmapWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0094 · SpeedHeatmapWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through this model and
//  never performs networking itself. The grid `DashboardWidgetSize` /
//  `DashboardWidgetRegistration` types are the shared dashboard primitives
//  (defined by the 0036 surface; reused here, never redefined).
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
public protocol SpeedHeatmapTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSpeedHeatmapTelemetry: SpeedHeatmapTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared
/// `LoadableState` cases the production source projects from `Resource<T>`.
public enum SpeedHeatmapLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum SpeedHeatmapConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SpeedHeatmapSource`: the cached drives
/// plus their load/connection status and the active speed preference. The model
/// turns this into the display grid.
public struct SpeedHeatmapUpdate: Sendable, Equatable {
    public var status: SpeedHeatmapLoadStatus
    public var connection: SpeedHeatmapConnection
    public var vehicle: SpeedHeatmapVehicleRef?
    public var drives: [SpeedHeatmapDrive]
    public var speedUnitLabel: String
    public var updatedAt: Date?

    public init(
        status: SpeedHeatmapLoadStatus = .loading,
        connection: SpeedHeatmapConnection = .live,
        vehicle: SpeedHeatmapVehicleRef? = nil,
        drives: [SpeedHeatmapDrive] = [],
        speedUnitLabel: String = "km/h",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.drives = drives
        self.speedUnitLabel = speedUnitLabel
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<[Drive]>>` from
/// the KMP driving store + the units preference); previews and tests use
/// `InMemorySpeedHeatmapSource`. The view never talks to the network directly.
@MainActor
public protocol SpeedHeatmapSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SpeedHeatmapUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SpeedHeatmapSource`,
/// recomputes the 7×24 grid via `SpeedHeatmapBuilder`, and exposes a render
/// `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SpeedHeatmapModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SpeedHeatmapConnection = .live
    public private(set) var grid: [[HeatCell]] = []
    public private(set) var maxSpeed: Double = 0
    public private(set) var totalDrives: Int = 0
    public private(set) var unit: SpeedHeatmapWidgetUnit = .kilometersPerHour
    public private(set) var vehicle: SpeedHeatmapVehicleRef?
    public private(set) var updatedAt: Date?

    @ObservationIgnored public let calendar: Calendar
    @ObservationIgnored private let source: any SpeedHeatmapSource
    @ObservationIgnored private let telemetry: any SpeedHeatmapTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SpeedHeatmapSource,
        telemetry: any SpeedHeatmapTelemetry = OSLogSpeedHeatmapTelemetry(),
        calendar: Calendar = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.calendar = calendar
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SpeedHeatmapWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached grid stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    /// The web collapses to a single peak number at one column
    /// (`isCompact = size.cols <= 1`).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// The web widens day + hour labels at three columns or more
    /// (`isWide = size.cols >= 3`).
    public static func isWide(for size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: SpeedHeatmapUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        unit = SpeedHeatmapWidgetUnit.fromLabel(update.speedUnitLabel)
        grid = SpeedHeatmapBuilder.buildHeatmap(drives: update.drives, speedUnit: unit, calendar: calendar)
        maxSpeed = SpeedHeatmapBuilder.maxSpeed(in: grid)
        totalDrives = SpeedHeatmapBuilder.totalDrives(in: grid)
        phase = Self.resolvePhase(update, hasData: totalDrives > 0)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the empty state when there are no contributing drives; whenever
    /// drives are known the grid renders (cached values stay visible behind
    /// refresh/errors).
    static func resolvePhase(_ update: SpeedHeatmapUpdate, hasData: Bool) -> Phase {
        switch update.status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySpeedHeatmapSource: SpeedHeatmapSource {
    public var onUpdate: (@MainActor (SpeedHeatmapUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SpeedHeatmapUpdate?

    public init(initial: SpeedHeatmapUpdate? = nil) {
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
    public func push(_ update: SpeedHeatmapUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SpeedHeatmapWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time so each parallel surface owns its own strings.
public enum SpeedHeatmapStrings {
    public static let table = "SpeedHeatmapWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Interpolates a single count into a localized format (web `{{count}} drives`).
    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// Interpolates two strings into a localized format
    /// (web `Peak avg {{speed}} {{unit}}`).
    public static func format(_ key: String, _ fallbackFormat: String, _ first: String, _ second: String) -> String {
        String(format: string(key, fallbackFormat), first, second)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the heatmap. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum SpeedHeatmapAccessibility {
    public static func summary(grid: [[HeatCell]], unit: SpeedHeatmapWidgetUnit, calendar: Calendar = .current) -> String {
        let title = SpeedHeatmapStrings.string("widget.speedHeatmap.title", "Speed Heatmap")
        let total = SpeedHeatmapBuilder.totalDrives(in: grid)
        guard total > 0 else {
            let empty = SpeedHeatmapStrings.string("widget.speedHeatmap.empty", "No drive data yet")
            return "\(title). \(empty)"
        }
        let drives = SpeedHeatmapStrings.count("widget.speedHeatmap.drives", "%lld drives", total)
        let maxSpeed = SpeedHeatmapBuilder.maxSpeed(in: grid)
        let peak = SpeedHeatmapStrings.format(
            "widget.speedHeatmap.peakSpeed",
            "Peak avg %1$@ %2$@",
            SpeedNumberFormat.integer(maxSpeed),
            unit.symbol
        )
        var parts = [title, drives, peak]
        if let cell = SpeedHeatmapBuilder.peakCell(in: grid) {
            let labels = SpeedHeatmapBuilder.dayLabels(wide: true, calendar: calendar)
            parts.append(cellDescription(cell, dayLabels: labels, unit: unit))
        }
        return parts.joined(separator: ". ")
    }

    /// Reproduces the web per-cell `<title>` tooltip text for one cell:
    /// `"{day} {hour}:00 – {speed} {unit} ({count} drives)"`, or `"… – No data"`
    /// when the slot has no drives. Used for the peak-cell a11y phrase and to
    /// keep the `drivesSuffix` / `noData` source keys genuinely exercised.
    public static func cellDescription(_ cell: HeatCell, dayLabels: [String], unit: SpeedHeatmapWidgetUnit) -> String {
        let dayLabel = cell.day < dayLabels.count ? dayLabels[cell.day] : ""
        let prefix = "\(dayLabel) \(cell.hour):00"
        guard cell.driveCount > 0 else {
            return "\(prefix) – \(SpeedHeatmapStrings.string("widget.speedHeatmap.noData", "No data"))"
        }
        let suffix = SpeedHeatmapStrings.string("widget.speedHeatmap.drivesSuffix", "drives")
        let speed = SpeedNumberFormat.integer(cell.avgSpeed)
        return "\(prefix) – \(speed) \(unit.symbol) (\(cell.driveCount) \(suffix))"
    }
}
