//
//  PowerFlowHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0073 · PowerFlowHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10).
//  The view binds through `PowerFlowModel`; no networking lives in the view. The
//  model coalesces the cached Tesla Energy site + 24h live-status history (web
//  `useTeslaEnergySites` + `useTeslaEnergyLiveStatusHistory`) into the view-ready
//  projection and a mutually-exclusive render `Phase`.
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
public protocol PowerFlowTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogPowerFlowTelemetry: PowerFlowTelemetry {
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
public enum PowerFlowHistoryWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip (web `DataFreshness` live / stale / offline).
public enum PowerFlowHistoryWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// Which friendly empty surface to show inside the content shell — the native
/// split of the web source's two distinct empty messages (`noSite` when no Tesla
/// Energy site is linked, `noData` when the 24h history has no non-zero samples).
public enum PowerFlowEmptyReason: Sendable, Equatable {
    case noSite
    case noData
}

/// The linked Tesla Energy site (web `sites[0]`). Presence indicates a site is
/// linked; the web only reads `energy_site_id`, so that's all the projection needs.
public struct PowerFlowSiteInput: Sendable, Equatable {
    public var energySiteID: Int64

    public init(energySiteID: Int64) {
        self.energySiteID = energySiteID
    }
}

/// One cached live-status sample (web `TeslaEnergyLiveStatus`). Powers are in
/// watts and nullable (web `number | null`), matching the SI-on-disk contract;
/// the projection converts to kilowatts at the display boundary (web `/ 1000`).
public struct PowerFlowHistoryEntryInput: Sendable, Equatable {
    public var timestamp: Date
    public var solarPowerW: Double?
    public var batteryPowerW: Double?
    public var gridPowerW: Double?
    public var loadPowerW: Double?

    public init(
        timestamp: Date,
        solarPowerW: Double? = nil,
        batteryPowerW: Double? = nil,
        gridPowerW: Double? = nil,
        loadPowerW: Double? = nil
    ) {
        self.timestamp = timestamp
        self.solarPowerW = solarPowerW
        self.batteryPowerW = batteryPowerW
        self.gridPowerW = gridPowerW
        self.loadPowerW = loadPowerW
    }
}

/// One coalesced snapshot pushed by a `PowerFlowSource`: the cached site + 24h
/// history plus their aggregate load/connection status. The model turns this into
/// the `PowerFlowPoint`/`PowerFlowSummary` projection + a render `Phase`.
public struct PowerFlowUpdate: Sendable, Equatable {
    public var status: PowerFlowHistoryWidgetLoadStatus
    public var connection: PowerFlowHistoryWidgetConnection
    public var site: PowerFlowSiteInput?
    public var history: [PowerFlowHistoryEntryInput]
    public var updatedAt: Date?

    public init(
        status: PowerFlowHistoryWidgetLoadStatus = .loading,
        connection: PowerFlowHistoryWidgetConnection = .live,
        site: PowerFlowSiteInput? = nil,
        history: [PowerFlowHistoryEntryInput] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.site = site
        self.history = history
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the Tesla Energy site + live-status-history
/// stores); previews and tests use `InMemoryPowerFlowSource`. The view never
/// talks to the network directly.
@MainActor
public protocol PowerFlowSource: AnyObject {
    var onUpdate: (@MainActor (PowerFlowUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `PowerFlowSource`,
/// recomputes the `PowerFlowPoint`/`PowerFlowSummary` projection, and exposes a
/// render `Phase` + freshness + empty reason for SwiftUI to switch over.
@MainActor
@Observable
public final class PowerFlowModel {
    /// The mutually-exclusive render branches (web shell skeleton / error / body).
    public enum Phase: Equatable {
        case loading
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: PowerFlowHistoryWidgetConnection = .live
    public private(set) var points: [PowerFlowPoint] = []
    public private(set) var summary: PowerFlowSummary = .zero
    public private(set) var emptyReason: PowerFlowEmptyReason? = .noData
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any PowerFlowSource
    @ObservationIgnored private let telemetry: any PowerFlowTelemetry
    @ObservationIgnored private var started = false

    public init(source: any PowerFlowSource, telemetry: any PowerFlowTelemetry = OSLogPowerFlowTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PowerFlowHistoryWidget.surfaceSlug)
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

    private func apply(_ update: PowerFlowUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        let projected = PowerFlowHistoryWidgetProjection.points(from: update.history)
        points = projected
        summary = PowerFlowHistoryWidgetProjection.summary(for: projected)
        emptyReason = Self.resolveEmptyReason(site: update.site, points: projected)
        phase = Self.resolvePhase(status: update.status, hasContent: !projected.isEmpty)
    }

    /// Resolves the render phase with the web shell's precedence: a hard query
    /// error replaces the body (web `if (error) return <QueryError/>`); the
    /// skeleton shows only on the initial fetch with nothing cached; otherwise the
    /// content shell renders (and shows its own friendly empty surface when there
    /// is no site or no data).
    public static func resolvePhase(status: PowerFlowHistoryWidgetLoadStatus, hasContent: Bool) -> Phase {
        switch status {
        case let .failed(message):
            .error(message)
        case .loading:
            hasContent ? .content : .loading
        case .loaded:
            .content
        }
    }

    /// Resolves which empty surface (if any) the content shell shows, mirroring
    /// the web `!hasSites` → `noSite` and `!hasData` → `noData` branches.
    public static func resolveEmptyReason(
        site: PowerFlowSiteInput?,
        points: [PowerFlowPoint]
    ) -> PowerFlowEmptyReason? {
        guard site != nil else { return .noSite }
        return PowerFlowHistoryWidgetProjection.hasData(points) ? nil : .noData
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryPowerFlowSource: PowerFlowSource {
    public var onUpdate: (@MainActor (PowerFlowUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PowerFlowUpdate?

    public init(initial: PowerFlowUpdate? = nil) {
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
    public func push(_ update: PowerFlowUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "PowerFlowHistoryWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum PowerFlowStrings {
    public static let table = "PowerFlowHistoryWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
