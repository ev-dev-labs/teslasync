//
//  ChargeSessionChartWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0019 · ChargeSessionChartWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model and the testable accessibility summary. The view
//  binds through `ChargeSessionChartModel`; no networking lives here.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol ChargeSessionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogChargeSessionTelemetry: ChargeSessionTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum ChargeSessionChartLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum ChargeSessionChartConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargeSessionChartSource`: the cached
/// sessions + the active locale/timezone for the date labels + load/connection
/// status. The model turns this into the rendered projection.
public struct ChargeSessionChartUpdate: Sendable, Equatable {
    public var status: ChargeSessionChartLoadStatus
    public var connection: ChargeSessionChartConnection
    public var vehicle: ChargeSessionVehicle?
    public var rows: [ChargeSessionDTO]
    public var localeIdentifier: String
    public var timeZoneIdentifier: String
    public var updatedAt: Date?

    public init(
        status: ChargeSessionChartLoadStatus = .loading,
        connection: ChargeSessionChartConnection = .live,
        vehicle: ChargeSessionVehicle? = nil,
        rows: [ChargeSessionDTO] = [],
        localeIdentifier: String = "en_US",
        timeZoneIdentifier: String = "UTC",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.rows = rows
        self.localeIdentifier = localeIdentifier
        self.timeZoneIdentifier = timeZoneIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useCharging` projected from the KMP
/// `ChargingStore`, with `useVehicles` supplying the scoped id and
/// `useDateFormat` the locale/timezone); previews and tests use
/// `InMemoryChargeSessionChartSource`. The view never talks to the network.
@MainActor
public protocol ChargeSessionChartSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargeSessionChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ChargeSessionChartSource`,
/// recomputes the `ChargeSessionChartProjection` via `ChargeSessionBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargeSessionChartModel {
    /// The mutually-exclusive render branches (web shell loading / error +
    /// chart-summary empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargeSessionChartConnection = .live
    public private(set) var projection: ChargeSessionChartProjection = .empty
    public private(set) var vehicle: ChargeSessionVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargeSessionChartSource
    @ObservationIgnored private let telemetry: any ChargeSessionTelemetry
    @ObservationIgnored private let converter: any ChargeSessionEnergyConverting
    @ObservationIgnored private var started = false

    public init(
        source: any ChargeSessionChartSource,
        telemetry: any ChargeSessionTelemetry = OSLogChargeSessionTelemetry(),
        converter: any ChargeSessionEnergyConverting = StandardChargeSessionEnergyConverter()
    ) {
        self.source = source
        self.telemetry = telemetry
        self.converter = converter
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ChargeSessionChartWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances and the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Compact (summary-only, no chart) when the widget is a single cell — the
    /// web `isCompact = size.cols <= 1 && size.rows <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1 && size.rows <= 1
    }

    /// Wide (thinned axis ticks) at 3+ columns — the web `isWide = size.cols >= 3`.
    public static func isWide(_ size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: ChargeSessionChartUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = ChargeSessionBuilder.buildProjection(
            rows: update.rows,
            converter: converter,
            localeIdentifier: update.localeIdentifier,
            timeZoneIdentifier: update.timeZoneIdentifier
        )
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No charge sessions yet" empty whenever there are
    /// no sessions; cached bars stay visible behind a refresh/offline/error so a
    /// transient failure never blanks a populated widget.
    static func resolvePhase(
        status: ChargeSessionChartLoadStatus,
        projection: ChargeSessionChartProjection
    ) -> Phase {
        switch status {
        case .loading:
            projection.hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            projection.hasData ? .content : .empty
        case let .failed(message):
            projection.hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargeSessionChartSource: ChargeSessionChartSource {
    public var onUpdate: (@MainActor (ChargeSessionChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargeSessionChartUpdate?

    public init(initial: ChargeSessionChartUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: ChargeSessionChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargeSessionChartWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum ChargeSessionStrings {
    public static let table = "ChargeSessionChartWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the widget / chart. Pure + public so
/// the a11y content can be unit-tested without rendering the view.
public enum ChargeSessionAccessibility {
    /// Header/chart summary:
    /// "Total <value> kWh. Avg <value> kWh. <count> sessions." (web stats).
    public static func summary(for projection: ChargeSessionChartProjection) -> String {
        guard projection.hasData else {
            return ChargeSessionStrings.string("widget.chargeSessionChart.empty", "No charge sessions yet")
        }
        let unit = projection.energyUnit
        let total = ChargeSessionStrings.string("widget.chargeSessionChart.total", "Total")
        let avg = ChargeSessionStrings.string("widget.chargeSessionChart.avg", "Avg")
        let sessions = ChargeSessionStrings.string("widget.chargeSessionChart.sessions", "Sessions")
        let totalText = ChargeSessionFormat.number(projection.totalEnergy, decimals: 1)
        let avgText = ChargeSessionFormat.number(projection.avgEnergy, decimals: 1)
        return "\(total) \(totalText) \(unit). \(avg) \(avgText) \(unit). "
            + "\(sessions) \(projection.sessionCount)"
    }

    /// Per-bar VoiceOver value: "<label>: <energy> kWh, <charger type>".
    public static func barLabel(_ bar: ChargeSessionBar) -> String {
        let energy = ChargeSessionFormat.number(bar.energy, decimals: 1)
        let kind = ChargeSessionStrings.string(bar.kind.labelKey, bar.kind.labelFallback)
        return "\(bar.label): \(energy) kWh, \(kind)"
    }
}
