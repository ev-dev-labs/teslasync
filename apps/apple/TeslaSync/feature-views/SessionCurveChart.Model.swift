//
//  SessionCurveChart.Model.swift
//  TeslaSync — P4 feature view · 0090 · SessionCurveChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Power vs SOC" charging-curve surface. The view binds through
//  `SessionCurveChartModel`; no networking lives in the view. SwiftUI parity of
//  features/charging/components/charging-curve/SessionCurveChart.tsx — the
//  power-vs-SOC area chart for the selected charging session.
//
//  The web component receives `curveData` (a `CurvePoint[]`) as a prop, derived by
//  the parent charging-curve page via `generateChargingCurve(selectedSession)`, and
//  that parent owns the `isLoading` / error / freshness lifecycle. The native
//  surface reproduces that whole lifecycle through a `SessionCurveChartSource` —
//  carrying the selected session so the curve is generated here — so every
//  prompt-required state (loading / empty / error / stale / offline / content)
//  renders on this surface.
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
public protocol SessionCurveChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSessionCurveChartTelemetry: SessionCurveChartTelemetry {
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
/// view holds no hardcoded literals. Keys live in the "SessionCurveChart" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum SessionCurveStrings {
    public static let table = "SessionCurveChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Number formatting (web `fmtNumber`)

/// Locale-aware decimal formatting shared by the chart axes, tooltip, and the
/// VoiceOver summaries — the native parity of the web `fmtNumber(value, decimals)`.
public enum SessionCurveFormat {
    /// A locale-aware decimal string with a fixed fraction width and grouping.
    public static func decimal(_ value: Double, decimals: Int, locale: Locale) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SessionCurveChartSource`: the selected
/// session (the curve input) + its load status + the live-state connection + the
/// last-update timestamp. The model turns this into the power-vs-SOC projection.
public struct SessionCurveChartUpdate: Sendable, Equatable {
    public var status: SessionCurveLoadStatus
    public var session: SessionCurveInput?
    public var connection: SessionCurveConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SessionCurveLoadStatus = .loading,
        session: SessionCurveInput? = nil,
        connection: SessionCurveConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.session = session
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the selected charging session the web
/// charging-curve page feeds `generateChargingCurve` and pushing each snapshot.
/// Previews + tests use `InMemorySessionCurveSource`. The view never talks to the
/// network directly.
@MainActor
public protocol SessionCurveChartSource: AnyObject {
    var onUpdate: (@MainActor (SessionCurveChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `SessionCurveChartSource`,
/// projects each snapshot into the power-vs-SOC curve, exposes a render
/// `SessionCurvePhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class SessionCurveChartModel {
    public private(set) var phase: SessionCurvePhase = .loading
    public private(set) var connection: SessionCurveConnection = .live
    public private(set) var projection: SessionCurveProjection = .empty
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SessionCurveChartSource
    @ObservationIgnored private let telemetry: any SessionCurveChartTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SessionCurveChartSource,
        telemetry: any SessionCurveChartTelemetry = OSLogSessionCurveChartTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The raw curve points the chart plots (web `curveData`).
    public var points: [SessionCurvePoint] {
        projection.points
    }

    /// The combined VoiceOver summary for the chart, formatted for `locale`.
    public func accessibilitySummary(locale: Locale) -> String {
        SessionCurveAccessibility.chartSummary(
            projection: projection,
            localize: SessionCurveStrings.string,
            number: { SessionCurveFormat.decimal($0, decimals: $1, locale: locale) }
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SessionCurveSurface.slug)
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

    private func apply(_ update: SessionCurveChartUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        projection = SessionCurveBuilder.project(update.session)
        phase = SessionCurveBuilder.resolvePhase(update.status, hasData: projection.hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached curve on screen and does not refetch.
    private func handleAutoRefresh(for connection: SessionCurveConnection) {
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
public final class InMemorySessionCurveSource: SessionCurveChartSource {
    public var onUpdate: (@MainActor (SessionCurveChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SessionCurveChartUpdate?

    public init(initial: SessionCurveChartUpdate? = nil) {
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
    public func push(_ update: SessionCurveChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension SessionCurveChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SessionCurveSurface.slug
    }
}
