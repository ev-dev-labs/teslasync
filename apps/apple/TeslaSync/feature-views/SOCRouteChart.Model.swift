//
//  SOCRouteChart.Model.swift
//  TeslaSync — P4 feature view · 0176 · SOCRouteChart (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10) for the "Battery Along Route" trip-planner surface. The view binds
//  through `SOCRouteChartModel`; no networking lives in the view. SwiftUI parity of
//  features/driving/components/SOCRouteChart.tsx — the planned-route state-of-charge
//  area chart shown on the trip planner page.
//
//  The web component receives `socCurve`, `chargeStops`, and `minArrivalSOC` as
//  props derived by the parent (the trip planner page), and the parent owns the
//  loading / error / freshness lifecycle. The native surface reproduces that whole
//  lifecycle through a `SOCRouteChartSource` so every prompt-required state
//  (loading / empty / error / stale / offline / content) renders here. It also owns
//  the tooltip cursor the web Recharts `<Tooltip>` drives on hover, exposed as an
//  observable `selectedDistance` so chart selection flows through one seam.
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
public protocol SOCRouteChartTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogSOCRouteChartTelemetry: SOCRouteChartTelemetry {
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
/// view holds no hardcoded literals. Keys live in the "SOCRouteChart" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the
/// per-surface table keeps each parallel surface prompt self-contained.
public enum SOCRouteChartStrings {
    public static let table = "SOCRouteChart"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `SOCRouteChartSource`: the planned trip's
/// soc-curve + charge stops + minimum arrival SOC, plus the load status, the live
/// connection, and the last-update timestamp. The model turns these into the area
/// trace + charge-stop reference lines.
public struct SOCRouteChartUpdate: Sendable, Equatable {
    public var status: SOCRouteChartLoadStatus
    public var socCurve: [SOCRoutePoint]
    public var chargeStops: [SOCRouteChargeStop]
    public var minArrivalSoc: Double
    public var connection: SOCRouteChartConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: SOCRouteChartLoadStatus = .loading,
        socCurve: [SOCRoutePoint] = [],
        chargeStops: [SOCRouteChargeStop] = [],
        minArrivalSoc: Double = 0,
        connection: SOCRouteChartConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.socCurve = socCurve
        self.chargeStops = chargeStops
        self.minArrivalSoc = minArrivalSoc
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the trip-plan query the web page reads and
/// mapping it into `SOCRoutePoint`s + `SOCRouteChargeStop`s. Previews + tests use
/// `InMemorySOCRouteChartSource`. The view never talks to the network directly.
@MainActor
public protocol SOCRouteChartSource: AnyObject {
    var onUpdate: (@MainActor (SOCRouteChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `SOCRouteChartSource`,
/// projects each snapshot into the route trace + charge-stop reference lines,
/// exposes a render `SOCRouteChartPhase` + freshness for SwiftUI to switch over,
/// owns the tooltip cursor (web Recharts `<Tooltip>`), and emits the `view.opened`
/// diagnostics event once on first appearance.
@MainActor
@Observable
public final class SOCRouteChartModel {
    public private(set) var phase: SOCRouteChartPhase = .loading
    public private(set) var connection: SOCRouteChartConnection = .live
    public private(set) var samples: [SOCRouteSample] = []
    public private(set) var markers: [SOCRouteChargeMarker] = []
    public private(set) var minArrivalSoc: Double = 0
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    /// The tooltip cursor x distance — the native parity of the web Recharts
    /// `<Tooltip>` active point. Driven by chart selection; `nil` hides the tooltip.
    public var selectedDistance: Double?

    @ObservationIgnored private let source: any SOCRouteChartSource
    @ObservationIgnored private let telemetry: any SOCRouteChartTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any SOCRouteChartSource,
        telemetry: any SOCRouteChartTelemetry = OSLogSOCRouteChartTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale used for number formatting (chart axes / tooltip / a11y).
    public var displayLocale: Locale {
        locale
    }

    /// The combined VoiceOver summary for the chart.
    public var accessibilitySummary: String {
        SOCRouteChartAccessibility.chartSummary(
            samples: samples,
            markers: markers,
            minArrivalSoc: minArrivalSoc,
            localize: SOCRouteChartStrings.string,
            locale: locale
        )
    }

    /// Moves the tooltip cursor to a selected x distance (web `<Tooltip>` hover).
    /// `nil` clears it (pointer left the plot).
    public func moveCursor(to distance: Double?) {
        selectedDistance = distance
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SOCRouteChartSurface.slug)
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

    private func apply(_ update: SOCRouteChartUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        minArrivalSoc = update.minArrivalSoc
        samples = SOCRouteChartProjection.samples(from: update.socCurve)
        markers = SOCRouteChartProjection.chargeMarkers(
            socCurve: update.socCurve,
            chargeStops: update.chargeStops
        )
        phase = SOCRouteChartProjection.resolvePhase(
            update.status,
            hasTrace: SOCRouteChartProjection.hasTrace(samples)
        )
        // Drop a cursor that no longer maps to a sample after the data changed, so a
        // stale tooltip never lingers (web clears the active point on new data).
        if SOCRouteChartProjection.sample(nearestDistance: selectedDistance, in: samples) == nil {
            selectedDistance = nil
        }
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached curve on screen and does not refetch.
    private func handleAutoRefresh(for connection: SOCRouteChartConnection) {
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
public final class InMemorySOCRouteChartSource: SOCRouteChartSource {
    public var onUpdate: (@MainActor (SOCRouteChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SOCRouteChartUpdate?

    public init(initial: SOCRouteChartUpdate? = nil) {
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
    public func push(_ update: SOCRouteChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity

public extension SOCRouteChart {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        SOCRouteChartSurface.slug
    }
}
