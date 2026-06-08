//
//  MonthlyMileageWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0065 · MonthlyMileageWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model and the testable accessibility summary. The view
//  binds through `MonthlyMileageModel`; no networking lives here.
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
public protocol MonthlyMileageTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogMonthlyMileageTelemetry: MonthlyMileageTelemetry {
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
public enum MonthlyMileageWidgetMileageLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum MonthlyMileageWidgetMileageConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `MonthlyMileageSource`: the cached month
/// buckets + the active display-unit label + load/connection status. The model
/// turns this into the rendered projection.
public struct MonthlyMileageUpdate: Sendable, Equatable {
    public var status: MonthlyMileageWidgetMileageLoadStatus
    public var connection: MonthlyMileageWidgetMileageConnection
    public var vehicle: MileageVehicle?
    public var rows: [MileageMonthRow]
    public var distanceUnit: String
    public var updatedAt: Date?

    public init(
        status: MonthlyMileageWidgetMileageLoadStatus = .loading,
        connection: MonthlyMileageWidgetMileageConnection = .live,
        vehicle: MileageVehicle? = nil,
        rows: [MileageMonthRow] = [],
        distanceUnit: String = "km",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.rows = rows
        self.distanceUnit = distanceUnit
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP
/// analytics/vehicle stores); previews and tests use
/// `InMemoryMonthlyMileageSource`. The view never talks to the network directly.
@MainActor
public protocol MonthlyMileageSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (MonthlyMileageUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `MonthlyMileageSource`,
/// recomputes the `MonthlyMileageProjection` via `MonthlyMileageBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class MonthlyMileageModel {
    /// The mutually-exclusive render branches (web shell loading / error +
    /// chart-summary empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: MonthlyMileageWidgetMileageConnection = .live
    public private(set) var projection: MonthlyMileageProjection = .empty
    public private(set) var vehicle: MileageVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any MonthlyMileageSource
    @ObservationIgnored private let telemetry: any MonthlyMileageTelemetry
    @ObservationIgnored private let converter: any MonthlyMileageDistanceConverting
    @ObservationIgnored private let now: @Sendable () -> Date
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private var started = false

    public init(
        source: any MonthlyMileageSource,
        telemetry: any MonthlyMileageTelemetry = OSLogMonthlyMileageTelemetry(),
        converter: any MonthlyMileageDistanceConverting = StandardMileageDistanceConverter(),
        now: @escaping @Sendable () -> Date = { Date() },
        calendar: Calendar = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.converter = converter
        self.now = now
        self.calendar = calendar
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MonthlyMileageWidget.surfaceSlug)
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

    /// Compact (summary-only, no chart) when the widget is a single column —
    /// the web `isCompact = size.cols <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Wide (larger axis ticks) at 3+ columns — the web `isWide = size.cols >= 3`.
    public static func isWide(_ size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: MonthlyMileageUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = MonthlyMileageBuilder.buildProjection(
            rows: update.rows,
            unit: update.distanceUnit,
            converter: converter,
            now: now(),
            calendar: calendar
        )
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No mileage data" empty whenever there is no
    /// non-zero data; cached bars stay visible behind a refresh/offline/error so
    /// a transient failure never blanks a populated widget.
    static func resolvePhase(
        status: MonthlyMileageWidgetMileageLoadStatus,
        projection: MonthlyMileageProjection
    ) -> Phase {
        switch status {
        case .loading:
            if projection.hasData { return .content }
            return projection.bars.isEmpty ? .loading : .empty
        case .empty:
            return .empty
        case .loaded:
            return projection.hasData ? .content : .empty
        case let .failed(message):
            if projection.hasData { return .content }
            return projection.bars.isEmpty ? .error(message) : .empty
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryMonthlyMileageSource: MonthlyMileageSource {
    public var onUpdate: (@MainActor (MonthlyMileageUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MonthlyMileageUpdate?

    public init(initial: MonthlyMileageUpdate? = nil) {
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
    public func push(_ update: MonthlyMileageUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "MonthlyMileageWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum MonthlyMileageStrings {
    public static let table = "MonthlyMileageWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the widget / chart. Pure + public so
/// the a11y content can be unit-tested without rendering the view.
public enum MonthlyMileageAccessibility {
    /// Header/chart summary: "This Month <value> <unit>. 12-Mo Total <value> <unit>."
    public static func summary(for projection: MonthlyMileageProjection) -> String {
        guard projection.hasData else {
            return MonthlyMileageStrings.string("widget.monthlyMileage.noData", "No mileage data")
        }
        let unit = projection.distanceUnit
        let thisMonth = MonthlyMileageStrings.string("widget.monthlyMileage.thisMonth", "This Month")
        let total = MonthlyMileageStrings.string("widget.monthlyMileage.total12m", "12-Mo Total")
        return "\(thisMonth) \(MonthlyMileageFormat.int(projection.currentMonthDistance)) \(unit). "
            + "\(total) \(MonthlyMileageFormat.int(projection.total12mDistance)) \(unit)"
    }

    /// Per-bar VoiceOver value: "<MonthLabel>: <value> <unit>" (+ current-month note).
    public static func barLabel(_ bar: MileageBar, unit: String) -> String {
        let base = "\(bar.month): \(MonthlyMileageFormat.decimal(bar.distance, digits: 1)) \(unit)"
        guard bar.isCurrent else { return base }
        let note = MonthlyMileageStrings.string("widget.monthlyMileage.currentMonthA11y", "current month")
        return "\(base), \(note)"
    }
}
