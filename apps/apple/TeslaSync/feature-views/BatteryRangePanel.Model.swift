//
//  BatteryRangePanel.Model.swift
//  TeslaSync — P4 feature view · 0289 · BatteryRangePanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the i18n facade
//  (P1/S10) for the BatteryRangePanel surface. The view binds through `BatteryRangePanelModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/vehicles/components/vehicle-detail/BatteryRangePanel.tsx — a presentational leaf fed by
//  its parent's vehicle state (web prop `{ state }`) plus the user's display preference (web
//  `useUnits()`), here extended with the live-state freshness the Apple HIG states contract requires
//  (loading / empty / error / stale / offline chrome over the last-known snapshot).
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event. Kept on a non-generic type so the
/// model and tests can reference it without the view.
public enum BatteryRangePanelSurface {
    public static let slug = "BatteryRangePanel"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol BatteryRangePanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogBatteryRangePanelTelemetry: BatteryRangePanelTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's query, mirroring the shared `LoadableState` cases the
/// production source projects from the live vehicle-state feed (web `isLoading` skeleton / resolved
/// snapshot / empty / failure).
public enum BatteryRangePanelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so the
/// last-known snapshot stays visible but clearly labeled while reconnecting (stale) or offline.
public enum BatteryRangePanelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `BatteryRangePanelSource`: the cached vehicle-state subset,
/// the user's unit preference (web `useUnits()`), and the load + connection status. The model turns
/// this into the content model.
public struct BatteryRangePanelUpdate: Sendable, Equatable {
    public var status: BatteryRangePanelLoadStatus
    public var connection: BatteryRangePanelConnection
    public var snapshot: BatteryRangePanelSnapshot?
    public var prefs: BatteryRangePanelUnitPrefs
    public var updatedAt: Date?

    public init(
        status: BatteryRangePanelLoadStatus = .loading,
        connection: BatteryRangePanelConnection = .live,
        snapshot: BatteryRangePanelSnapshot? = nil,
        prefs: BatteryRangePanelUnitPrefs = BatteryRangePanelUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.snapshot = snapshot
        self.prefs = prefs
        self.updatedAt = updatedAt
    }
}

/// The render branch the view switches over (web's always-rendered panel, plus the loading skeleton,
/// the no-cached-data empty state, and the failure state the Apple HIG states contract requires).
public enum BatteryRangePanelPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the live vehicle-state snapshot + the unit preference); previews and tests use
/// `InMemoryBatteryRangePanelSource`. The view never talks to the network.
@MainActor
public protocol BatteryRangePanelSource: AnyObject {
    var onUpdate: (@MainActor (BatteryRangePanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `BatteryRangePanelSource`, recomputes the
/// content projection, and exposes a render `BatteryRangePanelPhase` + freshness for SwiftUI to
/// switch over.
@MainActor
@Observable
public final class BatteryRangePanelModel {
    public private(set) var phase: BatteryRangePanelPhase = .loading
    public private(set) var connection: BatteryRangePanelConnection = .live
    public private(set) var content: BatteryRangePanelContentModel
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryRangePanelSource
    @ObservationIgnored private let telemetry: any BatteryRangePanelTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any BatteryRangePanelSource,
        telemetry: any BatteryRangePanelTelemetry = OSLogBatteryRangePanelTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        content = BatteryRangePanelProjection.content(
            snapshot: nil,
            prefs: BatteryRangePanelUnitPrefs(),
            localize: BatteryRangePanelStrings.string
        )
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Whether the freshness chip is shown — only over visible content that is not live.
    public var showsFreshness: Bool {
        phase == .content && connection != .live
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryRangePanelSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached content stays visible). Wired to the retry affordance.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: BatteryRangePanelUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        content = BatteryRangePanelProjection.content(
            snapshot: update.snapshot,
            prefs: update.prefs,
            localize: BatteryRangePanelStrings.string
        )
        phase = Self.resolvePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase. The web always renders the panel from its `state` prop; the native
    /// leaf shows the skeleton only on the initial fetch and keeps cached values visible behind
    /// refresh / errors (the freshness chip reflects staleness or failure). With no cached snapshot
    /// the surface falls back to the empty state (resolved) or the error state (failed).
    public nonisolated static func resolvePhase(_ update: BatteryRangePanelUpdate) -> BatteryRangePanelPhase {
        let hasData = update.snapshot != nil
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

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline does not auto-refresh (there is no
    /// connectivity to retry over).
    private func handleAutoRefresh(for connection: BatteryRangePanelConnection) {
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

// MARK: - In-memory source (previews + tests; the view never performs I/O)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryBatteryRangePanelSource: BatteryRangePanelSource {
    public var onUpdate: (@MainActor (BatteryRangePanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryRangePanelUpdate?

    public init(initial: BatteryRangePanelUpdate? = nil) {
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
    public func push(_ update: BatteryRangePanelUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "BatteryRangePanel" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The web source keys (`common.*`,
/// `vehicles.detail.*`) are preserved verbatim so a shared catalog resolves identically across web
/// and native.
public enum BatteryRangePanelStrings {
    public static let table = "BatteryRangePanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
