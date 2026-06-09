//
//  FleetStatsBar.Model.swift
//  TeslaSync — P4 feature view · 0123 · FleetStatsBar (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10) for the dashboard fleet stats bar. The view binds through
//  `FleetStatsBarViewModel`; no networking lives in the view. SwiftUI parity of
//  features/dashboard/components/FleetStatsBar.tsx.
//
//  The web leaf receives its props from `FleetStatsWidget`, which owns the
//  `isFetching` / `isStale` / `isError` / `onRefresh` / `dataUpdatedAt` lifecycle
//  (via `WidgetShell` + the dashboard queries). The native surface reproduces that
//  whole lifecycle through a `FleetStatsSource` so every prompt-required state
//  (loading / empty / error / stale / offline / content) renders here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol FleetStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogFleetStatsTelemetry: FleetStatsTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "FleetStatsBar" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time; the per-surface table
/// keeps each parallel surface prompt self-contained.
public enum FleetStatsStrings {
    public static let table = "FleetStatsBar"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `FleetStatsSource`: the bar inputs + their load
/// status + the live-state connection + the last-update timestamp.
public struct FleetStatsUpdate: Sendable, Equatable {
    public var status: FleetStatsLoadStatus
    public var input: FleetStatsInput
    public var connection: FleetStatsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: FleetStatsLoadStatus = .loading,
        input: FleetStatsInput = FleetStatsInput(),
        connection: FleetStatsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.input = input
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared
/// P1/S8 state holders — composing the vehicles + fleet-analytics + recent
/// drives/charges queries the web widget reads. Previews + tests use
/// `InMemoryFleetStatsSource`. The view never talks to the network directly.
@MainActor
public protocol FleetStatsSource: AnyObject {
    var onUpdate: (@MainActor (FleetStatsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying queries (web `WidgetShell` refresh / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `FleetStatsSource`, projects
/// each snapshot into the five cards, exposes a render `FleetStatsPhase` + freshness
/// for SwiftUI to switch over, and emits the `view.opened` diagnostics event once on
/// first appearance.
@MainActor
@Observable
public final class FleetStatsBarViewModel {
    public private(set) var phase: FleetStatsPhase = .loading
    public private(set) var connection: FleetStatsConnection = .live
    public private(set) var cards: [FleetStatCard] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any FleetStatsSource
    @ObservationIgnored private let telemetry: any FleetStatsTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any FleetStatsSource,
        telemetry: any FleetStatsTelemetry = OSLogFleetStatsTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The combined VoiceOver summary for the whole bar.
    public var accessibilitySummary: String {
        FleetStatsAccessibility.barSummary(cards: cards, localize: FleetStatsStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: FleetStatsSurface.slug)
        source.start()
    }

    /// Stops observing the upstream queries.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying queries (web refresh) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: FleetStatsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        cards = FleetStatsProjection.cards(from: update.input, locale: locale)
        phase = FleetStatsProjection.resolvePhase(update.status, isEmpty: FleetStatsProjection.isEmpty(update.input))
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once
    /// live so a later stale episode re-triggers exactly once. Offline keeps the cached
    /// cards on screen and does not refetch.
    private func handleAutoRefresh(for connection: FleetStatsConnection) {
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

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryFleetStatsSource: FleetStatsSource {
    public var onUpdate: (@MainActor (FleetStatsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: FleetStatsUpdate?

    public init(initial: FleetStatsUpdate? = nil) {
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
    public func push(_ update: FleetStatsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension FleetStatsBar {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        FleetStatsSurface.slug
    }
}
