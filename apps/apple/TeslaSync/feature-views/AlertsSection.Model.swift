//
//  AlertsSection.Model.swift
//  TeslaSync — P4 feature view · 0071 · AlertsSection (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the weekly-digest "Alerts" surface. The view binds through
//  `AlertsSectionModel`; no networking lives in the view. SwiftUI parity of
//  features/analytics/components/weekly-digest/AlertsSection.tsx.
//
//  The web component receives `metrics` + `alertPieData` as props derived by the
//  parent `WeeklyDigestPage` (`useWeeklyDigest`), and the parent owns the
//  `isLoading` / error / freshness lifecycle. The native surface reproduces that
//  whole lifecycle through an `AlertsSectionSource` so every prompt-required state
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
public protocol AlertsSectionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogAlertsSectionTelemetry: AlertsSectionTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "AlertsSection" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum AlertsStrings {
    public static let table = "AlertsSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by an `AlertsSectionSource`: the raw severity→count
/// map + its load status + the live-state connection + the last-update timestamp.
public struct AlertsUpdate: Sendable, Equatable {
    public var status: AlertsLoadStatus
    /// The web `metrics.alertsByType` map (severity string → count).
    public var counts: [String: Int]
    public var connection: AlertsConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: AlertsLoadStatus = .loading,
        counts: [String: Int] = [:],
        connection: AlertsConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.counts = counts
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the weekly-digest query the web
/// `useWeeklyDigest` reads and projecting it to the severity→count map. Previews +
/// tests use `InMemoryAlertsSectionSource`. The view never talks to the network.
@MainActor
public protocol AlertsSectionSource: AnyObject {
    var onUpdate: (@MainActor (AlertsUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to an `AlertsSectionSource`,
/// projects each snapshot into ordered severity data, exposes a render
/// `AlertsPhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class AlertsSectionModel {
    public private(set) var phase: AlertsPhase = .loading
    public private(set) var connection: AlertsConnection = .live
    public private(set) var data: [AlertSeverityDatum] = []
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any AlertsSectionSource
    @ObservationIgnored private let telemetry: any AlertsSectionTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any AlertsSectionSource,
        telemetry: any AlertsSectionTelemetry = OSLogAlertsSectionTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The total alert count across all severities (header badge / a11y).
    public var total: Int {
        AlertsProjection.total(data)
    }

    /// The combined VoiceOver summary for the section.
    public var accessibilitySummary: String {
        AlertsAccessibility.sectionSummary(data: data, localize: AlertsStrings.string)
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: AlertsSectionSurface.slug)
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

    private func apply(_ update: AlertsUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        data = AlertsProjection.data(from: update.counts)
        phase = AlertsProjection.resolvePhase(update.status, total: AlertsProjection.total(data))
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached counts on screen and does not refetch.
    private func handleAutoRefresh(for connection: AlertsConnection) {
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

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot
/// on `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryAlertsSectionSource: AlertsSectionSource {
    public var onUpdate: (@MainActor (AlertsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: AlertsUpdate?

    public init(initial: AlertsUpdate? = nil) {
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
    public func push(_ update: AlertsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension AlertsSection {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        AlertsSectionSurface.slug
    }
}
