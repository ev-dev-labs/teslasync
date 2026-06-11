//
//  BatteryComparison.Model.swift
//  TeslaSync — P4 feature view · 0275 · BatteryComparison (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade (P1/S10) for the
//  fleet "Battery Level" comparison panel. The view binds through `BatteryComparisonModel`; no
//  networking lives in the view. SwiftUI parity of
//  features/vehicles/components/BatteryComparison.tsx — the per-vehicle battery bars shown on the
//  vehicles overview.
//
//  The web component takes `vehicles: Vehicle[]` and runs one `useQuery` that fans out to
//  `fetchVehicleState(id)` per vehicle (30s `refetchInterval`), dropping vehicles whose state
//  rejects. The native surface reproduces that whole lifecycle through a `BatteryComparisonSource`
//  so every prompt-required state (loading / empty / error / stale / offline / content) renders
//  here — the production app implements the source over the shared P1/S8 state holders; previews +
//  tests use `InMemoryBatteryComparisonSource`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016), which is consent-gated and redacted there.
public protocol BatteryComparisonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogBatteryComparisonTelemetry: BatteryComparisonTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "BatteryComparison" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; the per-surface table keeps each parallel
/// surface prompt self-contained.
public enum BatteryComparisonStrings {
    public static let table = "BatteryComparison"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `BatteryComparisonSource`: the fetched per-vehicle entries +
/// their load status + the active unit preferences + the live-state connection + the last-update
/// timestamp. The model turns this into the bar projection.
public struct BatteryComparisonUpdate: Sendable, Equatable {
    public var status: BatteryComparisonLoadStatus
    public var entries: [BatteryComparisonEntry]
    public var units: BatteryComparisonUnits
    public var connection: BatteryComparisonConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: BatteryComparisonLoadStatus = .loading,
        entries: [BatteryComparisonEntry] = [],
        units: BatteryComparisonUnits = .metric,
        connection: BatteryComparisonConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.entries = entries
        self.units = units
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders — fanning the per-vehicle state query the web `useQuery` runs and projecting it. Previews
/// + tests use `InMemoryBatteryComparisonSource`. The view never talks to the network directly.
@MainActor
public protocol BatteryComparisonSource: AnyObject {
    var onUpdate: (@MainActor (BatteryComparisonUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web `useQuery` refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `BatteryComparisonSource`, projects each
/// snapshot into the resolved bars, exposes a render `BatteryComparisonPhase` + freshness for
/// SwiftUI to switch over, and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class BatteryComparisonModel {
    public private(set) var phase: BatteryComparisonPhase = .loading
    public private(set) var connection: BatteryComparisonConnection = .live
    public private(set) var projection = BatteryComparisonProjection(bars: [], hasData: false)
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any BatteryComparisonSource
    @ObservationIgnored private let telemetry: any BatteryComparisonTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any BatteryComparisonSource,
        telemetry: any BatteryComparisonTelemetry = OSLogBatteryComparisonTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The resolved battery bars the panel plots.
    public var bars: [BatteryComparisonBar] {
        projection.bars
    }

    /// The combined VoiceOver summary for the panel.
    public var accessibilitySummary: String {
        BatteryComparisonAccessibility.panelSummary(
            barCount: projection.bars.count,
            localize: BatteryComparisonStrings.string
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: BatteryComparisonSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: BatteryComparisonUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        projection = BatteryComparisonBuilder.project(update.entries, units: update.units)
        phase = BatteryComparisonBuilder.resolvePhase(update.status, hasData: projection.hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset once live so a
    /// later stale episode re-triggers exactly once. Offline keeps the cached bars on screen and
    /// does not refetch.
    private func handleAutoRefresh(for connection: BatteryComparisonConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on `start()` and
/// lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryBatteryComparisonSource: BatteryComparisonSource {
    public var onUpdate: (@MainActor (BatteryComparisonUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: BatteryComparisonUpdate?

    public init(initial: BatteryComparisonUpdate? = nil) {
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
    public func push(_ update: BatteryComparisonUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension BatteryComparison {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        BatteryComparisonSurface.slug
    }
}
