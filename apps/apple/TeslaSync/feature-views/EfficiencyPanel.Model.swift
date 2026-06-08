//
//  EfficiencyPanel.Model.swift
//  TeslaSync — P4 feature view · 0102 · EfficiencyPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10) for the Charging Efficiency surface. The view binds through
//  `EfficiencyPanelModel`; no networking lives in the view. SwiftUI parity of
//  features/charging/components/charging-list/EfficiencyPanel.tsx — a presentational
//  leaf fed its parent's computed `EfficiencyStats` (web prop `{ stats }`), here
//  extended with the live-state freshness the Apple HIG states contract requires
//  (loading / empty / error / stale / offline chrome over cached values).
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol EfficiencyPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogEfficiencyPanelTelemetry: EfficiencyPanelTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's data, mirroring the shared `LoadableState`
/// cases the parent projects from its charging-sessions query before computing
/// `EfficiencyStats` (web `isLoading` skeleton / resolved stats / no-data / failure).
public enum EfficiencyPanelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-
/// data banner so the last-known panel stays visible but clearly labeled while
/// reconnecting (stale) or offline.
public enum EfficiencyPanelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `EfficiencyPanelSource`: the cached efficiency
/// stats plus its load + connection status and the display locale. The model turns
/// this into the header count + the four metric tiles.
public struct EfficiencyPanelUpdate: Sendable, Equatable {
    public var status: EfficiencyPanelLoadStatus
    public var input: EfficiencyPanelInput?
    public var connection: EfficiencyPanelConnection
    public var locale: String?
    public var updatedAt: Date?

    public init(
        status: EfficiencyPanelLoadStatus = .loading,
        input: EfficiencyPanelInput? = nil,
        connection: EfficiencyPanelConnection = .live,
        locale: String? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.connection = connection
        self.locale = locale
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the charging-sessions query store, projected through
/// `computeEfficiencyStats`); previews and tests use
/// `InMemoryEfficiencyPanelSource`. The view never talks to the network.
@MainActor
public protocol EfficiencyPanelSource: AnyObject {
    var onUpdate: (@MainActor (EfficiencyPanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to an `EfficiencyPanelSource`,
/// recomputes the metric-tile projection + header count, and exposes a render
/// `EfficiencyPanelPhase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class EfficiencyPanelModel {
    public private(set) var phase: EfficiencyPanelPhase = .loading
    public private(set) var connection: EfficiencyPanelConnection = .live
    public private(set) var metrics: [EfficiencyMetricModel] = []
    public private(set) var headerCount: Int?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any EfficiencyPanelSource
    @ObservationIgnored private let telemetry: any EfficiencyPanelTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any EfficiencyPanelSource,
        telemetry: any EfficiencyPanelTelemetry = OSLogEfficiencyPanelTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EfficiencyPanel.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached tiles stay visible). Wired to the retry affordance.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: EfficiencyPanelUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        let locale = update.locale.map(Locale.init(identifier:)) ?? Locale(identifier: "en-US")
        metrics = EfficiencyProjection.metrics(
            from: update.input,
            localize: EfficiencyPanelStrings.string,
            locale: locale,
            timeZone: .current
        )
        headerCount = EfficiencyProjection.headerCount(from: update.input)
        phase = EfficiencyProjection.resolvePhase(update.status, hasValue: update.input != nil)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline does not
    /// auto-refresh (there is no connectivity to retry over).
    private func handleAutoRefresh(for connection: EfficiencyPanelConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryEfficiencyPanelSource: EfficiencyPanelSource {
    public var onUpdate: (@MainActor (EfficiencyPanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EfficiencyPanelUpdate?

    public init(initial: EfficiencyPanelUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: EfficiencyPanelUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "EfficiencyPanel" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum EfficiencyPanelStrings {
    public static let table = "EfficiencyPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
