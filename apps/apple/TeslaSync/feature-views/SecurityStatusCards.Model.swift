//
//  SecurityStatusCards.Model.swift
//  TeslaSync — P4 feature view · 0046 · SecurityStatusCards (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10) for the Security Status Cards surface. The view binds
//  through `SecurityCardsModel`; no networking lives in the view. SwiftUI parity of
//  features/admin/components/security-access/SecurityStatusCards.tsx — a
//  presentational leaf fed by its parent's `useSecurityLatest` query (web props
//  `{ latest, isLoading }`), here extended with the live-state freshness the Apple
//  HIG states contract requires (stale / offline chrome over cached values).
//
//  A distinct `SecurityCards*` prefix keeps these seams from colliding with the
//  in-module `SecurityStatusWidget` dashboard widget's `Security*` types.
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
public protocol SecurityCardsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogSecurityCardsTelemetry: SecurityCardsTelemetry {
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
/// cases the production source projects from the `useSecurityLatest` query (web
/// `isLoading` skeleton / resolved event / empty / failure).
public enum SecurityCardsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the header freshness chip + the cached-
/// data banner so the last-known cards stay visible but clearly labeled while
/// reconnecting (stale) or offline.
public enum SecurityCardsConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SecurityCardsSource`: the cached latest event
/// plus its load + connection status. The model turns this into the card grid.
public struct SecurityCardsUpdate: Sendable, Equatable {
    public var status: SecurityCardsLoadStatus
    public var connection: SecurityCardsConnection
    public var latest: SecurityCardsLatest?
    public var updatedAt: Date?

    public init(
        status: SecurityCardsLoadStatus = .loading,
        connection: SecurityCardsConnection = .live,
        latest: SecurityCardsLatest? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.latest = latest
        self.updatedAt = updatedAt
    }
}

/// The render branch the view switches over (web shell `isLoading` / content, plus
/// the resolved-with-no-event empty state and the no-cached-data failure state).
public enum SecurityCardsPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `security/latest` query store); previews and
/// tests use `InMemorySecurityCardsSource`. The view never talks to the network.
@MainActor
public protocol SecurityCardsSource: AnyObject {
    var onUpdate: (@MainActor (SecurityCardsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `SecurityCardsSource`,
/// recomputes the card-grid projection, and exposes a render `SecurityCardsPhase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SecurityCardsModel {
    public private(set) var phase: SecurityCardsPhase = .loading
    public private(set) var connection: SecurityCardsConnection = .live
    public private(set) var cards: [SecurityCardViewModel] = []
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SecurityCardsSource
    @ObservationIgnored private let telemetry: any SecurityCardsTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SecurityCardsSource,
        telemetry: any SecurityCardsTelemetry = OSLogSecurityCardsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SecurityStatusCards.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached cards stay visible). Wired to the retry affordance.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: SecurityCardsUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        cards = SecurityCardsProjection.cards(latest: update.latest, localize: SecurityCardsStrings.string)
        phase = Self.resolvePhase(update)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and renders the grid otherwise; once an event is known the cards stay
    /// visible (cached values persist behind refresh / errors, with the freshness
    /// chip reflecting staleness or failure). With no cached event the surface falls
    /// back to the empty grid (resolved) or the error state (failed).
    public nonisolated static func resolvePhase(_ update: SecurityCardsUpdate) -> SecurityCardsPhase {
        let hasData = update.latest != nil
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
    private func handleAutoRefresh(for connection: SecurityCardsConnection) {
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
public final class InMemorySecurityCardsSource: SecurityCardsSource {
    public var onUpdate: (@MainActor (SecurityCardsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SecurityCardsUpdate?

    public init(initial: SecurityCardsUpdate? = nil) {
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
    public func push(_ update: SecurityCardsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SecurityStatusCards" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum SecurityCardsStrings {
    public static let table = "SecurityStatusCards"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
