//
//  DriveEfficiencyChartWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0038 · DriveEfficiencyChartWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model and the testable accessibility summary. The view
//  binds through `DriveEfficiencyChartModel`; no networking lives here.
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
public protocol DriveEfficiencyChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogDriveEfficiencyChartTelemetry: DriveEfficiencyChartTelemetry {
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
public enum DriveEfficiencyChartLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum DriveEfficiencyChartConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `DriveEfficiencyChartSource`: the cached
/// drives + the active distance-unit preference + load/connection status. The
/// model turns this into the rendered projection.
public struct DriveEfficiencyChartUpdate: Sendable, Equatable {
    public var status: DriveEfficiencyChartLoadStatus
    public var connection: DriveEfficiencyChartConnection
    public var vehicle: DriveEfficiencyVehicle?
    public var drives: [DriveEfficiencySample]
    public var distanceUnit: String
    public var updatedAt: Date?

    public init(
        status: DriveEfficiencyChartLoadStatus = .loading,
        connection: DriveEfficiencyChartConnection = .live,
        vehicle: DriveEfficiencyVehicle? = nil,
        drives: [DriveEfficiencySample] = [],
        distanceUnit: String = "km",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.drives = drives
        self.distanceUnit = distanceUnit
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the KMP driving/vehicle stores); previews and
/// tests use `InMemoryDriveEfficiencyChartSource`. The view never talks to the
/// network directly.
@MainActor
public protocol DriveEfficiencyChartSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DriveEfficiencyChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a
/// `DriveEfficiencyChartSource`, recomputes the `DriveEfficiencyProjection` via
/// `DriveEfficiencyBuilder`, and exposes a render `Phase` + freshness for SwiftUI
/// to switch over.
@MainActor
@Observable
public final class DriveEfficiencyChartModel {
    /// The mutually-exclusive render branches (web shell loading / error +
    /// chart-summary empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: DriveEfficiencyChartConnection = .live
    public private(set) var projection: DriveEfficiencyProjection = .empty
    public private(set) var vehicle: DriveEfficiencyVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DriveEfficiencyChartSource
    @ObservationIgnored private let telemetry: any DriveEfficiencyChartTelemetry
    @ObservationIgnored private let converter: any DriveEfficiencyConverting
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private let labeler: DriveEfficiencyDateLabeler
    @ObservationIgnored private var started = false

    public init(
        source: any DriveEfficiencyChartSource,
        telemetry: any DriveEfficiencyChartTelemetry = OSLogDriveEfficiencyChartTelemetry(),
        converter: any DriveEfficiencyConverting = StandardDriveEfficiencyConverter(),
        now: @escaping @Sendable () -> Date = { Date() },
        calendar: Calendar = .current,
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.converter = converter
        self.now = now
        self.calendar = calendar
        labeler = DriveEfficiencyDateLabeler(calendar: calendar, locale: locale)
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DriveEfficiencyChartWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry /
    /// refresh affordances and the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Compact (summary-only, no chart) at a single 1×1 cell — the web
    /// `isCompact = size.cols <= 1 && size.rows <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1 && size.rows <= 1
    }

    /// Wide (more x-axis ticks) at 3+ columns — the web `isWide = size.cols >= 3`.
    public static func isWide(_ size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: DriveEfficiencyChartUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = DriveEfficiencyBuilder.buildProjection(
            samples: update.drives,
            unit: update.distanceUnit,
            converter: converter,
            now: now(),
            calendar: calendar,
            label: labeler.label(for:)
        )
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No efficiency data yet" empty whenever there are no
    /// daily points; cached points stay visible behind a refresh/offline/error so
    /// a transient failure never blanks a populated widget.
    static func resolvePhase(
        status: DriveEfficiencyChartLoadStatus,
        projection: DriveEfficiencyProjection
    ) -> Phase {
        switch status {
        case .loading:
            projection.hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            projection.hasData ? .content : .empty
        case let .failed(message):
            projection.hasData ? .content : .error(message)
        }
    }
}

/// Short-date labeler (the native analog of the web `formatDateShort`): turns a
/// `'YYYY-MM-DD'` key into a locale-aware `"Apr 7"`. Kept off the builder so the
/// adapter stays pure; the model owns one bound to the active locale/calendar.
/// Holds a `DateFormatter` (a non-`Sendable` reference type) so it is created and
/// used on the model's main actor — it is intentionally not `Sendable`.
public struct DriveEfficiencyDateLabeler {
    private let formatter: DateFormatter
    private let calendar: Calendar

    public init(calendar: Calendar = .current, locale: Locale = .current) {
        self.calendar = calendar
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = locale
        formatter.timeZone = calendar.timeZone
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        self.formatter = formatter
    }

    /// `"2026-04-07"` → `"Apr 7"`. Falls back to the raw key when malformed.
    public func label(for dateKey: String) -> String {
        let parts = dateKey.split(separator: "-")
        guard parts.count >= 3,
              let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return dateKey }
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = 12
        guard let date = calendar.date(from: components) else { return dateKey }
        return formatter.string(from: date)
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDriveEfficiencyChartSource: DriveEfficiencyChartSource {
    public var onUpdate: (@MainActor (DriveEfficiencyChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DriveEfficiencyChartUpdate?

    public init(initial: DriveEfficiencyChartUpdate? = nil) {
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
    public func push(_ update: DriveEfficiencyChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "DriveEfficiencyChartWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum DriveEfficiencyChartStrings {
    public static let table = "DriveEfficiencyChartWidget"

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
public enum DriveEfficiencyChartAccessibility {
    /// Header summary: "Avg <v> <unit>. Best day <v> <unit>. Trend <v>%." Falls
    /// back to the empty message when there is no data.
    public static func summary(for projection: DriveEfficiencyProjection) -> String {
        guard projection.hasData else {
            return DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.empty", "No efficiency data yet")
        }
        let unit = projection.efficiencyUnit
        let avgLabel = DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.avg", "Avg")
        let bestLabel = DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.best", "Best day")
        let trendLabel = DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.trend", "Trend")
        return "\(avgLabel) \(DriveEfficiencyFormat.int(projection.overallAvg)) \(unit). "
            + "\(bestLabel) \(DriveEfficiencyFormat.int(projection.bestDay)) \(unit). "
            + "\(trendLabel) \(DriveEfficiencyFormat.trend(projection.trend))"
    }

    /// Per-point VoiceOver value: "<label>: <efficiency> <unit>" (+ rolling note).
    public static func pointLabel(_ point: DriveEfficiencyPoint, unit: String) -> String {
        let base = "\(point.label): \(DriveEfficiencyFormat.int(point.efficiency)) \(unit)"
        guard let rolling = point.rollingAvg else { return base }
        let note = DriveEfficiencyChartStrings.string("widget.driveEfficiencyChart.rolling", "7-day avg")
        return "\(base), \(note) \(DriveEfficiencyFormat.int(rolling)) \(unit)"
    }
}
