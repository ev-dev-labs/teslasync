//
//  ProjectedRangeWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0074 · ProjectedRangeWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the SwiftUI parity of features/dashboard/widgets/ProjectedRangeWidget.tsx. The
//  view binds through `ProjectedRangeModel`; no networking lives in the view. The
//  registry primitives (`DashboardWidgetRegistration` / `DashboardWidgetSize`) are
//  the dashboard-widget-tier types shared across the staged surfaces.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol ProjectedRangeTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogProjectedRangeTelemetry: ProjectedRangeTelemetry {
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
/// cases the production source projects from the `useProjectedRange` query.
public enum ProjectedRangeLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013) and the web
/// shell's `isStale` / offline handling.
public enum ProjectedRangeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The cached projected-range payload (web `ProjectedRangeData`, web/src/types/
/// energy.ts). Every field is optional so the projection can reproduce the web's
/// per-field null checks (`data?.current_range_km != null ? … : null`). Distances
/// are carried in **kilometres** exactly as the API delivers them; the adapter
/// converts to the user's display unit at the render boundary.
public struct ProjectedRangeInput: Sendable, Equatable {
    public var currentRangeKm: Double?
    public var newRangeKm: Double?
    public var degradationPct: Double?
    public var totalCycles: Double?
    public var healthScore: Double?
    public var currentCapacityPct: Double?
    public var avgDailyKm: Double?

    public init(
        currentRangeKm: Double? = nil,
        newRangeKm: Double? = nil,
        degradationPct: Double? = nil,
        totalCycles: Double? = nil,
        healthScore: Double? = nil,
        currentCapacityPct: Double? = nil,
        avgDailyKm: Double? = nil
    ) {
        self.currentRangeKm = currentRangeKm
        self.newRangeKm = newRangeKm
        self.degradationPct = degradationPct
        self.totalCycles = totalCycles
        self.healthScore = healthScore
        self.currentCapacityPct = currentCapacityPct
        self.avgDailyKm = avgDailyKm
    }
}

/// One coalesced snapshot pushed by a `ProjectedRangeSource`: the cached payload
/// plus its load/connection status, the active measurement system (web `useUnits`),
/// and whether a background refetch is in flight (web `isFetching`). The model
/// turns this into the view projection.
public struct ProjectedRangeUpdate: Sendable, Equatable {
    public var status: ProjectedRangeLoadStatus
    public var connection: ProjectedRangeConnection
    public var data: ProjectedRangeInput?
    public var units: MeasurementSystem
    public var isRefetching: Bool
    public var updatedAt: Date?

    public init(
        status: ProjectedRangeLoadStatus = .loading,
        connection: ProjectedRangeConnection = .live,
        data: ProjectedRangeInput? = nil,
        units: MeasurementSystem = .metric,
        isRefetching: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.units = units
        self.isRefetching = isRefetching
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the projected-range query + the settings/units
/// store); previews and tests use `InMemoryProjectedRangeSource`. The view never
/// talks to the network directly.
@MainActor
public protocol ProjectedRangeSource: AnyObject {
    var onUpdate: (@MainActor (ProjectedRangeUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ProjectedRangeSource`,
/// recomputes the `ProjectedRangeStats` projection, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ProjectedRangeModel {
    /// The mutually-exclusive render branches (web shell loading / content + the
    /// body's `data ? … : EmptyState`).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ProjectedRangeConnection = .live
    public private(set) var isRefetching = false
    public private(set) var stats: ProjectedRangeStats?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ProjectedRangeSource
    @ObservationIgnored private let telemetry: any ProjectedRangeTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any ProjectedRangeSource,
        telemetry: any ProjectedRangeTelemetry = OSLogProjectedRangeTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ProjectedRangeWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: ProjectedRangeUpdate) {
        connection = update.connection
        isRefetching = update.isRefetching
        updatedAt = update.updatedAt
        stats = update.data.map { ProjectedRangeStats.project(data: $0, units: update.units) }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Mirrors the web: the shell only shows the skeleton
    /// on the initial fetch, and the body shows the "No projected range data" empty
    /// state when there is no payload. Whenever a payload is known the widget renders
    /// (cached values stay visible behind refresh / errors / staleness, with the
    /// freshness chip + banner reflecting the connection and any failure).
    public static func resolvePhase(_ update: ProjectedRangeUpdate) -> Phase {
        let hasData = update.data != nil
        switch update.status {
        case .loading:
            return hasData ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryProjectedRangeSource: ProjectedRangeSource {
    public var onUpdate: (@MainActor (ProjectedRangeUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ProjectedRangeUpdate?

    public init(initial: ProjectedRangeUpdate? = nil) {
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
    public func push(_ update: ProjectedRangeUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ProjectedRangeWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum ProjectedRangeStrings {
    public static let table = "ProjectedRangeWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
