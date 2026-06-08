//
//  WallConnectorWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0112 · WallConnectorWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + dashboard registry +
//  i18n facade (P1/S10). The view binds through `WallConnectorModel`; no networking
//  lives in the view. The model coalesces the cached Tesla Energy site + Wall
//  Connector charging history (web `useTeslaEnergySites` + `useTeslaWCChargingHistory`)
//  into the daily-bar + month-summary projection and a mutually-exclusive render
//  `Phase` plus an empty-reason (no-site vs no-data) for SwiftUI to switch over.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol WallConnectorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogWallConnectorTelemetry: WallConnectorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The aggregate load lifecycle the web widget derives from its two queries
/// (`isLoading = sitesLoading || (siteId && historyLoading)`, `error`, success).
/// The source coalesces the sites + history `Resource<T>` states into one value.
public enum WallConnectorLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip (web `DataFreshness` live / stale / offline).
public enum WallConnectorConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// Which friendly empty surface to show inside the content shell — the native split
/// of the web source's two distinct empty messages (`noSite` when no Tesla Energy
/// site is linked, `noData` when there is no non-zero Wall Connector charge).
public enum WallConnectorEmptyReason: Sendable, Equatable {
    case noSite
    case noData
}

/// One coalesced snapshot pushed by a `WallConnectorSource`: the cached site + the
/// charging history plus their aggregate load/connection status. The model turns
/// this into the daily-bar + summary projection and a render `Phase`.
public struct WallConnectorUpdate: Sendable, Equatable {
    public var status: WallConnectorLoadStatus
    public var connection: WallConnectorConnection
    public var site: WallConnectorSiteInput?
    public var history: [WallConnectorEntryInput]
    public var now: Date
    public var updatedAt: Date?

    public init(
        status: WallConnectorLoadStatus = .loading,
        connection: WallConnectorConnection = .live,
        site: WallConnectorSiteInput? = nil,
        history: [WallConnectorEntryInput] = [],
        now: Date = Date(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.site = site
        self.history = history
        self.now = now
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the Tesla Energy site + Wall Connector charging
/// history stores); previews and tests use `InMemoryWallConnectorSource`. The view
/// never talks to the network directly.
@MainActor
public protocol WallConnectorSource: AnyObject {
    var onUpdate: (@MainActor (WallConnectorUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `WallConnectorSource`,
/// recomputes the daily-bar + summary projection, and exposes a render `Phase` +
/// freshness + empty reason for SwiftUI to switch over.
@MainActor
@Observable
public final class WallConnectorModel {
    /// The mutually-exclusive render branches (web shell skeleton / error / body).
    public enum Phase: Equatable {
        case loading
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: WallConnectorConnection = .live
    public private(set) var bars: [WallConnectorDailyBar] = []
    public private(set) var summary: WallConnectorSummary = .zero
    public private(set) var emptyReason: WallConnectorEmptyReason? = .noData
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any WallConnectorSource
    @ObservationIgnored private let telemetry: any WallConnectorTelemetry
    @ObservationIgnored private let calendar: Calendar
    @ObservationIgnored private var started = false

    public init(
        source: any WallConnectorSource,
        telemetry: any WallConnectorTelemetry = OSLogWallConnectorTelemetry(),
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
        telemetry.viewOpened(surface: WallConnectorWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached values stay visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: WallConnectorUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        let projected = WallConnectorProjection.dailyBars(from: update.history, calendar: calendar)
        bars = projected
        summary = WallConnectorProjection.summary(for: update.history, now: update.now, calendar: calendar)
        emptyReason = Self.resolveEmptyReason(site: update.site, bars: projected)
        phase = Self.resolvePhase(status: update.status, hasContent: !projected.isEmpty)
    }

    /// Resolves the render phase with the web shell's precedence: a hard query
    /// error replaces the body (web `if (error) return <QueryError/>`); the skeleton
    /// shows only on the initial fetch with nothing cached; otherwise the content
    /// shell renders (and shows its own friendly empty surface when there is no site
    /// or no data).
    public static func resolvePhase(status: WallConnectorLoadStatus, hasContent: Bool) -> Phase {
        switch status {
        case let .failed(message):
            .error(message)
        case .loading:
            hasContent ? .content : .loading
        case .loaded:
            .content
        }
    }

    /// Resolves which empty surface (if any) the content shell shows, mirroring the
    /// web `!hasSites` → `noSite` and `!hasData` → `noData` branches.
    public static func resolveEmptyReason(
        site: WallConnectorSiteInput?,
        bars: [WallConnectorDailyBar]
    ) -> WallConnectorEmptyReason? {
        guard site != nil else { return .noSite }
        return WallConnectorProjection.hasData(bars) ? nil : .noData
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryWallConnectorSource: WallConnectorSource {
    public var onUpdate: (@MainActor (WallConnectorUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: WallConnectorUpdate?

    public init(initial: WallConnectorUpdate? = nil) {
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
    public func push(_ update: WallConnectorUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/charging.ts → "wall-connector")

/// A dashboard grid size in (columns × rows), matching the web `WidgetSize`.
public struct DashboardWidgetSize: Sendable, Equatable {
    public var cols: Int
    public var rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

/// The dashboard registration for a draggable widget surface (web `WidgetDef`).
public struct DashboardWidgetRegistration: Sendable {
    public let id: String
    public let nameKey: String
    public let descriptionKey: String
    public let category: String
    public let defaultSize: DashboardWidgetSize
    public let minSize: DashboardWidgetSize
    public let maxSize: DashboardWidgetSize

    /// Clamps a requested grid size into the surface's `min…max` envelope, so the
    /// native grid honors the same constraints as the web registry.
    public func clamp(_ size: DashboardWidgetSize) -> DashboardWidgetSize {
        DashboardWidgetSize(
            cols: min(max(size.cols, minSize.cols), maxSize.cols),
            rows: min(max(size.rows, minSize.rows), maxSize.rows)
        )
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "WallConnectorWidget" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum WallConnectorStrings {
    public static let table = "WallConnectorWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
