//
//  SecurityPanel.Model.swift
//  TeslaSync — P4 feature view · 0284 · SecurityPanel (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10) for the SecurityPanel surface. The view binds through
//  `SecurityPanelModel`; no networking lives in the view. SwiftUI parity of
//  features/vehicles/components/telemetry-panels/SecurityPanel.tsx — a presentational
//  leaf fed by its parent's live telemetry (web props `{ securityData,
//  remoteStartEnabled }`), here extended with the live-state freshness the Apple HIG
//  states contract requires (loading / empty / error / stale / offline chrome over the
//  last-known security snapshot).
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable telemetry slug for the diagnostics `view.opened` event. Kept on a
/// non-generic type so the model and tests can reference it without the view.
public enum SecurityPanelSurface {
    public static let slug = "SecurityPanel"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.viewOpened(surface:…))`, which is
/// consent-gated and redacted there.
public protocol SecurityPanelTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogSecurityPanelTelemetry: SecurityPanelTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's query, mirroring the shared `LoadableState`
/// cases the production source projects from the live security feed (web `isLoading`
/// skeleton / resolved snapshot / empty / failure).
public enum SecurityPanelLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-
/// data banner so the last-known snapshot stays visible but clearly labeled while
/// reconnecting (stale) or offline.
public enum SecurityPanelConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SecurityPanelSource`: the cached panel data
/// plus its load + connection status. The model turns this into the content model.
public struct SecurityPanelUpdate: Sendable, Equatable {
    public var status: SecurityPanelLoadStatus
    public var connection: SecurityPanelConnection
    public var data: SecurityPanelData?
    public var updatedAt: Date?

    public init(
        status: SecurityPanelLoadStatus = .loading,
        connection: SecurityPanelConnection = .live,
        data: SecurityPanelData? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.updatedAt = updatedAt
    }
}

/// The render branch the view switches over (web `hasData ? content : EmptyState`,
/// plus the loading skeleton and the no-cached-data failure state).
public enum SecurityPanelPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the live security snapshot + remote-start access);
/// previews and tests use `InMemorySecurityPanelSource`. The view never talks to the
/// network.
@MainActor
public protocol SecurityPanelSource: AnyObject {
    var onUpdate: (@MainActor (SecurityPanelUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `SecurityPanelSource`,
/// recomputes the content projection, and exposes a render `SecurityPanelPhase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SecurityPanelModel {
    public private(set) var phase: SecurityPanelPhase = .loading
    public private(set) var connection: SecurityPanelConnection = .live
    public private(set) var content: SecurityPanelContentModel
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SecurityPanelSource
    @ObservationIgnored private let telemetry: any SecurityPanelTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SecurityPanelSource,
        telemetry: any SecurityPanelTelemetry = OSLogSecurityPanelTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        content = SecurityPanelProjection.content(data: nil, localize: SecurityPanelStrings.string)
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
        telemetry.viewOpened(surface: SecurityPanelSurface.slug)
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

    private func apply(_ update: SecurityPanelUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        content = SecurityPanelProjection.content(data: update.data, localize: SecurityPanelStrings.string)
        phase = Self.resolvePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial fetch
    /// and renders the panel otherwise; once data is known it stays visible (cached
    /// values persist behind refresh / errors, with the freshness chip reflecting
    /// staleness or failure). With no cached data the surface falls back to the empty
    /// state (resolved) or the error state (failed).
    public nonisolated static func resolvePhase(_ update: SecurityPanelUpdate) -> SecurityPanelPhase {
        let hasData = update.data?.hasContent ?? false
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

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline does not
    /// auto-refresh (there is no connectivity to retry over).
    private func handleAutoRefresh(for connection: SecurityPanelConnection) {
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
public final class InMemorySecurityPanelSource: SecurityPanelSource {
    public var onUpdate: (@MainActor (SecurityPanelUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SecurityPanelUpdate?

    public init(initial: SecurityPanelUpdate? = nil) {
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
    public func push(_ update: SecurityPanelUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SecurityPanel" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time. The web source keys
/// (`common.*`, `telemetry.*`) are preserved verbatim so a shared catalog resolves
/// identically across web and native.
public enum SecurityPanelStrings {
    public static let table = "SecurityPanel"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
