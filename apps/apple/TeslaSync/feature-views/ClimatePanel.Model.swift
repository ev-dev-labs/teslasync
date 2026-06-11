//
//  ClimatePanel.Model.swift
//  TeslaSync — P4 feature view · 0278 · ClimatePanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the i18n facade
//  (P1/S10) for the ClimatePanel surface. The view binds through `CabinClimatePanelModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/vehicles/components/telemetry-panels/ClimatePanel.tsx — a presentational leaf fed by
//  its parent's live telemetry (web prop `{ climateData }`) plus the user's display preference
//  (web `useUnits()`), here extended with the live-state freshness the Apple HIG states contract
//  requires (loading / empty / error / stale / offline chrome over the last-known climate
//  snapshot).
//
//  Naming note: the supporting types use the `CabinClimatePanel*` prefix because the dashboard
//  widget `ClimateControlPanelWidget` already owns the `ClimatePanel*` prefix in the shared
//  module. The public SwiftUI view is still `ClimatePanel` (ClimatePanel.swift) and the
//  diagnostics slug is still "ClimatePanel".
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event. Kept on a non-generic type so
/// the model and tests can reference it without the view. The slug is "ClimatePanel" — the web
/// surface name — regardless of the `CabinClimatePanel*` type prefix.
public enum ClimatePanelSurface {
    public static let slug = "ClimatePanel"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol CabinClimatePanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogCabinClimatePanelTelemetry: CabinClimatePanelTelemetry {
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
/// production source projects from the live climate feed (web `isLoading` skeleton / resolved
/// snapshot / empty / failure).
public enum CabinClimatePanelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-data banner so
/// the last-known snapshot stays visible but clearly labeled while reconnecting (stale) or offline.
public enum CabinClimatePanelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `CabinClimatePanelSource`: the cached climate snapshot, the
/// user's unit preference (web `useUnits()`), and the load + connection status. The model turns
/// this into the content model.
public struct CabinClimatePanelUpdate: Sendable, Equatable {
    public var status: CabinClimatePanelLoadStatus
    public var connection: CabinClimatePanelConnection
    public var snapshot: CabinClimatePanelSnapshot?
    public var prefs: CabinClimatePanelUnitPrefs
    public var updatedAt: Date?

    public init(
        status: CabinClimatePanelLoadStatus = .loading,
        connection: CabinClimatePanelConnection = .live,
        snapshot: CabinClimatePanelSnapshot? = nil,
        prefs: CabinClimatePanelUnitPrefs = CabinClimatePanelUnitPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.snapshot = snapshot
        self.prefs = prefs
        self.updatedAt = updatedAt
    }
}

/// The render branch the view switches over (web `climateData ? content : EmptyState`, plus the
/// loading skeleton and the no-cached-data failure state).
public enum CabinClimatePanelPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The seam the view binds through. The production app implements this over the shared P1/S8
/// state holders (the live climate snapshot + the unit preference); previews and tests use
/// `InMemoryCabinClimatePanelSource`. The view never talks to the network.
@MainActor
public protocol CabinClimatePanelSource: AnyObject {
    var onUpdate: (@MainActor (CabinClimatePanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `CabinClimatePanelSource`, recomputes the
/// content projection, and exposes a render `CabinClimatePanelPhase` + freshness for SwiftUI to
/// switch over.
@MainActor
@Observable
public final class CabinClimatePanelModel {
    public private(set) var phase: CabinClimatePanelPhase = .loading
    public private(set) var connection: CabinClimatePanelConnection = .live
    public private(set) var content: CabinClimatePanelContentModel
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any CabinClimatePanelSource
    @ObservationIgnored private let telemetry: any CabinClimatePanelTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any CabinClimatePanelSource,
        telemetry: any CabinClimatePanelTelemetry = OSLogCabinClimatePanelTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        content = CabinClimatePanelProjection.content(
            snapshot: nil,
            prefs: CabinClimatePanelUnitPrefs(),
            localize: CabinClimatePanelStrings.string
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
        telemetry.viewOpened(surface: ClimatePanelSurface.slug)
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

    private func apply(_ update: CabinClimatePanelUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        content = CabinClimatePanelProjection.content(
            snapshot: update.snapshot,
            prefs: update.prefs,
            localize: CabinClimatePanelStrings.string
        )
        phase = Self.resolvePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial fetch and renders
    /// the panel otherwise; once data is known it stays visible (cached values persist behind
    /// refresh / errors, with the freshness chip reflecting staleness or failure). With no cached
    /// snapshot the surface falls back to the empty state (resolved) or the error state (failed).
    public nonisolated static func resolvePhase(_ update: CabinClimatePanelUpdate) -> CabinClimatePanelPhase {
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
    private func handleAutoRefresh(for connection: CabinClimatePanelConnection) {
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
public final class InMemoryCabinClimatePanelSource: CabinClimatePanelSource {
    public var onUpdate: (@MainActor (CabinClimatePanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: CabinClimatePanelUpdate?

    public init(initial: CabinClimatePanelUpdate? = nil) {
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
    public func push(_ update: CabinClimatePanelUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "ClimatePanel" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. The web source keys (`common.*`,
/// `telemetry.*`) are preserved verbatim so a shared catalog resolves identically across web and
/// native.
public enum CabinClimatePanelStrings {
    public static let table = "ClimatePanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
