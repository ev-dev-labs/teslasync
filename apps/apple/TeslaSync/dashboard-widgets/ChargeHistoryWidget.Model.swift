//
//  ChargeHistoryWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0017 · ChargeHistoryWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the observable view-model and the testable accessibility summary. The view
//  binds through `ChargeHistoryChartModel`; no networking lives here.
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
public protocol ChargeHistoryTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogChargeHistoryTelemetry: ChargeHistoryTelemetry {
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
public enum ChargeHistoryChartLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum ChargeHistoryChartConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `ChargeHistoryChartSource`: the cached
/// sessions + load/connection status + the freshness timestamp. The model turns
/// this into the rendered projection.
public struct ChargeHistoryChartUpdate: Sendable, Equatable {
    public var status: ChargeHistoryChartLoadStatus
    public var connection: ChargeHistoryChartConnection
    public var vehicle: ChargeHistoryVehicle?
    public var rows: [ChargeHistorySessionDTO]
    public var updatedAt: Date?

    public init(
        status: ChargeHistoryChartLoadStatus = .loading,
        connection: ChargeHistoryChartConnection = .live,
        vehicle: ChargeHistoryVehicle? = nil,
        rows: [ChargeHistorySessionDTO] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.rows = rows
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`useCharging` projected from the KMP
/// `ChargingStore`, with `useVehicles` supplying the scoped id); previews and
/// tests use `InMemoryChargeHistoryChartSource`. The view never talks to the
/// network.
@MainActor
public protocol ChargeHistoryChartSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargeHistoryChartUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `ChargeHistoryChartSource`,
/// recomputes the `ChargeHistoryChartProjection` via `ChargeHistoryBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class ChargeHistoryChartModel {
    /// The mutually-exclusive render branches (web shell loading / error +
    /// chart-summary empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: ChargeHistoryChartConnection = .live
    public private(set) var projection: ChargeHistoryChartProjection = .empty
    public private(set) var vehicle: ChargeHistoryVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any ChargeHistoryChartSource
    @ObservationIgnored private let telemetry: any ChargeHistoryTelemetry
    @ObservationIgnored private let converter: any ChargeHistoryEnergyConverting
    @ObservationIgnored private var started = false

    public init(
        source: any ChargeHistoryChartSource,
        telemetry: any ChargeHistoryTelemetry = OSLogChargeHistoryTelemetry(),
        converter: any ChargeHistoryEnergyConverting = StandardChargeHistoryEnergyConverter()
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
        telemetry.viewOpened(surface: ChargeHistoryWidget.surfaceSlug)
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

    /// Compact (summary-only, no chart) when the widget is a single column —
    /// the web `isCompact = size.cols <= 1`.
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Wide (thinned x-axis ticks) at 3+ columns, so the index labels never
    /// collide on a roomy widget.
    public static func isWide(_ size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: ChargeHistoryChartUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        projection = ChargeHistoryBuilder.buildProjection(rows: update.rows, converter: converter)
        phase = Self.resolvePhase(status: update.status, projection: projection)
    }

    /// Resolves the render phase. The web shows the skeleton only on the initial
    /// fetch and the friendly "No charge sessions yet" empty whenever there are
    /// fewer than two sessions (web `hasData = chartData.length > 1`); cached
    /// points stay visible behind a refresh/offline/error so a transient failure
    /// never blanks a populated widget.
    static func resolvePhase(
        status: ChargeHistoryChartLoadStatus,
        projection: ChargeHistoryChartProjection
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
public final class InMemoryChargeHistoryChartSource: ChargeHistoryChartSource {
    public var onUpdate: (@MainActor (ChargeHistoryChartUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargeHistoryChartUpdate?

    public init(initial: ChargeHistoryChartUpdate? = nil) {
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
    public func push(_ update: ChargeHistoryChartUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ChargeHistoryWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum ChargeHistoryStrings {
    public static let table = "ChargeHistoryWidget"

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
public enum ChargeHistoryAccessibility {
    /// Header/chart summary: "Total <value> kWh. Avg <value> kWh." (web stats),
    /// or the empty message when there is too little history.
    public static func summary(for projection: ChargeHistoryChartProjection) -> String {
        guard projection.hasData else {
            return ChargeHistoryStrings.string("widget.noChargeHistory", "No charge sessions yet")
        }
        let unit = projection.energyUnit
        let total = ChargeHistoryStrings.string("widget.chargeHistory.total", "Total")
        let avg = ChargeHistoryStrings.string("widget.chargeHistory.avg", "Avg")
        let totalText = ChargeHistoryFormat.number(projection.totalEnergy, decimals: 1)
        let avgText = ChargeHistoryFormat.number(projection.avgEnergy, decimals: 1)
        return "\(total) \(totalText) \(unit). \(avg) \(avgText) \(unit)."
    }

    /// Per-point VoiceOver value: "Session <index>: <energy> kWh".
    public static func pointLabel(_ point: ChargeHistoryPoint, unit: String) -> String {
        let session = ChargeHistoryStrings.string("widget.chargeHistory.session", "Session")
        let energy = ChargeHistoryFormat.number(point.energy, decimals: 1)
        return "\(session) \(point.indexLabel): \(energy) \(unit)"
    }
}
