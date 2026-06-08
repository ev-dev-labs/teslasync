//
//  MileageStatsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0064 · MileageStatsWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The view binds through this model and
//  never performs networking itself. The grid `DashboardWidgetSize` /
//  `DashboardWidgetRegistration` types are the shared dashboard primitives.
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
public protocol MileageStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogMileageStatsTelemetry: MileageStatsTelemetry {
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
public enum MileageLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum MileageConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `MileageStatsSource`: the cached DTO
/// inputs plus their load/connection status and the active distance preference.
/// The model turns this into the display projection.
public struct MileageStatsUpdate: Sendable, Equatable {
    public var status: MileageLoadStatus
    public var connection: MileageConnection
    public var vehicle: MileageVehicleRef?
    public var input: MileageStatsInput?
    public var unitLabel: String
    public var updatedAt: Date?

    public init(
        status: MileageLoadStatus = .loading,
        connection: MileageConnection = .live,
        vehicle: MileageVehicleRef? = nil,
        input: MileageStatsInput? = nil,
        unitLabel: String = "km",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.input = input
        self.unitLabel = unitLabel
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP
/// analytics store + the units preference); previews and tests use
/// `InMemoryMileageStatsSource`. The view never talks to the network directly.
@MainActor
public protocol MileageStatsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (MileageStatsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `MileageStatsSource`,
/// recomputes the `MileageStatsProjection` via `MileageStatsBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class MileageStatsModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: MileageConnection = .live
    public private(set) var projection: MileageStatsProjection?
    public private(set) var unit: MileageDistanceUnit = .kilometers
    public private(set) var vehicle: MileageVehicleRef?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any MileageStatsSource
    @ObservationIgnored private let telemetry: any MileageStatsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any MileageStatsSource,
        telemetry: any MileageStatsTelemetry = OSLogMileageStatsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MileageStatsWidget.surfaceSlug)
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

    /// The web collapses to a single large daily-average number at one column
    /// (`isCompact = size.cols <= 1`).
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    private func apply(_ update: MileageStatsUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        unit = MileageDistanceUnit.fromLabel(update.unitLabel)
        projection = MileageStatsBuilder.project(update.input, unit: unit)
        phase = Self.resolvePhase(update, hasData: projection != nil)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the empty state when there is no data; whenever a snapshot is
    /// known the grid renders (cached values stay visible behind refresh/errors).
    private static func resolvePhase(_ update: MileageStatsUpdate, hasData: Bool) -> Phase {
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
public final class InMemoryMileageStatsSource: MileageStatsSource {
    public var onUpdate: (@MainActor (MileageStatsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MileageStatsUpdate?

    public init(initial: MileageStatsUpdate? = nil) {
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
    public func push(_ update: MileageStatsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "MileageStatsWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time so each parallel surface owns its own strings.
public enum MileageStatsStrings {
    public static let table = "MileageStatsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// Interpolates a single integer into a localized format (web `~{{months}} mo`).
    public static func format(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the stat grid. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum MileageStatsAccessibility {
    public static func summary(for projection: MileageStatsProjection) -> String {
        let unit = projection.unit.symbol
        var parts = [
            "\(MileageStatsStrings.string("widget.mileageStats.dailyAvg", "Daily Avg")) "
                + "\(MileageNumberFormat.decimal(projection.dailyAvgDisplay, fractionDigits: 1)) \(unit)",
            "\(MileageStatsStrings.string("widget.mileageStats.weeklyAvg", "Weekly Avg")) "
                + "\(MileageNumberFormat.decimal(projection.weeklyAvgDisplay, fractionDigits: 0)) \(unit)",
            "\(MileageStatsStrings.string("widget.mileageStats.monthlyAvg", "Monthly Avg")) "
                + "\(MileageNumberFormat.decimal(projection.monthlyAvgDisplay, fractionDigits: 0)) \(unit)"
        ]
        var milestone = "\(MileageStatsStrings.string("widget.mileageStats.nextMilestone", "Next Milestone")) "
            + "\(MileageNumberFormat.integer(projection.milestone)) \(unit)"
        if projection.monthsToMilestone > 0 {
            milestone += ", " + MileageStatsStrings.format(
                "widget.mileageStats.inMonths",
                "~%lld mo",
                projection.monthsToMilestone
            )
        }
        parts.append(milestone)
        return parts.joined(separator: ". ")
    }
}
